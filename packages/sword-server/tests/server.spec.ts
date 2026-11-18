import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { Packaging, State } from '@curvenote/sword-common';
import type { StatusDocument } from '@curvenote/sword-common';
import { anyAuth, apiKeyAuth, basicAuth, FileSystemStore } from '../src/index.js';
import { AUTH, BASE, depositRequest, expectValid, makeServer, meca } from './helpers.js';

const get = (url: string, headers: Record<string, string> = {}) =>
  new Request(url, { headers: { Authorization: AUTH, ...headers } });

describe('service document', () => {
  it('is served at the Service-URL and matches the SWORD schema', async () => {
    const server = makeServer();
    const res = await server.handle(get(`${BASE}/service-document`));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/ld+json');
    const doc = await res.json();
    expectValid('service', doc);
    expect(doc['@id']).toBe(`${BASE}/service-document`);
    expect(doc.acceptPackaging).toContain(Packaging.MECA);
    expect(doc.authentication).toEqual(['Basic']);
  });

  it('also answers on the mount root', async () => {
    const res = await makeServer().handle(get(BASE));
    expect(res.status).toBe(200);
  });
});

describe('authentication', () => {
  it('requires credentials', async () => {
    const res = await makeServer().handle(new Request(`${BASE}/service-document`));
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toMatch(/^Basic/);
    const doc = await res.json();
    expectValid('error', doc);
    expect(doc['@type']).toBe('AuthenticationRequired');
  });

  it('rejects bad credentials', async () => {
    const res = await makeServer().handle(
      get(`${BASE}/service-document`, { Authorization: `Basic ${btoa('alice:nope')}` }),
    );
    expect(res.status).toBe(403);
    expect((await res.json())['@type']).toBe('AuthenticationFailed');
  });
});

describe('package deposit', () => {
  it('creates an object from a MECA zip', async () => {
    const deposits: string[] = [];
    const server = makeServer({ onDeposit: (r) => void deposits.push(r.id) });
    const res = await server.handle(
      await depositRequest(meca(), { Packaging: Packaging.MECA, Slug: 'my article' }),
    );
    expect(res.status).toBe(201);
    expect(res.headers.get('Location')).toBe(`${BASE}/objects/my-article`);
    const status: StatusDocument = await res.json();
    expectValid('status', status);
    expect(status.state[0]['@id']).toBe(State.InWorkflow);
    expect(status.links).toHaveLength(1);
    expect(status.links[0]['@id']).toBe(`${BASE}/objects/my-article/files/test-meca.zip`);
    expect(status.links[0].packaging).toBe(Packaging.MECA);
    expect(status.links[0].depositedBy).toBe('alice');
    expect(deposits).toEqual(['my-article']);

    const record = await server.store.get('my-article');
    expect(record?.meca?.article?.title).toBe('Exchanging Manuscripts over SWORD');
    expect(record?.meca?.fileCount).toBe(3);
  });

  it('derives metadata from the JATS article', async () => {
    const server = makeServer();
    const created = await server.handle(await depositRequest(meca()));
    const status: StatusDocument = await created.json();
    const res = await server.handle(get(status.metadata['@id']));
    expect(res.status).toBe(200);
    expect(res.headers.get('ETag')).toBeTruthy();
    const metadata = await res.json();
    expectValid('metadata', metadata);
    expect(metadata['dc:title']).toBe('Exchanging Manuscripts over SWORD');
  });

  it('serves the original package back', async () => {
    const server = makeServer();
    const zip = meca();
    const status: StatusDocument = await (await server.handle(await depositRequest(zip))).json();
    const res = await server.handle(get(status.links[0]['@id']));
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/zip');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(zip);
  });

  it('defaults to Binary packaging and a generated id', async () => {
    const res = await makeServer().handle(await depositRequest(meca()));
    const status: StatusDocument = await res.json();
    expect(status.links[0].packaging).toBe(Packaging.Binary);
    expect(status['@id']).toMatch(/\/objects\/[0-9a-f-]{36}$/);
  });

  it('does not reuse an existing slug', async () => {
    const server = makeServer();
    await server.handle(await depositRequest(meca(), { Slug: 'dup' }));
    const res = await server.handle(await depositRequest(meca(), { Slug: 'dup' }));
    expect(res.headers.get('Location')).not.toMatch(/\/dup$/);
  });

  it.each([
    [{ Digest: 'SHA-256=AAAA' }, 412, 'DigestMismatch'],
    [{ Digest: '' }, 412, 'DigestMismatch'],
    [{ 'Content-Type': 'application/pdf' }, 415, 'ContentTypeNotAcceptable'],
    [{ Packaging: Packaging.SWORDBagIt }, 415, 'PackagingFormatNotAcceptable'],
    [{ 'On-Behalf-Of': 'bob' }, 412, 'OnBehalfOfNotAllowed'],
    [{ 'Content-Disposition': 'attachment; by-reference=true' }, 412, 'ByReferenceNotAllowed'],
  ])('rejects %o with %i %s', async (headers, status, type) => {
    const res = await makeServer().handle(await depositRequest(meca(), headers));
    expect(res.status).toBe(status);
    const doc = await res.json();
    expectValid('error', doc);
    expect(doc['@type']).toBe(type);
  });

  it('allows a missing digest when configured', async () => {
    const res = await makeServer({ requireDigest: false }).handle(
      await depositRequest(meca(), { Digest: '' }),
    );
    expect(res.status).toBe(201);
  });

  it('rejects zips that are not MECA bundles', async () => {
    const res = await makeServer().handle(await depositRequest(new TextEncoder().encode('nope')));
    expect(res.status).toBe(400);
    const doc = await res.json();
    expect(doc['@type']).toBe('ContentMalformed');
    expect(doc.log).toMatch(/not a zip/);
  });

  it('enforces maxUploadSize', async () => {
    const res = await makeServer({ maxUploadSize: 10 }).handle(await depositRequest(meca()));
    expect(res.status).toBe(413);
    expect((await res.json())['@type']).toBe('MaxUploadSizeExceeded');
  });

  it('stops reading a streamed body once it passes maxUploadSize', async () => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 1000) controller.close();
        else controller.enqueue(new Uint8Array(1024));
      },
    });
    const base = await depositRequest(meca());
    const req = new Request(base.url, {
      method: 'POST',
      headers: base.headers,
      body,
      duplex: 'half',
    } as RequestInit);
    const res = await makeServer({ maxUploadSize: 4096 }).handle(req);
    expect(res.status).toBe(413);
    expect(pulled).toBeLessThan(20);
  });
});

describe('metadata deposit and replacement', () => {
  const metadataRequest = (url: string, method: string, body: unknown, headers = {}) =>
    new Request(url, {
      method,
      headers: {
        Authorization: AUTH,
        'Content-Type': 'application/ld+json',
        'Content-Disposition': 'attachment; metadata=true',
        ...headers,
      },
      body: JSON.stringify(body),
    });

  it('creates a metadata-only object', async () => {
    const server = makeServer();
    const res = await server.handle(
      metadataRequest(`${BASE}/service-document`, 'POST', { 'dc:title': 'Only metadata' }),
    );
    expect(res.status).toBe(201);
    const status: StatusDocument = await res.json();
    expectValid('status', status);
    expect(status.state[0]['@id']).toBe(State.InProgress);
    expect(status.links).toEqual([]);
  });

  it('replaces metadata with If-Match concurrency control', async () => {
    const server = makeServer();
    const status: StatusDocument = await (await server.handle(await depositRequest(meca()))).json();
    const url = status.metadata['@id'];

    const stale = await server.handle(
      metadataRequest(url, 'PUT', { 'dc:title': 'New' }, { 'If-Match': 'wrong' }),
    );
    expect(stale.status).toBe(412);
    expect((await stale.json())['@type']).toBe('ETagNotMatched');

    const ok = await server.handle(
      metadataRequest(url, 'PUT', { 'dc:title': 'New' }, { 'If-Match': status.eTag! }),
    );
    expect(ok.status).toBe(204);
    expect(ok.headers.get('ETag')).not.toBe(status.eTag);
    const metadata = await (await server.handle(get(url))).json();
    expect(metadata['dc:title']).toBe('New');
  });

  it('rejects unknown metadata formats and malformed bodies', async () => {
    const server = makeServer();
    const fmt = await server.handle(
      metadataRequest(`${BASE}/service-document`, 'POST', {}, { 'Metadata-Format': 'x' }),
    );
    expect(fmt.status).toBe(415);
    const bad = await server.handle(metadataRequest(`${BASE}/service-document`, 'POST', [1]));
    expect(bad.status).toBe(400);
  });
});

describe('object lifecycle', () => {
  it('reports status, changes state, and deletes', async () => {
    const server = makeServer();
    const created: StatusDocument = await (
      await server.handle(await depositRequest(meca()))
    ).json();
    const id = created['@id'].split('/').pop()!;

    await server.setState(id, State.Ingested, 'Accepted by editor');
    const res = await server.handle(get(created['@id']));
    expect(res.status).toBe(200);
    const status: StatusDocument = await res.json();
    expect(status.state).toEqual([{ '@id': State.Ingested, description: 'Accepted by editor' }]);
    expect(res.headers.get('ETag')).toBe(status.eTag);

    const del = await server.handle(
      new Request(created['@id'], { method: 'DELETE', headers: { Authorization: AUTH } }),
    );
    expect(del.status).toBe(204);
    expect((await server.handle(get(created['@id']))).status).toBe(404);
  });

  it('returns 404 and 405 error documents', async () => {
    const server = makeServer();
    const missing = await server.handle(get(`${BASE}/objects/nope`));
    expect(missing.status).toBe(404);
    expectValid('error', await missing.json());
    const notAllowed = await server.handle(
      new Request(`${BASE}/service-document`, { method: 'PUT', headers: { Authorization: AUTH } }),
    );
    expect(notAllowed.status).toBe(405);
    expect(notAllowed.headers.get('Allow')).toBe('GET, POST');
  });
});

describe('FileSystemStore', () => {
  it('persists deposits to disk', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sword-'));
    const store = new FileSystemStore(root);
    const server = makeServer({ store });
    const res = await server.handle(await depositRequest(meca(), { Slug: 'on-disk' }));
    expect(res.status).toBe(201);
    expect(fs.existsSync(path.join(root, 'on-disk', 'record.json'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'on-disk', 'files', 'test-meca.zip'))).toBe(true);
    const again = makeServer({ store: new FileSystemStore(root) });
    expect((await again.store.list()).map((r) => r.id)).toEqual(['on-disk']);
    await expect(store.getFile('on-disk', '../record.json')).resolves.toBeUndefined();
    fs.rmSync(root, { recursive: true, force: true });
  });
});

describe('collections', () => {
  const collections = [
    { id: 'articles', title: 'Articles' },
    { id: 'reviews', title: 'Reviews' },
  ];

  it('lists collections as sub-services with their own Service-URLs', async () => {
    const server = makeServer({ collections });
    const doc = await (await server.handle(get(`${BASE}/service-document`))).json();
    expectValid('service', doc);
    expect(doc.services.map((s: { '@id': string }) => s['@id'])).toEqual([
      `${BASE}/collections/articles`,
      `${BASE}/collections/reviews`,
    ]);
    const sub = await (await server.handle(get(`${BASE}/collections/reviews`))).json();
    expectValid('service', sub);
    expect(sub['dc:title']).toBe('Reviews');
    expect(sub.root).toBe(`${BASE}/service-document`);
  });

  it('records the collection a package was deposited into', async () => {
    const server = makeServer({ collections });
    const req = await depositRequest(meca());
    const res = await server.handle(new Request(`${BASE}/collections/articles`, req));
    expect(res.status).toBe(201);
    const status: StatusDocument = await res.json();
    expect(status.service).toBe(`${BASE}/collections/articles`);
    const id = status['@id'].split('/').pop()!;
    expect((await server.store.get(id))?.collection).toBe('articles');
  });

  it('404s unknown collections', async () => {
    const res = await makeServer({ collections }).handle(get(`${BASE}/collections/nope`));
    expect(res.status).toBe(404);
  });
});

describe('API keys', () => {
  const authenticate = anyAuth(basicAuth({ alice: 'secret' }), apiKeyAuth({ k123: 'ojs' }));

  it('accepts a valid key and rejects a bad one', async () => {
    const server = makeServer({ authenticate, authentication: ['Basic', 'APIKey'] });
    const ok = await server.handle(await depositRequest(meca(), { Authorization: 'APIKey k123' }));
    expect(ok.status).toBe(201);
    const status: StatusDocument = await ok.json();
    expect(status.links[0].depositedBy).toBe('ojs');
    const bad = await server.handle(get(`${BASE}/service-document`, { Authorization: 'APIKey x' }));
    expect(bad.status).toBe(403);
    const basic = await server.handle(get(`${BASE}/service-document`));
    expect((await basic.json()).authentication).toEqual(['Basic', 'APIKey']);
  });
});
