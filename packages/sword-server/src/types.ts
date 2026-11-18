import type { MetadataDocument, StateURI } from '@curvenote/sword-common';
import type { MecaInspection } from '@curvenote/sword-common/meca';

export type Principal = { id: string; name?: string };

export type StoredFile = {
  name: string;
  contentType: string;
  packaging?: string;
  size: number;
  /** base64 SHA-256 of the file */
  sha256: string;
  eTag: string;
  depositedOn: string;
  depositedBy?: string;
};

export type DepositRecord = {
  id: string;
  createdAt: string;
  updatedAt: string;
  depositedBy?: string;
  /** Collection id, when deposited to a collection's Service-URL */
  collection?: string;
  state: StateURI;
  stateDescription?: string;
  eTag: string;
  metadata: MetadataDocument;
  metadataETag: string;
  files: StoredFile[];
  /** Summary of the MECA inspection made at deposit time */
  meca?: Omit<MecaInspection, 'files'> & { fileCount: number };
};

export interface SwordStore {
  has(id: string): Promise<boolean>;
  get(id: string): Promise<DepositRecord | undefined>;
  list(): Promise<DepositRecord[]>;
  /** Create or overwrite the record; `files` are written alongside it */
  save(record: DepositRecord, files?: { name: string; data: Uint8Array }[]): Promise<void>;
  getFile(id: string, name: string): Promise<Uint8Array | undefined>;
  delete(id: string): Promise<void>;
}
