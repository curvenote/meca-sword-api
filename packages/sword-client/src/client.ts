import {
  computeDigest,
  formatContentDisposition,
  Header,
  JSON_LD,
  MetadataFormat,
  Packaging,
  State,
  SWORD_CONTEXT,
  SwordError,
  ZIP,
} from '@curvenote/sword-common';
import type {
  ErrorDocument,
  MetadataDocument,
  ServiceDocument,
  StateURI,
  StatusDocument,
} from '@curvenote/sword-common';

export type SwordClientOptions = {
  /** The Service-URL (where the Service Document lives and deposits are POSTed) */
  serviceUrl: string;
  username?: string;
  password?: string;
  /** Sent as `Authorization: APIKey <key>`; used instead of username/password when set */
  apiKey?: string;
  /** Extra headers sent with every request */
  headers?: Record<string, string>;
  /** Custom fetch implementation (defaults to global fetch) */
  fetch?: typeof fetch;
};

export type DepositOptions = {
  /** Filename sent in Content-Disposition; defaults to `<uuid>-meca.zip` */
  filename?: string;
  /** Suggested identifier for the new object */
  slug?: string;
  /**
   * Packaging URI. By default the client uses the MECA packaging URI if the server
   * advertises it, otherwise falls back to Binary.
   */
  packaging?: string;
  /** Service-URL of a collection (sub-service) to deposit into, from `getCollections()` */
  collection?: string;
};

export type Collection = {
  /** The collection's Service-URL */
  url: string;
  title: string;
  abstract?: string;
};

export type DepositResult = {
  /** The Object-URL of the new deposit */
  location: string;
  eTag?: string;
  status: StatusDocument;
};

export class SwordClient {
  readonly serviceUrl: string;
  private readonly opts: SwordClientOptions;
  private readonly fetchFn: typeof fetch;
  private serviceDoc?: ServiceDocument;

  constructor(opts: SwordClientOptions) {
    this.opts = opts;
    this.serviceUrl = opts.serviceUrl;
    this.fetchFn = opts.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async getServiceDocument(opts?: { refresh?: boolean }): Promise<ServiceDocument> {
    if (this.serviceDoc && !opts?.refresh) return this.serviceDoc;
    const res = await this.request(this.serviceUrl, { headers: { Accept: JSON_LD } });
    this.serviceDoc = (await res.json()) as ServiceDocument;
    return this.serviceDoc;
  }

  /** Collections (sub-services) advertised by the service document, if any */
  async getCollections(opts?: { refresh?: boolean }): Promise<Collection[]> {
    const service = await this.getServiceDocument(opts);
    return (service.services ?? []).map((s) => ({
      url: s['@id'],
      title: s['dc:title'],
      ...(s['dcterms:abstract'] ? { abstract: s['dcterms:abstract'] } : {}),
    }));
  }

  /** Deposit a MECA zip as a new object (SWORD "Binary/Package Deposit") */
  async depositMeca(
    data: Uint8Array | ArrayBuffer | Blob,
    opts: DepositOptions = {},
  ): Promise<DepositResult> {
    const bytes = await toBytes(data);
    const service = await this.getServiceDocument();
    if (service.acceptDeposits === false) {
      throw new SwordError('Forbidden', 'Service is not accepting deposits', { status: 0 });
    }
    if (service.maxUploadSize && bytes.byteLength > service.maxUploadSize) {
      throw new SwordError(
        'MaxUploadSizeExceeded',
        `Package is ${bytes.byteLength} bytes; server accepts at most ${service.maxUploadSize}`,
        { status: 0 },
      );
    }
    const target = opts.collection
      ? service.services?.find((s) => s['@id'] === opts.collection)
      : undefined;
    const packaging = opts.packaging ?? choosePackaging(target ?? service);
    const headers: Record<string, string> = {
      [Header.ContentType]: ZIP,
      [Header.ContentDisposition]: formatContentDisposition({
        filename: opts.filename ?? `${crypto.randomUUID()}-meca.zip`,
      }),
      [Header.Digest]: `SHA-256=${await computeDigest(bytes, 'SHA-256')}`,
      [Header.Packaging]: packaging,
    };
    if (opts.slug) headers[Header.Slug] = opts.slug;
    const res = await this.request(opts.collection ?? service['@id'] ?? this.serviceUrl, {
      method: 'POST',
      headers,
      body: bytes as Uint8Array<ArrayBuffer>,
    });
    return depositResult(res);
  }

  /** Create an object from metadata only (SWORD "Metadata Deposit") */
  async depositMetadata(
    metadata: Partial<MetadataDocument>,
    opts: { slug?: string } = {},
  ): Promise<DepositResult> {
    const headers: Record<string, string> = {
      [Header.ContentType]: JSON_LD,
      [Header.ContentDisposition]: formatContentDisposition({ metadata: true }),
      [Header.MetadataFormat]: MetadataFormat.Default,
    };
    const body = JSON.stringify(withMetadataDefaults(metadata));
    headers[Header.Digest] = `SHA-256=${await computeDigest(new TextEncoder().encode(body))}`;
    if (opts.slug) headers[Header.Slug] = opts.slug;
    const res = await this.request(this.serviceUrl, { method: 'POST', headers, body });
    return depositResult(res);
  }

  async getStatus(objectUrl: string): Promise<StatusDocument> {
    const res = await this.request(objectUrl, { headers: { Accept: JSON_LD } });
    return (await res.json()) as StatusDocument;
  }

  async getMetadata(statusOrUrl: StatusDocument | string): Promise<MetadataDocument> {
    const url = await this.metadataUrl(statusOrUrl);
    const res = await this.request(url, { headers: { Accept: JSON_LD } });
    return (await res.json()) as MetadataDocument;
  }

  /** Replace the object's metadata. Pass `ifMatch` (an ETag) for concurrency control. */
  async replaceMetadata(
    statusOrUrl: StatusDocument | string,
    metadata: Partial<MetadataDocument>,
    opts: { ifMatch?: string } = {},
  ): Promise<{ eTag?: string }> {
    const url = await this.metadataUrl(statusOrUrl);
    const body = JSON.stringify(withMetadataDefaults(metadata));
    const headers: Record<string, string> = {
      [Header.ContentType]: JSON_LD,
      [Header.ContentDisposition]: formatContentDisposition({ metadata: true }),
      [Header.MetadataFormat]: MetadataFormat.Default,
      [Header.Digest]: `SHA-256=${await computeDigest(new TextEncoder().encode(body))}`,
    };
    if (opts.ifMatch) headers[Header.IfMatch] = opts.ifMatch;
    const res = await this.request(url, { method: 'PUT', headers, body });
    return { eTag: res.headers.get(Header.ETag) ?? undefined };
  }

  /** Download a file (e.g. the original MECA deposit) from its File-URL */
  async downloadFile(fileUrl: string): Promise<Uint8Array> {
    const res = await this.request(fileUrl);
    return new Uint8Array(await res.arrayBuffer());
  }

  /** Download the original MECA package of an object */
  async downloadOriginalDeposit(status: StatusDocument): Promise<Uint8Array> {
    const link = status.links.find((l) =>
      l.rel.includes('http://purl.org/net/sword/3.0/terms/originalDeposit'),
    );
    if (!link) throw new SwordError('NotFound', 'Object has no original deposit', { status: 0 });
    return this.downloadFile(link['@id']);
  }

  async deleteObject(objectUrl: string, opts: { ifMatch?: string } = {}): Promise<void> {
    const headers: Record<string, string> = {};
    if (opts.ifMatch) headers[Header.IfMatch] = opts.ifMatch;
    await this.request(objectUrl, { method: 'DELETE', headers });
  }

  /** Poll the status document until the object reaches one of the given states */
  async waitForState(
    objectUrl: string,
    states: StateURI[] = [State.Ingested, State.Rejected],
    opts: { interval?: number; timeout?: number } = {},
  ): Promise<StatusDocument> {
    const interval = opts.interval ?? 2000;
    const deadline = Date.now() + (opts.timeout ?? 60_000);
    for (;;) {
      const status = await this.getStatus(objectUrl);
      if (status.state.some((s) => (states as string[]).includes(s['@id']))) return status;
      if (Date.now() + interval > deadline) {
        throw new Error(`Timed out waiting for ${objectUrl} to reach ${states.join(' or ')}`);
      }
      await new Promise((r) => setTimeout(r, interval));
    }
  }

  private async metadataUrl(statusOrUrl: StatusDocument | string) {
    if (typeof statusOrUrl !== 'string') return statusOrUrl.metadata['@id'];
    if (/\/metadata\/?$/.test(statusOrUrl)) return statusOrUrl;
    return (await this.getStatus(statusOrUrl)).metadata['@id'];
  }

  private async request(url: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(this.opts.headers);
    new Headers(init.headers).forEach((value, key) => {
      headers.set(key, value);
    });
    if (this.opts.apiKey) {
      headers.set('Authorization', `APIKey ${this.opts.apiKey}`);
    } else if (this.opts.username !== undefined) {
      const token = btoa(`${this.opts.username}:${this.opts.password ?? ''}`);
      headers.set('Authorization', `Basic ${token}`);
    }
    const res = await this.fetchFn(url, { ...init, headers });
    if (!res.ok) throw await errorFromResponse(res);
    return res;
  }
}

function choosePackaging(service: ServiceDocument) {
  const accepted = service.acceptPackaging ?? ['*'];
  if (accepted.includes(Packaging.MECA)) return Packaging.MECA;
  return Packaging.Binary;
}

async function depositResult(res: Response): Promise<DepositResult> {
  const status = (await res.json()) as StatusDocument;
  return {
    location: res.headers.get(Header.Location) ?? status['@id'],
    eTag: res.headers.get(Header.ETag) ?? status.eTag,
    status,
  };
}

async function errorFromResponse(res: Response): Promise<SwordError> {
  const text = await res.text().catch(() => '');
  try {
    const doc = JSON.parse(text) as Partial<ErrorDocument>;
    if (doc && typeof doc === 'object' && doc['@type'])
      return SwordError.fromDocument(doc, res.status);
  } catch {
    // not a SWORD error document
  }
  return new SwordError('BadRequest', `HTTP ${res.status} ${res.statusText}`, {
    status: res.status,
    log: text.slice(0, 1000) || undefined,
  });
}

function withMetadataDefaults(metadata: Partial<MetadataDocument>): MetadataDocument {
  return { '@context': SWORD_CONTEXT, '@type': 'Metadata', ...metadata } as MetadataDocument;
}

async function toBytes(data: Uint8Array | ArrayBuffer | Blob): Promise<Uint8Array> {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(await data.arrayBuffer());
}
