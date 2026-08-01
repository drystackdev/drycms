import type { ResolvedSqliteContentOption } from "../server/options.js";
import { resolveSqliteDriver, type SqliteHandle } from "../content-types/engine/sqlite-driver.js";
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

export function createSqliteKeyValueAdapter(file: string): KeyValueAdapter {
  let dbPromise: Promise<SqliteHandle> | undefined;
  async function db(): Promise<SqliteHandle> {
    const handle = await (dbPromise ??= resolveSqliteDriver(file));
    handle.exec(`
      CREATE TABLE IF NOT EXISTS dry_kv_records (
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        version INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT,
        PRIMARY KEY (namespace, key)
      );
      CREATE INDEX IF NOT EXISTS dry_kv_records_expiry ON dry_kv_records (expires_at);
    `);
    return handle;
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
  function toMeta(record: KvRecord): KvRecordMeta {
    const { value: _value, ...meta } = record;
    return { ...meta, sizeBytes: encodeValue(record.value).sizeBytes };
  }
  return {
    async get(namespace, key) {
      const row = (await db()).all<Row>("SELECT * FROM dry_kv_records WHERE namespace = ? AND key = ?", [namespace, key])[0];
      return row ? fromRow(row) : null;
    },
    async set(record) {
      const encoded = encodeValue(record.value);
      (await db()).run(
        `INSERT INTO dry_kv_records (namespace, key, value, version, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(namespace, key) DO UPDATE SET value=excluded.value, version=excluded.version,
         updated_at=excluded.updated_at, expires_at=excluded.expires_at`,
        [record.namespace, record.key, encoded.json, record.version, record.createdAt, record.updatedAt, record.expiresAt ?? null],
      );
    },
    async delete(namespace, key) {
      (await db()).run("DELETE FROM dry_kv_records WHERE namespace = ? AND key = ?", [namespace, key]);
    },
    async list(namespace, options: KvListOptions = {}): Promise<KvListResult> {
      const start = decodeCursor(options.cursor);
      const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
      const search = options.search?.trim() ?? "";
      const rows = (await db()).all<Row>(
        `SELECT * FROM dry_kv_records WHERE namespace = ? ${search ? "AND key LIKE ?" : ""} ORDER BY key LIMIT ? OFFSET ?`,
        search ? [namespace, `%${search}%`, limit + 1, start] : [namespace, limit + 1, start],
      );
      const hasNext = rows.length > limit;
      return { items: rows.slice(0, limit).map(fromRow).map(toMeta), ...(hasNext ? { nextCursor: encodeCursor(start + limit) } : {}) };
    },
    async batch(operations: KvBatchOperation[]) {
      const handle = await db();
      for (const operation of operations) {
        if (operation.type === "delete") handle.run("DELETE FROM dry_kv_records WHERE namespace = ? AND key = ?", [operation.namespace, operation.key]);
        else if (operation.record) {
          const encoded = encodeValue(operation.record.value);
          handle.run(
            `INSERT INTO dry_kv_records (namespace, key, value, version, created_at, updated_at, expires_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(namespace, key) DO UPDATE SET value=excluded.value, version=excluded.version,
             updated_at=excluded.updated_at, expires_at=excluded.expires_at`,
            [operation.record.namespace, operation.record.key, encoded.json, operation.record.version, operation.record.createdAt, operation.record.updatedAt, operation.record.expiresAt ?? null],
          );
        }
      }
    },
  };
}
