import crypto from 'node:crypto';
import { AuthenticationFailed, parseBasicAuth } from '@curvenote/sword-server';
import type { Principal } from '@curvenote/sword-server';
import { db } from './db.server';
import { sha256 } from './crypto.server';

const PREFIX = 'msk_';

/** Create a key for `ownerEmail`; the key is returned once and only its hash is kept */
export async function createApiKey(ownerEmail: string, name: string) {
  const key = `${PREFIX}${crypto.randomBytes(24).toString('base64url')}`;
  const row = await (
    await db()
  ).apiKey.create({
    data: { name, ownerEmail, prefix: key.slice(0, PREFIX.length + 6), hash: sha256(key) },
  });
  return { key, row };
}

/** The key from `Authorization: APIKey <key>`, or the password of HTTP Basic */
export function keyFromRequest(req: Request): string | undefined {
  const header = req.headers.get('Authorization');
  const apiKey = header?.match(/^APIKey\s+(.+)$/i)?.[1]?.trim();
  if (apiKey) return apiKey;
  return parseBasicAuth(header)?.password || undefined;
}

/**
 * SWORD authentication with API keys. No key: `null` (401). Unknown, revoked, or owned by
 * someone who isn't active: `AuthenticationFailed` (403).
 */
export async function authenticateApiKey(req: Request): Promise<Principal | null> {
  const key = keyFromRequest(req);
  if (!key) return null;
  const prisma = await db();
  const row = await prisma.apiKey.findUnique({
    where: { hash: sha256(key) },
    include: { owner: true },
  });
  if (!row || row.revokedAt || row.owner.status !== 'active') {
    throw new AuthenticationFailed('Invalid API key');
  }
  const stale = !row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000;
  if (stale) {
    await prisma.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
  }
  return { id: row.ownerEmail, name: row.name };
}
