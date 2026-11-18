export const SWORD_CONTEXT = 'https://swordapp.github.io/swordv3/swordv3.jsonld';
export const SWORD_VERSION = 'http://purl.org/net/sword/3.0';

export const Packaging = {
  Binary: 'http://purl.org/net/sword/3.0/package/Binary',
  SimpleZip: 'http://purl.org/net/sword/3.0/package/SimpleZip',
  SWORDBagIt: 'http://purl.org/net/sword/3.0/package/SWORDBagIt',
  /**
   * Provisional packaging identifier for a MECA bundle.
   *
   * Neither SWORD nor NISO MECA define a packaging URI yet, so this value is a placeholder
   * until the MECA/SWORDv3 working group settles one. Servers built with this library also
   * accept `Binary` deposits of `application/zip` and treat them as MECA.
   */
  MECA: 'https://meca.zip/sword/package/MECA',
} as const;

export const MetadataFormat = {
  /** The default SWORD metadata format (Dublin Core in JSON-LD) */
  Default: 'http://purl.org/net/sword/3.0/types/Metadata',
} as const;

export const State = {
  Accepted: 'http://purl.org/net/sword/3.0/state/accepted',
  InProgress: 'http://purl.org/net/sword/3.0/state/inProgress',
  InWorkflow: 'http://purl.org/net/sword/3.0/state/inWorkflow',
  Ingested: 'http://purl.org/net/sword/3.0/state/ingested',
  Rejected: 'http://purl.org/net/sword/3.0/state/rejected',
  Deleted: 'http://purl.org/net/sword/3.0/state/deleted',
} as const;
export type StateURI = (typeof State)[keyof typeof State];

export const FileState = {
  Pending: 'http://purl.org/net/sword/3.0/filestate/pending',
  Downloading: 'http://purl.org/net/sword/3.0/filestate/downloading',
  Unpacking: 'http://purl.org/net/sword/3.0/filestate/unpacking',
  Error: 'http://purl.org/net/sword/3.0/filestate/error',
  Ingested: 'http://purl.org/net/sword/3.0/filestate/ingested',
} as const;

export const Rel = {
  Alternate: 'alternate',
  OriginalDeposit: 'http://purl.org/net/sword/3.0/terms/originalDeposit',
  DerivedResource: 'http://purl.org/net/sword/3.0/terms/derivedResource',
  PackagedContent: 'http://purl.org/net/sword/terms/packagedContent',
  FormattedMetadata: 'http://purl.org/net/sword/3.0/terms/formattedMetadata',
  ByReferenceDeposit: 'http://purl.org/net/sword/3.0/terms/byReferenceDeposit',
  FileSetFile: 'http://purl.org/net/sword/3.0/terms/fileSetFile',
} as const;

export const Header = {
  ContentDisposition: 'Content-Disposition',
  ContentType: 'Content-Type',
  Digest: 'Digest',
  ETag: 'ETag',
  IfMatch: 'If-Match',
  InProgress: 'In-Progress',
  Location: 'Location',
  MetadataFormat: 'Metadata-Format',
  OnBehalfOf: 'On-Behalf-Of',
  Packaging: 'Packaging',
  Slug: 'Slug',
} as const;

export const JSON_LD = 'application/ld+json';
export const ZIP = 'application/zip';
