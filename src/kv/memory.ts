import { encodeValue, assertKvPart } from "./codec.js";
import {
  KeyValueError,
  kvId,
  type KeyValueAdapter,
  type KeyValueStoreOptions,
  type KvBatchOperation,
  type KvFlushResult,
  type KvGetOptions,
  type KvListResult,
  type KvRecord,
  type KvRecordMeta,
  type KvSetOptions,
} from "./types.js";

interface CacheEntry {
  record: KvRecord;
  sizeBytes: number;
  lastAccessAt: number;
}

interface RuntimeOptions {
  defaultTtlMs?: number;
  idleTtlMs?: number;
  cleanupIntervalMs: number;
  maxEntries: number;
  maxBytes: number;
  flushDebounceMs: number;
  flushBatchSize: number;
  durability: "memory" | "async" | "sync";
}

type Pending = KvBatchOperation;

const DEFAULTS = {
  defaultTtlMs: undefined,
  idleTtlMs: undefined,
  cleanupIntervalMs: 30_000,
  maxEntries: 10_000,
  maxBytes: 32 * 1024 * 1024,
  flushDebounceMs: 100,
  flushBatchSize: 100,
  durability: "async" as const,
};

export class KeyValueStore {
  private readonly cache = new Map<string, CacheEntry>();
  private readonly pending = new Map<string, Pending>();
  private readonly options: RuntimeOptions;
  private readonly now: () => number;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private flushing: Promise<KvFlushResult> | undefined;
  private totalBytes = 0;
  private revision = 0;

  constructor(private readonly adapter: KeyValueAdapter, options: KeyValueStoreOptions = {}) {
    this.options = { ...DEFAULTS, ...options };
    this.now = options.now ?? Date.now;
    this.scheduleCleanup();
  }

  get currentRevision(): number {
    return this.revision;
  }

  async get<T = unknown>(namespace: string, key: string, options: KvGetOptions = {}): Promise<T | null> {
    this.assertKey(namespace, key);
    const id = kvId(namespace, key);
    const cached = this.cache.get(id);
    if (cached) {
      if (this.isExpired(cached.record) || this.isIdle(cached)) {
        this.evict(id, true);
      } else {
        cached.lastAccessAt = this.now();
        return cached.record.value as T;
      }
    }

    try {
      const record = await this.adapter.get(namespace, key);
      if (!record || this.isExpired(record)) {
        if (record) this.queue({ type: "delete", namespace, key });
        return null;
      }
      this.cacheRecord(record);
      return record.value as T;
    } catch (error) {
      if (options.allowStaleOnError) {
        const stale = this.cache.get(id);
        if (stale) return stale.record.value as T;
      }
      throw new KeyValueError("backend_unavailable", error instanceof Error ? error.message : "KV backend unavailable.");
    }
  }

  async set<T>(namespace: string, key: string, value: T, options: KvSetOptions = {}): Promise<void> {
    this.assertKey(namespace, key);
    const encoded = encodeValue(value);
    const id = kvId(namespace, key);
    const existing = this.cache.get(id)?.record ?? (await this.adapter.get(namespace, key));
    const now = this.now();
    const ttlMs = options.ttlMs ?? this.options.defaultTtlMs;
    const record: KvRecord = {
      namespace,
      key,
      value,
      version: (existing?.version ?? 0) + 1,
      createdAt: existing?.createdAt ?? new Date(now).toISOString(),
      updatedAt: new Date(now).toISOString(),
      ...(ttlMs === undefined ? {} : { expiresAt: new Date(now + Math.max(0, ttlMs)).toISOString() }),
    };
    this.cacheRecord(record, encoded.sizeBytes);
    this.queue({ type: "set", namespace, key, record });
    const durability = options.durability ?? this.options.durability;
    if (durability === "sync") await this.flush();
    else if (durability === "async") this.scheduleFlush();
  }

  async delete(namespace: string, key: string): Promise<void> {
    this.assertKey(namespace, key);
    this.evict(kvId(namespace, key), false);
    this.queue({ type: "delete", namespace, key });
    if (this.options.durability === "sync") await this.flush();
    else if (this.options.durability === "async") this.scheduleFlush();
  }

  async has(namespace: string, key: string): Promise<boolean> {
    return (await this.get(namespace, key)) !== null;
  }

  async incrementCounter(namespace: string, key: string, windowMs: number, ttlMs: number): Promise<{ count: number; windowStartedAt: number } | null> {
    if (!this.adapter.increment) return null;
    return this.adapter.increment(namespace, key, windowMs, ttlMs);
  }

  async deleteCounter(namespace: string, key: string): Promise<boolean> {
    if (!this.adapter.deleteCounter) return false;
    await this.adapter.deleteCounter(namespace, key);
    return true;
  }

  async list(namespace: string, options: { cursor?: string; limit?: number; search?: string } = {}): Promise<KvListResult> {
    assertKvPart(namespace, "namespace");
    const result = await this.adapter.list(namespace, options);
    const merged = new Map(result.items.map((item) => [kvId(item.namespace, item.key), item]));
    const search = options.search?.trim().toLowerCase() ?? "";
    for (const pending of this.pending.values()) {
      if (pending.namespace !== namespace) continue;
      if (search && !pending.key.toLowerCase().includes(search)) continue;
      const id = kvId(namespace, pending.key);
      if (pending.type === "delete") merged.delete(id);
      else if (pending.record) merged.set(id, this.meta(pending.record, this.cache.get(id)?.sizeBytes));
    }
    return { ...result, items: [...merged.values()].sort((a, b) => a.key.localeCompare(b.key)), revision: this.revision };
  }

  async flush(): Promise<KvFlushResult> {
    if (this.flushing) return this.flushing;
    this.flushing = this.flushNow().finally(() => {
      this.flushing = undefined;
    });
    return this.flushing;
  }

  async close(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    if (this.flushTimer) clearTimeout(this.flushTimer);
    await this.flush();
    await this.adapter.close?.();
  }

  private async flushNow(): Promise<KvFlushResult> {
    const operations = [...this.pending.values()].slice(0, this.options.flushBatchSize);
    if (operations.length === 0) return { flushed: 0, failed: 0, revision: this.revision };
    try {
      if (this.adapter.batch) await this.adapter.batch(operations);
      else {
        for (const operation of operations) {
          if (operation.type === "delete") await this.adapter.delete(operation.namespace, operation.key);
          else if (operation.record) await this.adapter.set(operation.record);
        }
      }
      for (const operation of operations) {
        const id = kvId(operation.namespace, operation.key);
        if (this.pending.get(id) === operation) this.pending.delete(id);
      }
      this.revision++;
      if (this.pending.size > 0) this.scheduleFlush();
      return { flushed: operations.length, failed: 0, revision: this.revision };
    } catch {
      return { flushed: 0, failed: operations.length, revision: this.revision };
    }
  }

  private queue(operation: Pending): void {
    this.pending.set(kvId(operation.namespace, operation.key), operation);
    this.revision++;
  }

  private cacheRecord(record: KvRecord, knownSize?: number): void {
    const id = kvId(record.namespace, record.key);
    const sizeBytes = knownSize ?? encodeValue(record.value).sizeBytes;
    const previous = this.cache.get(id);
    if (previous) this.totalBytes -= previous.sizeBytes;
    this.cache.set(id, { record, sizeBytes, lastAccessAt: this.now() });
    this.totalBytes += sizeBytes;
    this.trimCapacity();
  }

  private evict(id: string, persistDelete: boolean): void {
    const entry = this.cache.get(id);
    if (entry) this.totalBytes -= entry.sizeBytes;
    this.cache.delete(id);
    if (persistDelete) {
      const separator = id.indexOf("\u0000");
      const namespace = id.slice(0, separator);
      const key = id.slice(separator + 1);
      this.queue({ type: "delete", namespace, key });
      this.scheduleFlush();
    }
  }

  private trimCapacity(): void {
    while (this.cache.size > this.options.maxEntries || this.totalBytes > this.options.maxBytes) {
      const candidate = [...this.cache.entries()]
        .filter(([id]) => !this.pending.has(id))
        .sort((a, b) => a[1].lastAccessAt - b[1].lastAccessAt)[0];
      if (!candidate) break;
      this.evict(candidate[0], false);
    }
  }

  private scheduleCleanup(): void {
    this.timer = setTimeout(() => {
      this.timer = undefined;
      for (const [id, entry] of this.cache) {
        if (this.isExpired(entry.record) || this.isIdle(entry)) this.evict(id, this.isExpired(entry.record));
      }
      this.trimCapacity();
      this.scheduleCleanup();
    }, this.options.cleanupIntervalMs);
    (this.timer as unknown as { unref?: () => void }).unref?.();
  }

  private scheduleFlush(): void {
    if (this.flushTimer || this.pending.size >= this.options.flushBatchSize) {
      if (this.pending.size >= this.options.flushBatchSize) void this.flush();
      return;
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      void this.flush();
    }, this.options.flushDebounceMs);
  }

  private isExpired(record: KvRecord): boolean {
    return record.expiresAt !== undefined && Date.parse(record.expiresAt) <= this.now();
  }

  private isIdle(entry: CacheEntry): boolean {
    return this.options.idleTtlMs !== undefined && entry.lastAccessAt + this.options.idleTtlMs <= this.now();
  }

  private meta(record: KvRecord, sizeBytes?: number): KvRecordMeta {
    const { value: _value, ...meta } = record;
    return { ...meta, sizeBytes: sizeBytes ?? encodeValue(record.value).sizeBytes };
  }

  private assertKey(namespace: string, key: string): void {
    assertKvPart(namespace, "namespace");
    assertKvPart(key, "key");
  }
}
