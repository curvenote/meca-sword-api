import crypto from 'node:crypto';
import { AuthenticationFailed, SwordServer } from '@curvenote/sword-server';
import type { DepositRecord, Principal, SwordStore } from '@curvenote/sword-server';
import type { Prisma } from '@/generated/prisma/client';
import { authenticateApiKey } from './api-keys.server';
import { blobs } from './blobs.server';
import type { BlobStore } from './blobs.server';
import { getConfig } from './config.server';
import { safeEqual } from './crypto.server';
import { db } from './db.server';

export const SWORD_PATH = '/sword';

/** Deposits in Postgres (`Deposit.record`), their files in the blob store */
export class PrismaSwordStore implements SwordStore {
  constructor(private readonly files: () => Promise<BlobStore>) {}

  private key(id: string, name?: string) {
    return name === undefined ? `deposits/${id}/` : `deposits/${id}/${name}`;
  }

  async has(id: string) {
    return (await (await db()).deposit.count({ where: { id } })) > 0;
  }

  async get(id: string) {
    const row = await (await db()).deposit.findUnique({ where: { id } });
    return row ? (row.record as unknown as DepositRecord) : undefined;
  }

  async list() {
    const rows = await (await db()).deposit.findMany({ orderBy: { createdAt: 'desc' } });
    return rows.map((r) => r.record as unknown as DepositRecord);
  }

  async save(record: DepositRecord, files: { name: string; data: Uint8Array }[] = []) {
    const store = await this.files();
    for (const file of files) {
      const contentType = record.files.find((f) => f.name === file.name)?.contentType;
      await store.put(this.key(record.id, file.name), file.data, contentType);
    }
    const title = record.metadata['dc:title'];
    const columns = {
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt),
      depositedBy: record.depositedBy ?? null,
      collection: record.collection ?? null,
      state: record.state,
      title: typeof title === 'string' ? title : null,
      record: record as unknown as Prisma.InputJsonValue,
    };
    await (
      await db()
    ).deposit.upsert({
      where: { id: record.id },
      create: { id: record.id, ...columns },
      update: columns,
    });
  }

  async getFile(id: string, name: string) {
    return (await this.files()).get(this.key(id, name));
  }

  async delete(id: string) {
    await (await this.files()).delete(this.key(id));
    await (await db()).deposit.deleteMany({ where: { id } });
  }
}

/**
 * Sends to this server go straight to the handler instead of over the network. They carry a
 * token that only exists in this process, so the sender's own identity is trusted.
 */
const LOOPBACK_HEADER = 'X-MECA-Loopback';
const LOOPBACK_TOKEN = crypto.randomBytes(24).toString('base64url');

async function authenticate(req: Request): Promise<Principal | null> {
  const loopback = req.headers.get(LOOPBACK_HEADER);
  if (loopback) {
    const [token, email] = loopback.split(' ');
    if (!email || !safeEqual(token, LOOPBACK_TOKEN)) throw new AuthenticationFailed();
    return { id: email };
  }
  return authenticateApiKey(req);
}

let server: Promise<SwordServer> | undefined;

export function getSword(): Promise<SwordServer> {
  server ??= getConfig().then(
    (config) =>
      new SwordServer({
        baseUrl: `${config.publicUrl}${SWORD_PATH}`,
        store: new PrismaSwordStore(blobs),
        authenticate,
        authentication: ['APIKey', 'Basic'],
        title: config.title,
        collections: config.collections ?? [],
        maxUploadSize: config.maxUploadSize,
        onDeposit: (record, principal) => {
          const name = record.files[0]?.name ?? 'metadata';
          console.log(`Received ${name} from ${principal.id} -> ${record.id}`);
        },
      }),
  );
  return server;
}

/** A `fetch` that hands requests to this server's SWORD handler, acting as `email` */
export function loopbackFetch(email: string): typeof fetch {
  return async (input, init) => {
    const req = new Request(input, init);
    req.headers.set(LOOPBACK_HEADER, `${LOOPBACK_TOKEN} ${email}`);
    req.headers.delete('Authorization');
    return (await getSword()).handle(req);
  };
}
