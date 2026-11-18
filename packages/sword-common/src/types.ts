import type { SWORD_CONTEXT } from './constants.js';

type Context = typeof SWORD_CONTEXT | string;

export type IdDescription = { '@id': string; description?: string };

export type ServiceDocument = {
  '@context': Context;
  '@id': string;
  '@type': 'ServiceDocument';
  'dc:title': string;
  'dcterms:abstract'?: string;
  root: string;
  version: string;
  acceptDeposits?: boolean;
  accept?: string[];
  acceptArchiveFormat?: string[];
  acceptPackaging?: string[];
  acceptMetadata?: string[];
  maxUploadSize?: number;
  maxByReferenceSize?: number;
  maxSegmentSize?: number;
  minSegmentSize?: number;
  maxAssembledSize?: number;
  maxSegments?: number;
  byReferenceDeposit?: boolean;
  onBehalfOf?: boolean;
  digest: string[];
  authentication?: string[];
  collectionPolicy?: IdDescription;
  treatment?: IdDescription;
  staging?: string;
  stagingMaxIdle?: number;
  services?: ServiceDocument[];
};

export type Actions = {
  getMetadata: boolean;
  getFiles: boolean;
  appendMetadata: boolean;
  appendFiles: boolean;
  replaceMetadata: boolean;
  replaceFiles: boolean;
  deleteMetadata: boolean;
  deleteFiles: boolean;
  deleteObject: boolean;
};

export type Link = {
  '@id': string;
  rel: string[];
  contentType?: string;
  packaging?: string;
  depositedOn?: string;
  depositedBy?: string;
  depositedOnBehalfOf?: string;
  derivedFrom?: string;
  byReference?: string;
  status?: string;
  log?: string;
  eTag?: string;
  'dcterms:relation'?: string;
  'dcterms:replaces'?: string;
  'dcterms:isReplacedBy'?: string;
  versionReplacedOn?: string;
};

export type StatusDocument = {
  '@context': Context;
  '@id': string;
  '@type': 'Status';
  eTag?: string;
  metadata: { '@id': string; eTag?: string };
  fileSet: { '@id': string; eTag?: string };
  service: string;
  state: IdDescription[];
  actions: Actions;
  links: Link[];
};

/**
 * The default SWORD metadata document: Dublin Core / DC Terms keys in JSON-LD.
 * The SWORD schema requires every `dc:` / `dcterms:` value to be a string.
 */
export type MetadataDocument = {
  '@context': Context;
  '@id'?: string;
  '@type': 'Metadata';
  [key: `dc:${string}` | `dcterms:${string}`]: string | undefined;
};

export type ErrorDocument = {
  '@context': Context;
  '@type': string;
  error: string;
  log?: string;
  timestamp: string;
};
