import fs from 'node:fs/promises';
import path from 'node:path';
import type { DepositRecord, SwordStore } from './types.js';

const RECORD = 'record.json';
const FILES = 'files';

/**
 * Stores each deposit in `<root>/<id>/record.json` with files in `<root>/<id>/files/`.
 */
export class FileSystemStore implements SwordStore {
  constructor(readonly root: string) {}

  private dir(id: string) {
    if (!/^[A-Za-z0-9._-]+$/.test(id) || id.startsWith('.')) throw new Error(`Invalid id: ${id}`);
    return path.join(this.root, id);
  }

  private filePath(id: string, name: string) {
    const base = path.basename(name);
    if (base !== name || name.startsWith('.')) throw new Error(`Invalid file name: ${name}`);
    return path.join(this.dir(id), FILES, base);
  }

  async has(id: string) {
    try {
      await fs.access(path.join(this.dir(id), RECORD));
      return true;
    } catch {
      return false;
    }
  }

  async get(id: string) {
    try {
      const data = await fs.readFile(path.join(this.dir(id), RECORD), 'utf8');
      return JSON.parse(data) as DepositRecord;
    } catch {
      return undefined;
    }
  }

  async list() {
    let ids: string[] = [];
    try {
      ids = await fs.readdir(this.root);
    } catch {
      return [];
    }
    const records = await Promise.all(ids.map((id) => this.get(id).catch(() => undefined)));
    return records.filter((r): r is DepositRecord => !!r);
  }

  async save(record: DepositRecord, files?: { name: string; data: Uint8Array }[]) {
    const dir = this.dir(record.id);
    await fs.mkdir(path.join(dir, FILES), { recursive: true });
    await Promise.all(
      (files ?? []).map((f) => fs.writeFile(this.filePath(record.id, f.name), f.data)),
    );
    const tmp = path.join(dir, `${RECORD}.tmp`);
    await fs.writeFile(tmp, JSON.stringify(record, null, 2));
    await fs.rename(tmp, path.join(dir, RECORD));
  }

  async getFile(id: string, name: string) {
    try {
      return new Uint8Array(await fs.readFile(this.filePath(id, name)));
    } catch {
      return undefined;
    }
  }

  async delete(id: string) {
    await fs.rm(this.dir(id), { recursive: true, force: true });
  }
}
