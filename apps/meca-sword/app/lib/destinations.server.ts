import { SwordClient } from '@curvenote/sword-client';
import { Packaging, SwordError } from '@curvenote/sword-common';
import type { Destination as DestinationRow } from '@/generated/prisma/client';
import { getConfig } from './config.server';
import { decrypt, encrypt } from './crypto.server';
import { db } from './db.server';
import { getSword, loopbackFetch } from './sword.server';

export const SELF = 'self';

export type DestinationCollection = { url: string; title: string };

/** A destination as the UI sees it: never its secret */
export type Destination = {
  id: string;
  name: string;
  serviceUrl: string;
  collections: DestinationCollection[];
  credentials?: string;
  maxUploadSize?: number;
  acceptsMeca?: boolean;
  checkedAt?: string;
  error?: string;
  builtIn?: boolean;
};

export type Credentials = { username?: string; password?: string; apiKey?: string };

function toDestination(row: DestinationRow): Destination {
  return {
    id: row.id,
    name: row.name,
    serviceUrl: row.serviceUrl,
    collections: row.collections as DestinationCollection[],
    credentials:
      row.secretKind === 'apiKey'
        ? 'API key'
        : row.secretKind === 'password'
          ? `user ${row.username}`
          : undefined,
    maxUploadSize: row.maxUploadSize ?? undefined,
    acceptsMeca: row.acceptsMeca ?? undefined,
    checkedAt: row.checkedAt?.toISOString(),
    error: row.error ?? undefined,
  };
}

/** This server, always offered as a destination for trying things out */
export async function selfDestination(): Promise<Destination> {
  const [config, sword] = await Promise.all([getConfig(), getSword()]);
  return {
    id: SELF,
    name: `${config.title} (this server)`,
    serviceUrl: sword.serviceUrl,
    collections: sword.collections.map((c) => ({ url: sword.collectionUrl(c.id), title: c.title })),
    acceptsMeca: true,
    builtIn: true,
  };
}

export async function listDestinations(): Promise<Destination[]> {
  const rows = await (await db()).destination.findMany({ orderBy: { createdAt: 'asc' } });
  return [await selfDestination(), ...rows.map(toDestination)];
}

export async function getDestination(id: string): Promise<Destination | undefined> {
  if (id === SELF) return selfDestination();
  const row = await (await db()).destination.findUnique({ where: { id } });
  return row ? toDestination(row) : undefined;
}

/** Requests to other servers don't follow redirects, so a destination can't bounce us elsewhere */
const noRedirectFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, redirect: 'manual' });

/** A SWORD client for a destination, acting as `email` when it's this server */
export async function clientFor(destinationId: string, serviceUrl: string, email: string) {
  if (destinationId === SELF) return new SwordClient({ serviceUrl, fetch: loopbackFetch(email) });
  const row = await (await db()).destination.findUnique({ where: { id: destinationId } });
  if (!row) throw new Error('Unknown destination');
  return clientWith(serviceUrl, await credentialsOf(row));
}

function clientWith(serviceUrl: string, creds: Credentials) {
  return new SwordClient({
    serviceUrl,
    apiKey: creds.apiKey,
    username: creds.apiKey ? undefined : creds.username,
    password: creds.apiKey ? undefined : creds.password,
    fetch: noRedirectFetch,
  });
}

async function credentialsOf(row: DestinationRow): Promise<Credentials> {
  if (!row.secret) return {};
  const secret = await decrypt(row.secret);
  return row.secretKind === 'apiKey'
    ? { apiKey: secret }
    : { username: row.username ?? undefined, password: secret };
}

/** Read a service document and record what the destination offers */
async function discover(serviceUrl: string, creds: Credentials) {
  try {
    const doc = await clientWith(serviceUrl, creds).getServiceDocument();
    return {
      name: doc['dc:title'] || new URL(serviceUrl).host,
      collections: (doc.services ?? []).map((s) => ({ url: s['@id'], title: s['dc:title'] })),
      maxUploadSize: doc.maxUploadSize ? Math.min(doc.maxUploadSize, 2 ** 31 - 1) : null,
      acceptsMeca: (doc.acceptPackaging ?? []).includes(Packaging.MECA),
      checkedAt: new Date(),
      error: null,
    };
  } catch (error) {
    return { checkedAt: new Date(), error: describe(error) };
  }
}

/** Add a destination by Service-URL (or update the one with that URL) */
export async function saveDestination(serviceUrl: string, creds: Credentials) {
  const url = new URL(serviceUrl);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Use an http(s) URL');
  const prisma = await db();
  const existing = await prisma.destination.findUnique({ where: { serviceUrl } });
  const secret = creds.apiKey || creds.password;
  const secretFields = secret
    ? {
        secret: await encrypt(secret),
        secretKind: creds.apiKey ? 'apiKey' : 'password',
        username: creds.apiKey ? null : (creds.username ?? null),
      }
    : {};
  const effective = secret ? creds : existing ? await credentialsOf(existing) : {};
  const found = await discover(serviceUrl, effective);
  const data = { ...secretFields, ...found };
  const row = existing
    ? await prisma.destination.update({ where: { id: existing.id }, data })
    : await prisma.destination.create({
        data: { serviceUrl, name: url.host, ...data },
      });
  return toDestination(row);
}

export async function refreshDestination(id: string) {
  const prisma = await db();
  const row = await prisma.destination.findUnique({ where: { id } });
  if (!row) return undefined;
  const found = await discover(row.serviceUrl, await credentialsOf(row));
  return toDestination(await prisma.destination.update({ where: { id }, data: found }));
}

export async function deleteDestination(id: string) {
  await (await db()).destination.deleteMany({ where: { id } });
}

export function describe(error: unknown) {
  if (error instanceof SwordError) return `${error.type}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}
