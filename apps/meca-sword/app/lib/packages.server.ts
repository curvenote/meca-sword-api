import { inspectMeca, buildMecaFromFiles, setTransfer } from '@curvenote/sword-common/meca';
import type { InputFile } from '@curvenote/sword-common/meca';
import type { Package } from '@/generated/prisma/client';
import { blobs } from './blobs.server';
import { getConfig } from './config.server';
import { db } from './db.server';
import { clientFor, describe, getDestination } from './destinations.server';

const zipKey = (id: string) => `packages/${id}.zip`;

export async function readPackage(id: string) {
  const pkg = await (await db()).package.findUnique({ where: { id } });
  const data = pkg && (await (await blobs()).get(zipKey(pkg.id)));
  return pkg && data ? { pkg, data } : undefined;
}

/** Build a MECA package from uploaded files (or keep an uploaded MECA zip as it is) */
export async function addPackage(
  uploads: File[],
  createdBy: string,
): Promise<{ id: string } | { error: string; log?: string }> {
  const inputs: InputFile[] = await Promise.all(
    uploads.map(async (f) => ({ path: f.name, data: new Uint8Array(await f.arrayBuffer()) })),
  );
  let built;
  try {
    built = buildMecaFromFiles(inputs);
  } catch (error) {
    return { error: describe(error) };
  }
  if (!built.inspection.valid) {
    return { error: 'Not a valid MECA package', log: built.inspection.errors.join('\n') };
  }
  const id = crypto.randomUUID();
  const { article } = built.inspection;
  await (await blobs()).put(zipKey(id), built.data, 'application/zip');
  await (
    await db()
  ).package.create({
    data: {
      id,
      filename: built.passthrough ? uploads[0].name : `${id}-meca.zip`,
      createdBy,
      title: article?.title,
      authors: article?.authors?.join(', '),
      doi: article?.doi,
      size: built.data.byteLength,
      fileCount: built.inspection.files.length,
      built: !built.passthrough,
      notes: built.notes,
      warnings: built.inspection.warnings,
    },
  });
  return { id };
}

export async function deletePackage(id: string) {
  await (await blobs()).delete(zipKey(id));
  await (await db()).package.deleteMany({ where: { id } });
}

export function inspectPackage(data: Uint8Array) {
  return inspectMeca(data);
}

/**
 * Send packages to a destination (or one of its collections), recording each in the outbox.
 * Packages built here get a transfer.xml addressed to the destination.
 */
export async function sendPackages(
  ids: string[],
  destinationId: string,
  collectionUrl: string | undefined,
  sentBy: string,
) {
  const config = await getConfig();
  const dest = await getDestination(destinationId);
  if (!dest) throw new Error('Choose a destination');
  const collection = dest.collections.find((c) => c.url === collectionUrl);
  const serviceUrl = collection?.url ?? dest.serviceUrl;
  const client = await clientFor(dest.id, dest.serviceUrl, sentBy);
  const prisma = await db();
  for (const id of ids) {
    const found = await readPackage(id);
    if (!found) continue;
    const { pkg } = found;
    let { data } = found;
    if (pkg.built) data = addressTo(data, config.title, dest.name, collection?.title);
    const sent = {
      sentBy,
      packageId: pkg.id,
      filename: pkg.filename,
      size: data.byteLength,
      title: pkg.title,
      destinationId: dest.id,
      destination: dest.name,
      collection: collection?.title,
      serviceUrl,
    };
    try {
      const result = await client.depositMeca(data, {
        filename: pkg.filename,
        collection: collection?.url,
      });
      await prisma.sentDeposit.create({
        data: {
          ...sent,
          objectUrl: result.location,
          state: result.status.state[0]?.['@id'],
          stateDescription: result.status.state[0]?.description,
          checkedAt: new Date(),
        },
      });
    } catch (error) {
      await prisma.sentDeposit.create({ data: { ...sent, error: describe(error) } });
    }
  }
}

function addressTo(data: Uint8Array, source: string, destination: string, publication?: string) {
  return setTransfer(data, {
    source: { provider: { name: source } },
    destination: {
      provider: { name: destination },
      publication: { type: 'journal', title: publication ?? destination },
    },
  });
}

/** Re-read the status document of something we sent */
export async function refreshSent(id: string, email: string) {
  const prisma = await db();
  const sent = await prisma.sentDeposit.findUnique({ where: { id } });
  if (!sent?.objectUrl || !sent.destinationId) return;
  const update: { state?: string; stateDescription?: string | null; error: string | null } = {
    error: null,
  };
  try {
    const client = await clientFor(sent.destinationId, sent.serviceUrl, email);
    const status = await client.getStatus(sent.objectUrl);
    update.state = status.state[0]?.['@id'];
    update.stateDescription = status.state[0]?.description ?? null;
  } catch (error) {
    update.error = describe(error);
  }
  await prisma.sentDeposit.update({ where: { id }, data: { ...update, checkedAt: new Date() } });
}

export type { Package };
