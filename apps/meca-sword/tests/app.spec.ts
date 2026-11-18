import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SwordClient } from '@curvenote/sword-client';
import { State } from '@curvenote/sword-common';
import { buildMeca } from '@curvenote/sword-common/meca';
import { createApiKey } from '@/lib/api-keys.server';
import { LocalBlobStore, setBlobs } from '@/lib/blobs.server';
import { setConfig } from '@/lib/config.server';
import { decrypt, encrypt } from '@/lib/crypto.server';
import { db } from '@/lib/db.server';
import { addPackage, sendPackages } from '@/lib/packages.server';
import { getSword } from '@/lib/sword.server';
import { ARTICLE, TRANSFER } from '../../../packages/sword-common/tests/fixtures';
import { TEST_DATABASE_URL } from './global-setup';

const PUBLIC = 'http://receiver.test';
const SERVICE = `${PUBLIC}/sword/service-document`;
const run = crypto.randomUUID().slice(0, 8);
const DEPOSITOR = `depositor-${run}@example.org`;
const PENDING = `pending-${run}@example.org`;
const files = fs.mkdtempSync(path.join(os.tmpdir(), 'meca-sword-app-'));

setConfig({
  title: 'Journal of Examples',
  publicUrl: PUBLIC,
  collections: [{ id: 'articles', title: 'Articles' }],
  database: { url: TEST_DATABASE_URL },
  session: { secret: 'test' },
  encryptionKey: 'test-key',
});
setBlobs(new LocalBlobStore(files));

const handler: typeof fetch = async (input, init) =>
  (await getSword()).handle(new Request(input, init));
const client = (auth: { apiKey?: string; username?: string; password?: string }) =>
  new SwordClient({ serviceUrl: SERVICE, fetch: handler, ...auth });
const meca = () => buildMeca({ article: ARTICLE, transfer: TRANSFER });

let key: string;

beforeAll(async () => {
  const prisma = await db();
  await prisma.user.createMany({
    data: [
      { email: DEPOSITOR, status: 'active' },
      { email: PENDING, status: 'pending' },
    ],
  });
  ({ key } = await createApiKey(DEPOSITOR, 'ingest'));
});

afterAll(async () => {
  await (await db()).$disconnect();
  fs.rmSync(files, { recursive: true, force: true });
});

describe('SWORD deposits with API keys', () => {
  it('needs a key', async () => {
    const res = await handler(SERVICE);
    expect(res.status).toBe(401);
  });

  it('refuses unknown keys', async () => {
    const res = await handler(SERVICE, { headers: { Authorization: 'APIKey msk_nope' } });
    expect(res.status).toBe(403);
  });

  it('accepts a key as APIKey or as a Basic password', async () => {
    expect((await client({ apiKey: key }).getServiceDocument())['dc:title']).toBe(
      'Journal of Examples',
    );
    const basic = client({ username: 'anything', password: key });
    expect((await basic.getServiceDocument()).services?.[0]['dc:title']).toBe('Articles');
  });

  it('stores deposits in Postgres and the blob store, as the key owner', async () => {
    const result = await client({ apiKey: key }).depositMeca(meca(), { filename: 'paper.zip' });
    const id = result.location.split('/').pop()!;
    const row = await (await db()).deposit.findUnique({ where: { id } });
    expect(row?.depositedBy).toBe(DEPOSITOR);
    expect(row?.title).toBe('Exchanging Manuscripts over SWORD');
    expect(fs.existsSync(path.join(files, 'deposits', id, 'paper.zip'))).toBe(true);

    await (await getSword()).setState(id, State.Ingested, 'Accepted');
    const status = await client({ apiKey: key }).getStatus(result.location);
    expect(status.state[0]['@id']).toBe(State.Ingested);
    const stored = await (await db()).apiKey.findMany({ where: { ownerEmail: DEPOSITOR } });
    expect(stored.every((k) => k.hash !== key && !k.hash.includes(key))).toBe(true);
    expect(stored.find((k) => k.name === 'ingest')?.lastUsedAt).toBeTruthy();
  });

  it('refuses revoked keys and keys of people who are not active', async () => {
    const { key: pendingKey } = await createApiKey(PENDING, 'x');
    await expect(client({ apiKey: pendingKey }).getServiceDocument()).rejects.toMatchObject({
      type: 'AuthenticationFailed',
    });
    const { key: revoked, row } = await createApiKey(DEPOSITOR, 'old');
    await (await db()).apiKey.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
    await expect(client({ apiKey: revoked }).getServiceDocument()).rejects.toMatchObject({
      type: 'AuthenticationFailed',
    });
  });
});

describe('packages and sending', () => {
  it('builds a package from loose files and sends it to this server', async () => {
    const result = await addPackage(
      [
        new File([ARTICLE], 'paper.xml', { type: 'application/xml' }),
        new File(['%PDF-1.4'], 'paper.pdf', { type: 'application/pdf' }),
      ],
      DEPOSITOR,
    );
    if (!('id' in result)) throw new Error(result.error);
    const sword = await getSword();
    await sendPackages([result.id], 'self', sword.collectionUrl('articles'), DEPOSITOR);
    const sent = await (
      await db()
    ).sentDeposit.findFirstOrThrow({
      where: { packageId: result.id },
    });
    expect(sent.error).toBeNull();
    expect(sent.collection).toBe('Articles');
    expect(sent.state).toBe(State.InWorkflow);
    const id = sent.objectUrl!.split('/').pop()!;
    const received = await sword.store.get(id);
    expect(received?.collection).toBe('articles');
    expect(received?.depositedBy).toBe(DEPOSITOR);
    expect(received?.meca?.transfer?.destination?.provider?.name).toBe(
      'Journal of Examples (this server)',
    );
  });
});

describe('destination credentials', () => {
  it('round-trip through AES-GCM and are not stored in plain text', async () => {
    const secret = await encrypt('hunter2');
    expect(secret).not.toContain('hunter2');
    expect(secret.startsWith('v1.')).toBe(true);
    expect(await decrypt(secret)).toBe('hunter2');
    const tampered = secret.slice(0, -2) + (secret.endsWith('A') ? 'BB' : 'AA');
    await expect(decrypt(tampered)).rejects.toThrow();
  });
});
