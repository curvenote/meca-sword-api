import {
  computeDigest,
  ErrorTypes,
  FileState,
  formatContentDisposition,
  Header,
  isSupportedDigest,
  JSON_LD,
  MetadataFormat,
  Packaging,
  parseContentDisposition,
  parseDigest,
  Rel,
  State,
  SWORD_CONTEXT,
  SWORD_VERSION,
  SwordError,
  ZIP,
} from '@curvenote/sword-common';
import type {
  Actions,
  MetadataDocument,
  ServiceDocument,
  StateURI,
  StatusDocument,
} from '@curvenote/sword-common';
import { inspectMeca, mecaToMetadata } from '@curvenote/sword-common/meca';
import type { MecaInspection } from '@curvenote/sword-common/meca';
import { AuthenticationFailed, type Authenticator } from './auth.js';
import type { DepositRecord, Principal, StoredFile, SwordStore } from './types.js';

export type Collection = {
  /** URL-safe identifier, used in the collection's Service-URL */
  id: string;
  title: string;
  abstract?: string;
};

export type SwordServerOptions = {
  /** Absolute URL at which the handler is mounted, e.g. `https://example.org/sword` */
  baseUrl: string;
  store: SwordStore;
  /** Required: return a principal, `null` for missing credentials, or throw `AuthenticationFailed` */
  authenticate: Authenticator;
  title?: string;
  abstract?: string;
  /**
   * Optional collections (e.g. journal sections). Each gets its own Service-URL, listed
   * as a sub-service in the root service document, and deposits record which one they used.
   */
  collections?: Collection[];
  /** Authentication schemes advertised in the service document (default `['Basic']`) */
  authentication?: string[];
  /** Maximum package size in bytes (default 1 GiB) */
  maxUploadSize?: number;
  /** Reject package deposits that have no Digest header (default true, per spec) */
  requireDigest?: boolean;
  /** Reject packages that fail MECA inspection (default true) */
  rejectInvalidMeca?: boolean;
  /** State a newly received package is placed in (default inWorkflow) */
  initialState?: StateURI;
  /** Custom MECA inspection, e.g. to add DTD validation */
  inspect?: (data: Uint8Array) => MecaInspection | Promise<MecaInspection>;
  /** Called after a deposit has been stored */
  onDeposit?: (record: DepositRecord, principal: Principal) => void | Promise<void>;
};

const ACCEPT_PACKAGING = [Packaging.MECA, Packaging.Binary, Packaging.SimpleZip];
const JSON_TYPES = [JSON_LD, 'application/json'];
const DEFAULT_MAX_UPLOAD = 1024 ** 3;

const ACTIONS: Actions = {
  getMetadata: true,
  getFiles: true,
  appendMetadata: false,
  appendFiles: false,
  replaceMetadata: true,
  replaceFiles: false,
  deleteMetadata: false,
  deleteFiles: false,
  deleteObject: true,
};

type Route =
  | { kind: 'service'; collection?: Collection }
  | { kind: 'object'; id: string }
  | { kind: 'metadata'; id: string }
  | { kind: 'fileset'; id: string }
  | { kind: 'file'; id: string; name: string };

export class SwordServer {
  readonly baseUrl: string;
  readonly store: SwordStore;
  private readonly opts: SwordServerOptions;
  private readonly basePath: string;

  constructor(opts: SwordServerOptions) {
    this.opts = opts;
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.basePath = new URL(this.baseUrl).pathname.replace(/\/+$/, '');
    this.store = opts.store;
  }

  get serviceUrl() {
    return `${this.baseUrl}/service-document`;
  }
  collectionUrl(id: string) {
    return `${this.baseUrl}/collections/${encodeURIComponent(id)}`;
  }
  get collections(): Collection[] {
    return this.opts.collections ?? [];
  }
  objectUrl(id: string) {
    return `${this.baseUrl}/objects/${encodeURIComponent(id)}`;
  }
  metadataUrl(id: string) {
    return `${this.objectUrl(id)}/metadata`;
  }
  fileSetUrl(id: string) {
    return `${this.objectUrl(id)}/fileset`;
  }
  fileUrl(id: string, name: string) {
    return `${this.objectUrl(id)}/files/${encodeURIComponent(name)}`;
  }

  /** Fetch-style handler: works with Bun.serve, Hono, React Router, Next.js route handlers, etc. */
  handle = async (req: Request): Promise<Response> => {
    try {
      const route = this.route(new URL(req.url).pathname);
      if (!route) throw new SwordError('NotFound', 'Not found');
      const principal = await this.authenticate(req);
      switch (route.kind) {
        case 'service':
          if (req.method === 'GET') return json(this.serviceDocument(route.collection?.id));
          if (req.method === 'POST') return await this.deposit(req, principal, route.collection);
          throw methodNotAllowed('GET, POST');
        case 'object':
          if (req.method === 'GET') return await this.getStatus(route.id);
          if (req.method === 'DELETE') return await this.deleteObject(req, route.id);
          throw methodNotAllowed('GET, DELETE');
        case 'metadata':
          if (req.method === 'GET') return await this.getMetadata(route.id);
          if (req.method === 'PUT') return await this.replaceMetadata(req, route.id);
          throw methodNotAllowed('GET, PUT');
        case 'fileset':
          throw methodNotAllowed('');
        case 'file':
          if (req.method === 'GET') return await this.getFile(route.id, route.name);
          throw methodNotAllowed('GET');
      }
    } catch (error) {
      return toErrorResponse(error);
    }
  };

  /** The root service document, or a collection's when `collectionId` is given */
  serviceDocument(collectionId?: string): ServiceDocument {
    const maxUploadSize = this.opts.maxUploadSize ?? DEFAULT_MAX_UPLOAD;
    const collection = this.collections.find((c) => c.id === collectionId);
    if (collectionId && !collection) {
      throw new SwordError('NotFound', `Collection not found: ${collectionId}`);
    }
    const title = this.opts.title ?? 'MECA SWORD Service';
    return {
      '@context': SWORD_CONTEXT,
      '@id': collection ? this.collectionUrl(collection.id) : this.serviceUrl,
      '@type': 'ServiceDocument',
      'dc:title': collection ? collection.title : title,
      'dcterms:abstract': collection
        ? (collection.abstract ?? `${collection.title} in ${title}`)
        : (this.opts.abstract ?? 'Accepts MECA manuscript packages over SWORD v3'),
      root: this.serviceUrl,
      version: SWORD_VERSION,
      acceptDeposits: true,
      accept: [ZIP],
      acceptArchiveFormat: [ZIP],
      acceptPackaging: ACCEPT_PACKAGING,
      acceptMetadata: [MetadataFormat.Default],
      maxUploadSize,
      byReferenceDeposit: false,
      onBehalfOf: false,
      digest: ['SHA-256', 'SHA'],
      authentication: this.opts.authentication ?? ['Basic'],
      services: collection ? [] : this.collections.map((c) => this.serviceDocument(c.id)),
    };
  }

  /** Change the state of a deposit, e.g. when an editor accepts or rejects it */
  async setState(id: string, state: StateURI, description?: string) {
    const record = await this.requireRecord(id);
    record.state = state;
    record.stateDescription = description;
    touch(record);
    await this.store.save(record);
    return record;
  }

  async statusDocument(record: DepositRecord): Promise<StatusDocument> {
    return {
      '@context': SWORD_CONTEXT,
      '@id': this.objectUrl(record.id),
      '@type': 'Status',
      eTag: record.eTag,
      metadata: { '@id': this.metadataUrl(record.id), eTag: record.metadataETag },
      fileSet: { '@id': this.fileSetUrl(record.id), eTag: fileSetETag(record) },
      service: record.collection ? this.collectionUrl(record.collection) : this.serviceUrl,
      state: [
        {
          '@id': record.state,
          ...(record.stateDescription ? { description: record.stateDescription } : {}),
        },
      ],
      actions: ACTIONS,
      links: record.files.map((file) => ({
        '@id': this.fileUrl(record.id, file.name),
        rel: [Rel.OriginalDeposit, Rel.FileSetFile],
        contentType: file.contentType,
        packaging: file.packaging,
        depositedOn: file.depositedOn,
        depositedBy: file.depositedBy,
        status: FileState.Ingested,
        eTag: file.eTag,
      })),
    };
  }

  private route(pathname: string): Route | undefined {
    if (!pathname.startsWith(this.basePath)) return undefined;
    const rest = pathname.slice(this.basePath.length).replace(/\/+$/, '');
    if (rest === '' || rest === '/service-document') return { kind: 'service' };
    const parts = rest.split('/').filter(Boolean).map(decodeURIComponent);
    if (parts[0] === 'collections' && parts.length === 2) {
      const collection = this.collections.find((c) => c.id === parts[1]);
      return collection ? { kind: 'service', collection } : undefined;
    }
    if (parts[0] !== 'objects' || !parts[1]) return undefined;
    const id = parts[1];
    if (parts.length === 2) return { kind: 'object', id };
    if (parts.length === 3 && parts[2] === 'metadata') return { kind: 'metadata', id };
    if (parts.length === 3 && parts[2] === 'fileset') return { kind: 'fileset', id };
    if (parts.length === 4 && parts[2] === 'files') return { kind: 'file', id, name: parts[3] };
    return undefined;
  }

  private async authenticate(req: Request): Promise<Principal> {
    let principal: Principal | null;
    try {
      principal = await this.opts.authenticate(req);
    } catch (error) {
      if (error instanceof AuthenticationFailed) {
        throw new SwordError('AuthenticationFailed', error.message);
      }
      throw error;
    }
    if (!principal) throw new SwordError('AuthenticationRequired', 'Authentication required');
    return principal;
  }

  private async deposit(
    req: Request,
    principal: Principal,
    collection?: Collection,
  ): Promise<Response> {
    if (req.headers.get(Header.OnBehalfOf)) {
      throw new SwordError('OnBehalfOfNotAllowed', 'This server does not support On-Behalf-Of');
    }
    const disposition = parseContentDisposition(req.headers.get(Header.ContentDisposition));
    if (disposition.byReference) {
      throw new SwordError('ByReferenceNotAllowed', 'By-Reference deposit is not supported');
    }
    if (disposition.segment) {
      throw new SwordError('BadRequest', 'Segmented upload is not supported');
    }
    if (disposition.metadata) return this.depositMetadata(req, principal, collection);
    return this.depositPackage(req, principal, disposition.filename, collection);
  }

  private async depositMetadata(
    req: Request,
    principal: Principal,
    collection?: Collection,
  ): Promise<Response> {
    const metadata = await readMetadata(req);
    const id = await this.newId(req.headers.get(Header.Slug));
    const now = new Date().toISOString();
    const record: DepositRecord = {
      id,
      createdAt: now,
      updatedAt: now,
      depositedBy: principal.id,
      ...(collection ? { collection: collection.id } : {}),
      state: State.InProgress,
      stateDescription: 'Metadata received; no MECA package deposited',
      eTag: newETag(),
      metadata: { ...metadata, '@id': this.metadataUrl(id) },
      metadataETag: newETag(),
      files: [],
    };
    await this.store.save(record);
    await this.opts.onDeposit?.(record, principal);
    return this.created(record);
  }

  private async depositPackage(
    req: Request,
    principal: Principal,
    filename?: string,
    collection?: Collection,
  ): Promise<Response> {
    const contentType = mediaType(req.headers.get(Header.ContentType));
    if (contentType !== ZIP) {
      throw new SwordError(
        'ContentTypeNotAcceptable',
        `Content-Type must be ${ZIP} for a MECA package, got "${contentType || 'none'}"`,
      );
    }
    const packaging = req.headers.get(Header.Packaging) ?? Packaging.Binary;
    if (!(ACCEPT_PACKAGING as string[]).includes(packaging)) {
      throw new SwordError(
        'PackagingFormatNotAcceptable',
        `Packaging "${packaging}" is not accepted`,
        { log: `Accepted packaging: ${ACCEPT_PACKAGING.join(', ')}` },
      );
    }
    const maxUploadSize = this.opts.maxUploadSize ?? DEFAULT_MAX_UPLOAD;
    const declared = Number(req.headers.get('Content-Length') ?? NaN);
    if (declared > maxUploadSize) {
      throw new SwordError('MaxUploadSizeExceeded', `Package exceeds ${maxUploadSize} bytes`);
    }
    const data = await readBody(req, maxUploadSize);
    if (data.byteLength === 0) throw new SwordError('ContentMalformed', 'Empty request body');

    const sha256 = await computeDigest(data, 'SHA-256');
    await this.checkDigest(req, data, sha256);

    const inspection = await (this.opts.inspect ?? inspectMeca)(data);
    if (!inspection.valid && this.opts.rejectInvalidMeca !== false) {
      throw new SwordError('ContentMalformed', 'Package is not a valid MECA bundle', {
        log: inspection.errors.join('\n'),
      });
    }

    const id = await this.newId(req.headers.get(Header.Slug));
    const now = new Date().toISOString();
    const name = sanitizeFilename(filename) ?? `${id}-meca.zip`;
    const file: StoredFile = {
      name,
      contentType: ZIP,
      packaging,
      size: data.byteLength,
      sha256,
      eTag: newETag(),
      depositedOn: now,
      depositedBy: principal.id,
    };
    const { files, ...summary } = inspection;
    const record: DepositRecord = {
      id,
      createdAt: now,
      updatedAt: now,
      depositedBy: principal.id,
      ...(collection ? { collection: collection.id } : {}),
      state: this.opts.initialState ?? State.InWorkflow,
      stateDescription: inspection.valid
        ? 'MECA package received'
        : 'Package received but failed MECA inspection',
      eTag: newETag(),
      metadata: mecaToMetadata(inspection, this.metadataUrl(id)),
      metadataETag: newETag(),
      files: [file],
      meca: { ...summary, fileCount: files.length },
    };
    await this.store.save(record, [{ name, data }]);
    await this.opts.onDeposit?.(record, principal);
    return this.created(record);
  }

  private async checkDigest(req: Request, data: Uint8Array, sha256: string) {
    const digests = parseDigest(req.headers.get(Header.Digest));
    const algorithms = Object.keys(digests).filter(isSupportedDigest);
    if (algorithms.length === 0) {
      if (this.opts.requireDigest === false) return;
      throw new SwordError('DigestMismatch', 'A Digest header with SHA-256 is required');
    }
    for (const alg of algorithms) {
      const actual = alg === 'SHA-256' ? sha256 : await computeDigest(data, alg);
      if (actual !== digests[alg]) {
        throw new SwordError('DigestMismatch', `${alg} digest does not match the content`, {
          log: `expected ${digests[alg]}, computed ${actual}`,
        });
      }
    }
  }

  private async getStatus(id: string): Promise<Response> {
    const record = await this.requireRecord(id);
    return json(await this.statusDocument(record), 200, { ETag: record.eTag });
  }

  private async getMetadata(id: string): Promise<Response> {
    const record = await this.requireRecord(id);
    return json(record.metadata, 200, { ETag: record.metadataETag });
  }

  private async replaceMetadata(req: Request, id: string): Promise<Response> {
    const record = await this.requireRecord(id);
    checkIfMatch(req, record.eTag, record.metadataETag);
    const metadata = await readMetadata(req);
    record.metadata = { ...metadata, '@id': this.metadataUrl(id) };
    record.metadataETag = newETag();
    touch(record);
    await this.store.save(record);
    return new Response(null, { status: 204, headers: { ETag: record.eTag } });
  }

  private async deleteObject(req: Request, id: string): Promise<Response> {
    const record = await this.requireRecord(id);
    checkIfMatch(req, record.eTag);
    await this.store.delete(id);
    return new Response(null, { status: 204 });
  }

  private async getFile(id: string, name: string): Promise<Response> {
    const record = await this.requireRecord(id);
    const file = record.files.find((f) => f.name === name);
    const data = file ? await this.store.getFile(id, name) : undefined;
    if (!file || !data) throw new SwordError('NotFound', `File not found: ${name}`);
    return new Response(data as Uint8Array<ArrayBuffer>, {
      status: 200,
      headers: {
        'Content-Type': file.contentType,
        'Content-Disposition': formatContentDisposition({ filename: file.name }),
        'Content-Length': String(data.byteLength),
        ETag: file.eTag,
        Digest: `SHA-256=${file.sha256}`,
        ...(file.packaging ? { Packaging: file.packaging } : {}),
      },
    });
  }

  private async requireRecord(id: string): Promise<DepositRecord> {
    const record = await this.store.get(id);
    if (!record) throw new SwordError('NotFound', `Object not found: ${id}`);
    return record;
  }

  private async newId(slug: string | null): Promise<string> {
    const cleaned = slug
      ?.trim()
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^[-.]+|-+$/g, '')
      .slice(0, 100);
    if (cleaned && !(await this.store.has(cleaned))) return cleaned;
    return crypto.randomUUID();
  }

  private async created(record: DepositRecord): Promise<Response> {
    return json(await this.statusDocument(record), 201, {
      Location: this.objectUrl(record.id),
      ETag: record.eTag,
    });
  }
}

export function createSwordServer(opts: SwordServerOptions) {
  return new SwordServer(opts);
}

function json(body: unknown, status = 200, headers?: Record<string, string>) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': JSON_LD, ...headers },
  });
}

function toErrorResponse(error: unknown): Response {
  if (error instanceof SwordError) {
    const headers: Record<string, string> = {};
    if (error.type === 'AuthenticationRequired')
      headers['WWW-Authenticate'] = 'Basic realm="SWORD"';
    if (error.type === 'MethodNotAllowed' && error.log) headers.Allow = error.log;
    return error.toResponse(headers);
  }
  const message = error instanceof Error ? error.message : String(error);
  return new SwordError('BadRequest', 'Internal server error', {
    status: 500,
    log: message,
  }).toResponse();
}

function methodNotAllowed(allow: string) {
  return new SwordError('MethodNotAllowed', 'Method not allowed', {
    status: ErrorTypes.MethodNotAllowed,
    log: allow,
  });
}

function mediaType(header: string | null) {
  return header?.split(';')[0].trim().toLowerCase() ?? '';
}

async function readMetadata(req: Request): Promise<MetadataDocument> {
  const format = req.headers.get(Header.MetadataFormat) ?? MetadataFormat.Default;
  if (format !== MetadataFormat.Default) {
    throw new SwordError('MetadataFormatNotAcceptable', `Metadata format "${format}" not accepted`);
  }
  const contentType = mediaType(req.headers.get(Header.ContentType));
  if (!JSON_TYPES.includes(contentType)) {
    throw new SwordError('ContentTypeNotAcceptable', `Metadata must be sent as ${JSON_LD}`);
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new SwordError('ContentMalformed', 'Metadata body is not valid JSON');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new SwordError('ContentMalformed', 'Metadata body must be a JSON object');
  }
  const doc = body as Record<string, unknown>;
  if (doc['@type'] && doc['@type'] !== 'Metadata') {
    throw new SwordError('ContentMalformed', 'Metadata document @type must be "Metadata"');
  }
  return { ...doc, '@context': SWORD_CONTEXT, '@type': 'Metadata' } as MetadataDocument;
}

/** Read a request body, giving up as soon as it passes `limit` (chunked bodies have no length) */
async function readBody(req: Request, limit: number): Promise<Uint8Array> {
  const tooBig = () => new SwordError('MaxUploadSizeExceeded', `Package exceeds ${limit} bytes`);
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => undefined);
      throw tooBig();
    }
    chunks.push(value);
  }
  const data = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    data.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return data;
}

function checkIfMatch(req: Request, ...etags: string[]) {
  const ifMatch = req.headers.get(Header.IfMatch);
  if (!ifMatch || ifMatch.trim() === '*') return;
  const supplied = ifMatch.split(',').map((t) => t.trim().replace(/^W\//, '').replace(/"/g, ''));
  if (!supplied.some((t) => etags.includes(t))) {
    throw new SwordError('ETagNotMatched', 'If-Match does not match the current ETag');
  }
}

function sanitizeFilename(name?: string) {
  if (!name) return undefined;
  const base = name
    .split(/[\\/]/)
    .pop()
    ?.replace(/[^A-Za-z0-9._-]+/g, '_');
  return base && !base.startsWith('.') ? base : undefined;
}

function newETag() {
  return crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}

function fileSetETag(record: DepositRecord) {
  return record.files.map((f) => f.eTag).join('.') || 'empty';
}

function touch(record: DepositRecord) {
  record.updatedAt = new Date().toISOString();
  record.eTag = newETag();
}
