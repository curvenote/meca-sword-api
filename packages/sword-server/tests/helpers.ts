import fs from 'node:fs';
import path from 'node:path';
import { Ajv } from 'ajv';
import { computeDigest } from '@curvenote/sword-common';
import { buildMeca } from '@curvenote/sword-common/meca';
import { basicAuth, MemoryStore, SwordServer } from '../src/index.js';
import type { SwordServerOptions } from '../src/index.js';
import { ARTICLE, TRANSFER } from '../../sword-common/tests/fixtures.js';

export const BASE = 'http://sword.test/api/sword';
export const AUTH = `Basic ${btoa('alice:secret')}`;

export function makeServer(opts: Partial<SwordServerOptions> = {}) {
  return new SwordServer({
    baseUrl: BASE,
    store: new MemoryStore(),
    authenticate: basicAuth({ alice: 'secret' }),
    ...opts,
  });
}

export const meca = () => buildMeca({ article: ARTICLE, transfer: TRANSFER });

export async function depositRequest(
  data: Uint8Array,
  headers: Record<string, string> = {},
): Promise<Request> {
  return new Request(`${BASE}/service-document`, {
    method: 'POST',
    headers: {
      Authorization: AUTH,
      'Content-Type': 'application/zip',
      'Content-Disposition': 'attachment; filename="test-meca.zip"',
      Digest: `SHA-256=${await computeDigest(data)}`,
      ...headers,
    },
    body: data as Uint8Array<ArrayBuffer>,
  });
}

const ajv = new Ajv({ strict: false, allErrors: true });
const schemaDir = path.join(__dirname, 'schemas');

/** The published SWORD schemas reuse nested `$id`s, which Ajv rejects; strip all but the root */
function stripNestedIds(node: unknown, root = true): unknown {
  if (Array.isArray(node)) return node.map((n) => stripNestedIds(n, false));
  if (!node || typeof node !== 'object') return node;
  return Object.fromEntries(
    Object.entries(node)
      .filter(([key]) => root || key !== '$id')
      .map(([key, value]) => [key, stripNestedIds(value, false)]),
  );
}
const load = (name: string) =>
  ajv.compile(
    stripNestedIds(JSON.parse(fs.readFileSync(path.join(schemaDir, name), 'utf8'))) as object,
  );
export const validators = {
  service: load('service-document.schema.json'),
  status: load('status.schema.json'),
  metadata: load('metadata.schema.json'),
  error: load('error.schema.json'),
};

export function expectValid(kind: keyof typeof validators, doc: unknown) {
  const validate = validators[kind];
  if (!validate(doc)) {
    throw new Error(`${kind} document failed schema: ${ajv.errorsText(validate.errors)}`);
  }
}
