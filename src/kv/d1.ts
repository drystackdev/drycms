import type { D1Database, D1Result } from "../content-types/engine/d1-driver.js";
import { decodeCursor, decodeValue, encodeCursor, encodeValue } from "./codec.js";
import type { KeyValueAdapter, KvBatchOperation, KvListOptions, KvListResult, KvRecord, KvRecordMeta } from "./types.js";

interface Row {
  namespace: string;
  key: string;
  value: string;
  version: number;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
}

export function createD1KeyValueAdapter(database: D1Database): KeyValueAdapter {
  let initialized: Promise<void> | undefined;
  async function init(): Promise<void> {
    initialized ??= database.prepare(`
      CREATE TABLE IF NOT EXISTS dry_kv_records (
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT,
        PRIMARY KEY (namespace, key)
      )
    `).run().then(() => undefined);
    await initialized;
  }
  function fromRow(row: Row): KvRecord {
    return {
      namespace: row.namespace,
      key: row.key,
      value: decodeValue(row.value),
      version: row.version,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      ...(row.expires_at ? { expiresAt: row.expires_at } : {}),
    };
  }
  function meta(record: KvRecord): KvRecordMeta {
    const { value: _value, ...rest } = record;
    return { ...rest, sizeBytes: encodeValue(record.value).sizeBytes };
  }
  function statement(record: KvRecord) {
    const encoded = encodeValue(record.value);
    return database.prepare(`
      INSERT INTO dry_kv_records (namespace, key, value, version, created_at, updated_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(namespace, key) DO UPDATE SET value=excluded.value, version=excluded.version,
      updated_at=excluded.updated_at, expires_at=excluded.expires_at
    `).bind(record.namespace, record.key, encoded.json, record.version, record.createdAt, record.updatedAt, record.expiresAt ?? null);
  }
  return {
    async get(namespace, key) {
      await init();
      const result = await database.prepare("SELECT * FROM dry_kv_records WHERE namespace = ? AND key = ?").bind(namespace, key).all<Row>();
      return result.results?.[0] ? fromRow(result.results[0]) : null;
    },
    async set(record) {
      await init();
      await statement(record).run();
    },
    async delete(namespace, key) {
      await init();
      await database.prepare("DELETE FROM dry_kv_records WHERE namespace = ? AND key = ?").bind(namespace, key).run();
    },
    async list(namespace, options: KvListOptions = {}): Promise<KvListResult> {
      await init();
      const start = decodeCursor(options.cursor);
      const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
      const search = options.search?.trim() ?? "";
      const result = await database.prepare(`SELECT * FROM dry_kv_records WHERE namespace = ? ${search ? "AND key LIKE ?" : ""} ORDER BY key LIMIT ? OFFSET ?`).bind(namespace, ...(search ? [`%${search}%`] : []), limit + 1, start).all<Row>();
      const rows = result.results ?? [];
      return { items: rows.slice(0, limit).map(fromRow).map(meta), ...(rows.length > limit ? { nextCursor: encodeCursor(start + limit) } : {}) };
    },
    async batch(operations: KvBatchOperation[]) {
      await init();
      const statements = operations.map((operation) => operation.type === "delete"
        ? database.prepare("DELETE FROM dry_kv_records WHERE namespace = ? AND key = ?").bind(operation.namespace, operation.key)
        : statement(operation.record!));
      if (statements.length) await database.batch(statements);
    },
  };
}
