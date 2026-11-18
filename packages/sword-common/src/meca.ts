import { unzipSync, zipSync } from 'fflate';
import { Jats } from 'jats-xml';
import {
  createManifestXml,
  createTransferXml,
  ItemTypes,
  MANIFEST,
  ManifestXml,
  TRANSFER,
  TransferXml,
} from 'meca';
import type { ManifestItem, Transfer } from 'meca';
import { toText } from 'myst-common';
import { SWORD_CONTEXT } from './constants.js';
import type { MetadataDocument } from './types.js';

export type MecaArticle = {
  title?: string;
  authors?: string[];
  doi?: string;
  abstract?: string;
  date?: string;
  journal?: string;
};

export type MecaInspection = {
  /** False if the bundle is unusable as MECA (not a zip, or no manifest) */
  valid: boolean;
  errors: string[];
  warnings: string[];
  /** All file paths in the zip (directories excluded) */
  files: string[];
  manifest?: ManifestItem[];
  transfer?: Transfer;
  article?: MecaArticle;
};

const quiet = { debug() {}, info() {}, warn() {}, error() {} };

export type UnzipLimits = {
  /** Most entries (files and folders) a zip may hold */
  maxEntries: number;
  /** Most bytes a zip may expand to, summed over its entries */
  maxTotalSize: number;
};

/** Generous for a manuscript, small enough that a zip bomb can't exhaust memory */
export const DEFAULT_UNZIP_LIMITS: UnzipLimits = {
  maxEntries: 10_000,
  maxTotalSize: 512 * 1024 ** 2,
};

export class UnzipLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnzipLimitError';
  }
}

/**
 * `unzipSync` with limits on entry count and expanded size, checked against each entry's
 * declared size before it is inflated. fflate inflates into a buffer of exactly the declared
 * size, so a zip can't expand further than it says.
 */
export function unzip(
  data: Uint8Array,
  limits: UnzipLimits = DEFAULT_UNZIP_LIMITS,
): Record<string, Uint8Array> {
  let count = 0;
  let total = 0;
  return unzipSync(data, {
    filter: (file) => {
      count += 1;
      total += file.originalSize;
      if (count > limits.maxEntries) {
        throw new UnzipLimitError(`Zip has more than ${limits.maxEntries} entries`);
      }
      if (total > limits.maxTotalSize) {
        const mb = Math.round(limits.maxTotalSize / 1024 ** 2);
        throw new UnzipLimitError(`Zip expands to more than ${mb} MB`);
      }
      return true;
    },
  });
}

/** Absolute paths, `..` segments, backslashes and drive letters, which could escape a folder */
export function isUnsafePath(name: string) {
  return (
    name.startsWith('/') ||
    name.includes('\\') ||
    /^[a-z]:/i.test(name) ||
    name.split('/').some((part) => part === '..')
  );
}

/**
 * Lightweight, in-process inspection of a MECA zip.
 *
 * This checks the structural requirements (zip, manifest.xml present and parseable,
 * manifest items present in the bundle) and extracts transfer and article metadata.
 * It does not do DTD validation; use `validateMeca` from the `meca` package for that.
 */
export function inspectMeca(
  data: Uint8Array | ArrayBuffer,
  opts: { limits?: UnzipLimits } = {},
): MecaInspection {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const result: MecaInspection = { valid: false, errors: [], warnings: [], files: [] };
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzip(bytes, opts.limits);
  } catch (error) {
    result.errors.push(
      error instanceof UnzipLimitError ? error.message : 'Package is not a zip archive',
    );
    return result;
  }
  result.files = Object.keys(entries).filter((name) => !name.endsWith('/'));
  const unsafe = Object.keys(entries).filter(isUnsafePath);
  if (unsafe.length) {
    result.errors.push(`Package has unsafe file paths: ${unsafe.join(', ')}`);
    return result;
  }
  const decode = (name: string) => new TextDecoder().decode(entries[name]);

  if (!entries[MANIFEST]) {
    result.errors.push(`Package does not include required ${MANIFEST}`);
    return result;
  }
  try {
    const manifest = new ManifestXml(decode(MANIFEST), { log: quiet });
    result.manifest = manifest.items;
  } catch (error) {
    result.errors.push(`Unable to parse ${MANIFEST}: ${(error as Error).message}`);
    return result;
  }

  const folders = new Set<string>();
  result.files.forEach((name) => {
    const parts = name.split('/');
    for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join('/'));
  });
  const missing = result.manifest
    .map((item) => item.href.replace(/\/$/, ''))
    .filter((href) => !entries[href] && !folders.has(href));
  if (missing.length) {
    result.errors.push(`Manifest items missing from package: ${missing.join(', ')}`);
  }
  const listed = new Set(result.manifest.map((item) => item.href));
  const extras = result.files.filter((f) => f !== MANIFEST && !listed.has(f));
  if (extras.length) {
    result.warnings.push(`Package files not listed in manifest: ${extras.join(', ')}`);
  }

  const transferHref =
    result.manifest.find((item) => item.itemType === ItemTypes.transferMetadata)?.href ??
    (entries[TRANSFER] ? TRANSFER : undefined);
  if (transferHref && entries[transferHref]) {
    try {
      const transfer = new TransferXml(decode(transferHref), { log: quiet });
      result.transfer = {
        source: transfer.source as Transfer['source'],
        destination: transfer.destination as Transfer['destination'],
        instructions: transfer.instructions,
      };
    } catch (error) {
      result.warnings.push(`Unable to parse ${transferHref}: ${(error as Error).message}`);
    }
  }

  const articleHref = result.manifest.find(
    (item) => item.itemType === ItemTypes.articleMetadata,
  )?.href;
  if (!articleHref) {
    result.warnings.push('Manifest does not list an article-metadata (JATS) item');
  } else if (entries[articleHref]) {
    try {
      result.article = extractArticle(decode(articleHref));
    } catch (error) {
      result.warnings.push(`Unable to parse JATS ${articleHref}: ${(error as Error).message}`);
    }
  }
  result.valid = result.errors.length === 0;
  return result;
}

function extractArticle(xml: string): MecaArticle {
  const jats = new Jats(xml, { log: quiet });
  const fm = jats.frontmatter;
  const abstract = jats.abstract ? toText(jats.abstract).trim() : undefined;
  const article: MecaArticle = {
    title: fm.title,
    authors: fm.authors?.map((a) => a.name).filter((n): n is string => !!n),
    doi: fm.doi,
    abstract: abstract || undefined,
    date: fm.date,
    journal: typeof fm.venue === 'object' ? fm.venue?.title : undefined,
  };
  Object.keys(article).forEach((k) => {
    const key = k as keyof MecaArticle;
    if (article[key] === undefined || (Array.isArray(article[key]) && !article[key]?.length)) {
      delete article[key];
    }
  });
  return article;
}

/** Map extracted MECA/JATS metadata onto a default SWORD (Dublin Core) metadata document */
export function mecaToMetadata(inspection: MecaInspection, id?: string): MetadataDocument {
  const { article, transfer } = inspection;
  const doc: MetadataDocument = {
    '@context': SWORD_CONTEXT,
    '@type': 'Metadata',
    ...(id ? { '@id': id } : {}),
  };
  if (article?.title) doc['dc:title'] = article.title;
  if (article?.authors?.length) doc['dc:creator'] = article.authors.join('; ');
  if (article?.abstract) doc['dcterms:abstract'] = article.abstract;
  if (article?.doi) doc['dc:identifier'] = `https://doi.org/${article.doi}`;
  if (article?.date) doc['dcterms:date'] = article.date;
  if (article?.journal) doc['dcterms:isPartOf'] = article.journal;
  const publisher = transfer?.source?.provider?.name;
  if (publisher) doc['dcterms:provenance'] = `Transferred from ${publisher}`;
  doc['dc:type'] = 'MECA';
  return doc;
}

export type MecaFile = {
  /** Path inside the bundle, e.g. `content/manuscript.pdf` */
  path: string;
  data: Uint8Array | string;
  itemType?: string;
  mediaType?: string;
  title?: string;
};

/**
 * Build a MECA zip from a JATS article and optional supporting files.
 * A `manifest.xml` (and `transfer.xml`, if `transfer` is given) is generated.
 */
export function buildMeca(opts: {
  article: string;
  articlePath?: string;
  files?: MecaFile[];
  transfer?: Transfer;
}): Uint8Array {
  const encode = (d: Uint8Array | string) =>
    typeof d === 'string' ? new TextEncoder().encode(d) : d;
  const files: MecaFile[] = [
    {
      path: opts.articlePath ?? 'content/article.xml',
      data: opts.article,
      itemType: ItemTypes.articleMetadata,
      mediaType: 'application/xml',
    },
    ...(opts.files ?? []),
  ];
  if (opts.transfer) {
    files.push({
      path: TRANSFER,
      data: createTransferXml(opts.transfer),
      itemType: ItemTypes.transferMetadata,
      mediaType: 'application/xml',
    });
  }
  const manifest = createManifestXml(
    files.map((f) => ({
      href: f.path,
      itemType: f.itemType,
      mediaType: f.mediaType,
      title: f.title,
    })),
  );
  const entries: Record<string, Uint8Array> = { [MANIFEST]: encode(manifest) };
  for (const f of files) entries[f.path] = encode(f.data);
  return zipSync(entries);
}

const MEDIA_TYPES: Record<string, string> = {
  xml: 'application/xml',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  doc: 'application/msword',
  odt: 'application/vnd.oasis.opendocument.text',
  tex: 'application/x-tex',
  bib: 'application/x-bibtex',
  md: 'text/markdown',
  txt: 'text/plain',
  html: 'text/html',
  htm: 'text/html',
  csv: 'text/csv',
  json: 'application/json',
  ipynb: 'application/x-ipynb+json',
  zip: 'application/zip',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  svg: 'image/svg+xml',
  webp: 'image/webp',
  mp4: 'video/mp4',
};

/** Manuscript formats, most preferred first */
const MANUSCRIPT_EXTENSIONS = ['pdf', 'docx', 'doc', 'odt', 'tex', 'md'];

export type InputFile = { path: string; data: Uint8Array };

export type BuildResult = {
  data: Uint8Array;
  inspection: MecaInspection;
  /** True if the input was already a MECA zip and was passed through unchanged */
  passthrough: boolean;
  /** What was decided about each file, for showing to the user */
  notes: string[];
};

const extension = (path: string) => path.split('.').pop()?.toLowerCase() ?? '';
export const mediaTypeFor = (path: string) =>
  MEDIA_TYPES[extension(path)] ?? 'application/octet-stream';

function isJatsArticle(data: Uint8Array) {
  const head = new TextDecoder().decode(data.slice(0, 4096));
  return /<article[\s>]/.test(head);
}

/** Expand any zip inputs (except a MECA zip, which is returned as-is) and drop junk files */
function expandInputs(inputs: InputFile[]): { files: InputFile[]; meca?: Uint8Array } {
  if (inputs.length === 1 && extension(inputs[0].path) === 'zip') {
    let entries: Record<string, Uint8Array>;
    try {
      entries = unzip(inputs[0].data);
    } catch (error) {
      if (error instanceof UnzipLimitError) throw error;
      return { files: inputs };
    }
    if (entries[MANIFEST]) return { files: [], meca: inputs[0].data };
    const files = Object.entries(entries)
      .filter(([name]) => !name.endsWith('/') && !isUnsafePath(name))
      .map(([path, data]) => ({ path, data }));
    return { files: stripSharedFolder(dropJunk(files)) };
  }
  return { files: stripSharedFolder(dropJunk(inputs.filter((f) => !isUnsafePath(f.path)))) };
}

/** A zipped or uploaded folder: drop the top-level directory every file shares */
function stripSharedFolder(files: InputFile[]) {
  const tops = new Set(files.map((f) => f.path.split('/')[0]));
  if (files.length === 0 || tops.size !== 1 || !files.every((f) => f.path.includes('/'))) {
    return files;
  }
  return files.map((f) => ({ ...f, path: f.path.split('/').slice(1).join('/') }));
}

function dropJunk(files: InputFile[]) {
  return files.filter(
    (f) =>
      !f.path.split('/').some((part) => part.startsWith('.') || part === '__MACOSX') &&
      f.path !== MANIFEST &&
      f.path !== TRANSFER,
  );
}

/**
 * Build a MECA zip from a loose set of files (or a zip of them), working out each file's
 * role so nobody has to fill in a form:
 *
 * - the JATS XML (`<article>` root) is the `article-metadata` item; title, authors, etc.
 *   are read from it
 * - files the JATS links to (`xlink:href`) are `article-supporting-file`s
 * - the first PDF (else DOCX, DOC, ODT, TeX, Markdown) is the `manuscript`
 * - everything else is a `manuscript-supporting-file`
 *
 * A zip that is already a MECA bundle is returned unchanged.
 */
export function buildMecaFromFiles(inputs: InputFile[], opts: { transfer?: Transfer } = {}) {
  const { files, meca } = expandInputs(inputs);
  if (meca) {
    return {
      data: meca,
      inspection: inspectMeca(meca),
      passthrough: true,
      notes: ['Input is already a MECA package; using it as-is'],
    } satisfies BuildResult;
  }
  const notes: string[] = [];
  const jatsFiles = files.filter((f) => extension(f.path) === 'xml' && isJatsArticle(f.data));
  if (jatsFiles.length === 0) {
    throw new Error('No JATS article XML found; include the article .xml file');
  }
  const jats =
    jatsFiles.find((f) => /article/i.test(f.path.split('/').pop() ?? '')) ?? jatsFiles[0];
  if (jatsFiles.length > 1) {
    notes.push(`Several JATS files found; using ${jats.path} as the article metadata`);
  }
  const jatsText = new TextDecoder().decode(jats.data);
  const jatsDir = jats.path.includes('/') ? jats.path.slice(0, jats.path.lastIndexOf('/') + 1) : '';
  const linked = new Set(
    [...jatsText.matchAll(/xlink:href="([^"#?]+)"/g)]
      .map((m) => m[1])
      .filter((href) => !/^[a-z]+:/i.test(href))
      .map((href) => normalizePath(jatsDir + href)),
  );
  const others = files.filter((f) => f !== jats);
  const manuscript = MANUSCRIPT_EXTENSIONS.map((ext) =>
    others.find((f) => extension(f.path) === ext && !linked.has(f.path)),
  ).find(Boolean);

  const items: MecaFile[] = [];
  const classify = (f: InputFile): string => {
    if (f === manuscript) return ItemTypes.manuscript;
    if (linked.has(f.path)) return ItemTypes.articleSupportingFile;
    return ItemTypes.manuscriptSupportingFile;
  };
  for (const f of others) {
    const itemType = classify(f);
    items.push({ path: f.path, data: f.data, itemType, mediaType: mediaTypeFor(f.path) });
    notes.push(`${f.path}: ${itemType}`);
  }
  notes.unshift(`${jats.path}: ${ItemTypes.articleMetadata}`);
  if (!manuscript) notes.push('No manuscript file (PDF, Word, TeX or Markdown) was included');

  const data = buildMeca({
    article: jatsText,
    articlePath: jats.path,
    files: items,
    transfer: opts.transfer,
  });
  return { data, inspection: inspectMeca(data), passthrough: false, notes } satisfies BuildResult;
}

function normalizePath(path: string) {
  const out: string[] = [];
  for (const part of path.split('/')) {
    if (part === '..') out.pop();
    else if (part && part !== '.') out.push(part);
  }
  return out.join('/');
}

/**
 * Return a copy of a MECA zip with its `transfer.xml` replaced (or added), and the manifest
 * updated to match. Used to address a package to a destination at send time.
 */
export function setTransfer(data: Uint8Array, transfer: Transfer): Uint8Array {
  const entries = unzip(data);
  if (!entries[MANIFEST]) throw new Error(`Package does not include ${MANIFEST}`);
  const manifest = new ManifestXml(new TextDecoder().decode(entries[MANIFEST]), { log: quiet });
  const items = manifest.items.filter((item) => {
    if (item.itemType !== ItemTypes.transferMetadata) return true;
    delete entries[item.href];
    return false;
  });
  delete entries[TRANSFER];
  items.push({
    href: TRANSFER,
    itemType: ItemTypes.transferMetadata,
    mediaType: 'application/xml',
  });
  entries[TRANSFER] = new TextEncoder().encode(createTransferXml(transfer));
  entries[MANIFEST] = new TextEncoder().encode(createManifestXml(items));
  return zipSync(entries);
}
