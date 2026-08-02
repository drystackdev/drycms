export interface KvRecord {
  namespace: string;
  key: string;
  value: unknown;
  version: number;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string;
}

export interface KvRecordMeta extends Omit<KvRecord, "value"> {
  sizeBytes: number;
}

export interface KvListOptions {
  cursor?: string;
  limit?: number;
  search?: string;
}

export interface KvListResult {
  items: KvRecordMeta[];
  nextCursor?: string;
  revision?: number;
}

export interface KvBatchOperation {
  type: "set" | "delete";
  record?: KvRecord;
  namespace: string;
  key: string;
}

export interface KeyValueAdapter {
  get(namespace: string, key: string): Promise<KvRecord | null>;
  /** Remove and return a record as one backend operation when possible. */
  take?(namespace: string, key: string): Promise<KvRecord | null>;
  set(record: KvRecord): Promise<void>;
  delete(namespace: string, key: string): Promise<void>;
  list(namespace: string, options?: KvListOptions): Promise<KvListResult>;
  batch?(operations: KvBatchOperation[]): Promise<void>;
  /** Atomically increments a counter when the backend supports it. */
  increment?(namespace: string, key: string, windowMs: number, ttlMs: number): Promise<{ count: number; windowStartedAt: number }>;
  deleteCounter?(namespace: string, key: string): Promise<void>;
  close?(): Promise<void>;
}

export type KvDurability = "memory" | "async" | "sync";

export interface KeyValueStoreOptions {
  /** Disable the in-process cache for security-sensitive state. */
  cache?: boolean;
  defaultTtlMs?: number;
  idleTtlMs?: number;
  cleanupIntervalMs?: number;
  maxEntries?: number;
  maxBytes?: number;
  flushDebounceMs?: number;
  flushBatchSize?: number;
  durability?: KvDurability;
  now?: () => number;
}

export interface KvSetOptions {
  ttlMs?: number;
  durability?: KvDurability;
}

export interface KvGetOptions {
  allowStaleOnError?: boolean;
}

export interface KvFlushResult {
  flushed: number;
  failed: number;
  revision: number;
}

export class KeyValueError extends Error {
  readonly code: "invalid_key" | "invalid_value" | "backend_unavailable" | "conflict";

  constructor(code: KeyValueError["code"], message: string) {
    super(message);
    this.name = "KeyValueError";
    this.code = code;
  }
}

export function kvId(namespace: string, key: string): string {
  return `${namespace}\u0000${key}`;
}
