import { describe, expect, it } from 'vitest';
import { buildMeca } from '@curvenote/sword-common/meca';
import { anyAuth, apiKeyAuth, basicAuth, MemoryStore, SwordServer } from '@curvenote/sword-server';
import { Packaging, State, SwordClient, SwordError } from '../src/index.js';
import { ARTICLE, TRANSFER } from '../../sword-common/tests/fixtures.js';

const BASE = 'http://receiver.test/sword';

function setup(opts: { password?: string; acceptPackaging?: string[] } = {}) {
  const server = new SwordServer({
    baseUrl: BASE,
    store: new MemoryStore(),
    authenticate: basicAuth({ alice: 'secret' }),
  });
  const calls: Request[] = [];
  const client = new SwordClient({
    serviceUrl: `${BASE}/service-document`,
    username: 'alice',
    password: opts.password ?? 'secret',
    fetch: async (input, init) => {
      const req = new Request(input, init);
      calls.push(req.clone());
      const res = await server.handle(req);
      if (opts.acceptPackaging && req.method === 'GET' && req.url.endsWith('/service-document')) {
        const doc = await res.json();
        return Response.json({ ...doc, acceptPackaging: opts.acceptPackaging });
      }
      return res;
    },
  });
  return { server, client, calls };
}

const meca = () => buildMeca({ article: ARTICLE, transfer: TRANSFER });

describe('SwordClient', () => {
  it('reads the service document', async () => {
    const { client } = setup();
    const doc = await client.getServiceDocument();
    expect(doc['@type']).toBe('ServiceDocument');
    expect(doc.acceptPackaging).toContain(Packaging.MECA);
  });

  it('deposits a MECA package with digest, disposition and MECA packaging', async () => {
    const { client, calls } = setup();
    const result = await client.depositMeca(meca(), { filename: 'paper-meca.zip', slug: 'paper' });
    expect(result.location).toBe(`${BASE}/objects/paper`);
    expect(result.status.state[0]['@id']).toBe(State.InWorkflow);
    const post = calls.find((c) => c.method === 'POST')!;
    expect(post.headers.get('Digest')).toMatch(/^SHA-256=/);
    expect(post.headers.get('Content-Disposition')).toBe('attachment; filename="paper-meca.zip"');
    expect(post.headers.get('Packaging')).toBe(Packaging.MECA);
    expect(post.headers.get('Authorization')).toBe(`Basic ${btoa('alice:secret')}`);
  });

  it('falls back to Binary packaging when the server does not advertise MECA', async () => {
    const { client, calls } = setup({ acceptPackaging: [Packaging.Binary] });
    await client.depositMeca(meca());
    expect(calls.find((c) => c.method === 'POST')!.headers.get('Packaging')).toBe(Packaging.Binary);
  });

  it('round-trips status, metadata, files and delete', async () => {
    const { client, server } = setup();
    const zip = meca();
    const { location, status } = await client.depositMeca(new Blob([zip as BlobPart]));

    const metadata = await client.getMetadata(location);
    expect(metadata['dc:title']).toBe('Exchanging Manuscripts over SWORD');

    const { eTag } = await client.replaceMetadata(
      status,
      { 'dc:title': 'Retitled' },
      {
        ifMatch: status.eTag,
      },
    );
    expect(eTag).toBeTruthy();
    expect((await client.getMetadata(status))['dc:title']).toBe('Retitled');

    expect(await client.downloadOriginalDeposit(await client.getStatus(location))).toEqual(zip);

    await server.setState(location.split('/').pop()!, State.Ingested);
    const done = await client.waitForState(location, [State.Ingested], { interval: 1 });
    expect(done.state[0]['@id']).toBe(State.Ingested);

    await client.deleteObject(location);
    await expect(client.getStatus(location)).rejects.toMatchObject({
      status: 404,
      type: 'NotFound',
    });
  });

  it('deposits metadata only', async () => {
    const { client } = setup();
    const { status } = await client.depositMetadata({ 'dc:title': 'Just metadata' });
    expect(status.state[0]['@id']).toBe(State.InProgress);
  });

  it('surfaces SWORD error documents as SwordError', async () => {
    const { client } = setup({ password: 'wrong' });
    const error = await client.getServiceDocument().catch((e) => e);
    expect(error).toBeInstanceOf(SwordError);
    expect(error.type).toBe('AuthenticationFailed');
    expect(error.status).toBe(403);
  });

  it('checks maxUploadSize before sending', async () => {
    const server = new SwordServer({
      baseUrl: BASE,
      store: new MemoryStore(),
      authenticate: () => ({ id: 'anon' }),
      maxUploadSize: 5,
    });
    let posts = 0;
    const client = new SwordClient({
      serviceUrl: `${BASE}/service-document`,
      fetch: async (input, init) => {
        const req = new Request(input, init);
        if (req.method === 'POST') posts++;
        return server.handle(req);
      },
    });
    await expect(client.depositMeca(meca())).rejects.toMatchObject({
      type: 'MaxUploadSizeExceeded',
    });
    expect(posts).toBe(0);
  });

  it('lists collections and deposits into one with an API key', async () => {
    const server = new SwordServer({
      baseUrl: BASE,
      store: new MemoryStore(),
      authenticate: anyAuth(basicAuth({ alice: 'secret' }), apiKeyAuth({ k1: 'ops' })),
      collections: [
        { id: 'articles', title: 'Articles' },
        { id: 'reviews', title: 'Reviews' },
      ],
    });
    const client = new SwordClient({
      serviceUrl: `${BASE}/service-document`,
      apiKey: 'k1',
      fetch: async (input, init) => server.handle(new Request(input, init)),
    });
    const collections = await client.getCollections();
    expect(collections.map((c) => c.title)).toEqual(['Articles', 'Reviews']);
    const { status } = await client.depositMeca(meca(), { collection: collections[1].url });
    expect(status.service).toBe(`${BASE}/collections/reviews`);
    expect(status.links[0].depositedBy).toBe('ops');
  });
});
