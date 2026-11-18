import type { DepositRecord, SwordStore } from './types.js';

export class MemoryStore implements SwordStore {
  private records = new Map<string, DepositRecord>();
  private files = new Map<string, Map<string, Uint8Array>>();

  async has(id: string) {
    return this.records.has(id);
  }

  async get(id: string) {
    const record = this.records.get(id);
    return record ? structuredClone(record) : undefined;
  }

  async list() {
    return [...this.records.values()].map((r) => structuredClone(r));
  }

  async save(record: DepositRecord, files?: { name: string; data: Uint8Array }[]) {
    this.records.set(record.id, structuredClone(record));
    if (!files?.length) return;
    const existing = this.files.get(record.id) ?? new Map();
    files.forEach((f) => {
      existing.set(f.name, f.data);
    });
    this.files.set(record.id, existing);
  }

  async getFile(id: string, name: string) {
    return this.files.get(id)?.get(name);
  }

  async delete(id: string) {
    this.records.delete(id);
    this.files.delete(id);
  }
}
