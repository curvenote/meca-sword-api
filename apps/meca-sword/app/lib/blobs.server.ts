import fs from 'node:fs/promises';
import path from 'node:path';
import { Storage } from '@google-cloud/storage';
import { getConfig } from './config.server';

/** Package files, by key such as `deposits/<id>/<name>` or `packages/<id>.zip` */
export interface BlobStore {
  put(key: string, data: Uint8Array, contentType?: string): Promise<void>;
  get(key: string): Promise<Uint8Array | undefined>;
  /** Delete one key, or every key under `prefix/` */
  delete(keyOrPrefix: string): Promise<void>;
}

function checkKey(key: string) {
  if (!/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*\/?$/.test(key) || key.split('/').includes('..')) {
    throw new Error(`Invalid storage key: ${key}`);
  }
  return key;
}

export class LocalBlobStore implements BlobStore {
  constructor(readonly root: string) {}

  private file(key: string) {
    return path.join(this.root, checkKey(key));
  }

  async put(key: string, data: Uint8Array) {
    const file = this.file(key);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, data);
  }

  async get(key: string) {
    try {
      return new Uint8Array(await fs.readFile(this.file(key)));
    } catch {
      return undefined;
    }
  }

  async delete(keyOrPrefix: string) {
    await fs.rm(this.file(keyOrPrefix), { recursive: true, force: true });
  }
}

export class GcsBlobStore implements BlobStore {
  private bucket;
  constructor(bucket: string, storage = new Storage()) {
    this.bucket = storage.bucket(bucket);
  }

  async put(key: string, data: Uint8Array, contentType = 'application/octet-stream') {
    await this.bucket.file(checkKey(key)).save(Buffer.from(data), {
      contentType,
      resumable: false,
    });
  }

  async get(key: string) {
    try {
      const [data] = await this.bucket.file(checkKey(key)).download();
      return new Uint8Array(data);
    } catch (error) {
      if ((error as { code?: number }).code === 404) return undefined;
      throw error;
    }
  }

  async delete(keyOrPrefix: string) {
    checkKey(keyOrPrefix);
    if (keyOrPrefix.endsWith('/')) {
      await this.bucket.deleteFiles({ prefix: keyOrPrefix });
    } else {
      await this.bucket.file(keyOrPrefix).delete({ ignoreNotFound: true });
    }
  }
}

let store: Promise<BlobStore> | undefined;

/** GCS when `storage.bucket` is set (deployed), otherwise a local folder */
export function blobs(): Promise<BlobStore> {
  store ??= getConfig().then((config) =>
    config.storage?.bucket
      ? new GcsBlobStore(config.storage.bucket)
      : new LocalBlobStore(path.resolve(config.storage?.directory ?? 'data/files')),
  );
  return store;
}

export function setBlobs(value: BlobStore) {
  store = Promise.resolve(value);
}
