import { decodeCursor, decodeValue, encodeCursor, encodeValue } from "./codec.js";
import type { KeyValueAdapter, KvBatchOperation, KvListOptions, KvListResult, KvRecord, KvRecordMeta } from "./types.js";

export interface CloudflareKvNamespace {
  get(key: string, type?: "text"): Promise<string | null>;
  put(key: string, value: string, options?: { expiration?: number; expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<boolean>;
  list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{ keys: { name: string }[]; list_complete: boolean; cursor?: string }>;
}

function encoded(namespace: string, key: string): string {
  return `drycms:kv:${Buffer.from(namespace, "utf8").toString("base64url")}:${Buffer.from(key, "utf8").toString("base64url")}`;
}

function prefix(namespace: string): string {
  return `drycms:kv:${Buffer.from(namespace, "utf8").toString("base64url")}:`;
}

export function createCloudflareKvAdapter(binding: CloudflareKvNamespace): KeyValueAdapter {
  function meta(record: KvRecord): KvRecordMeta {
    const { value: _value, ...rest } = record;
    return { ...rest, sizeBytes: encodeValue(record.value).sizeBytes };
  }
  return {
    async get(namespace, key) {
      const value = await binding.get(encoded(namespace, key), "text");
      return value ? (decodeValue(value) as KvRecord) : null;
    },
    async set(record) {
      const ttl = record.expiresAt ? Math.max(1, Math.ceil((Date.parse(record.expiresAt) - Date.now()) / 1000)) : undefined;
      await binding.put(encoded(record.namespace, record.key), JSON.stringify(record), ttl ? { expirationTtl: ttl } : undefined);
    },
    delete: async (namespace, key) => { await binding.delete(encoded(namespace, key)); },
    async list(namespace, options: KvListOptions = {}): Promise<KvListResult> {
      const start = decodeCursor(options.cursor);
      const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
      const search = options.search?.trim().toLowerCase() ?? "";
      const result = await binding.list({ prefix: prefix(namespace), limit: 1000 });
      const names = result.keys.filter((item) => {
        const encodedKey = item.name.slice(prefix(namespace).length);
        return !search || Buffer.from(encodedKey, "base64url").toString("utf8").toLowerCase().includes(search);
      }).slice(start, start + limit);
      const items: KvRecordMeta[] = [];
      for (const item of names) {
        const raw = await binding.get(item.name, "text");
        if (raw) items.push(meta(decodeValue(raw) as KvRecord));
      }
      return { items, ...(start + limit < result.keys.length ? { nextCursor: encodeCursor(start + limit) } : {}) };
    },
    async batch(operations: KvBatchOperation[]) {
      for (const operation of operations) {
        if (operation.type === "delete") await binding.delete(encoded(operation.namespace, operation.key));
        else if (operation.record) {
          const ttl = operation.record.expiresAt ? Math.max(1, Math.ceil((Date.parse(operation.record.expiresAt) - Date.now()) / 1000)) : undefined;
          await binding.put(encoded(operation.record.namespace, operation.record.key), JSON.stringify(operation.record), ttl ? { expirationTtl: ttl } : undefined);
        }
      }
    },
  };
}
