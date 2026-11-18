import crypto from 'node:crypto';
import { getConfig } from './config.server';

/** SHA-256 hex, for API keys */
export function sha256(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

async function key() {
  const { encryptionKey } = await getConfig();
  return crypto.createHash('sha256').update(encryptionKey).digest();
}

/** AES-256-GCM, as `v1.<iv>.<tag>.<ciphertext>` in base64url */
export async function encrypt(plaintext: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', await key(), iv);
  const data = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), data]
    .map((p) => (typeof p === 'string' ? p : p.toString('base64url')))
    .join('.');
}

export async function decrypt(value: string) {
  const [version, iv, tag, data] = value.split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unreadable secret');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    await key(),
    Buffer.from(iv, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(data, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
