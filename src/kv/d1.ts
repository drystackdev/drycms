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

interface CounterRow {
  count: number;
  window_started_at: number;
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
    `).run().then(async () => {
      await database.prepare(`CREATE TABLE IF NOT EXISTS dry_kv_counters (
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        count INTEGER NOT NULL,
        window_started_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        PRIMARY KEY (namespace, key)
      )`).run();
    });
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
    async increment(namespace, key, windowMs, ttlMs) {
      await init();
      const now = Date.now();
      const result = await database.prepare(
        `INSERT INTO dry_kv_counters (namespace, key, count, window_started_at, expires_at)
         VALUES (?, ?, 1, ?, ?)
         ON CONFLICT(namespace, key) DO UPDATE SET
           count = CASE WHEN dry_kv_counters.window_started_at + ? <= excluded.window_started_at THEN 1 ELSE dry_kv_counters.count + 1 END,
           window_started_at = CASE WHEN dry_kv_counters.window_started_at + ? <= excluded.window_started_at THEN excluded.window_started_at ELSE dry_kv_counters.window_started_at END,
           expires_at = excluded.expires_at
         RETURNING count, window_started_at`,
      ).bind(namespace, key, now, now + ttlMs, windowMs, windowMs).all<CounterRow>();
      const row = result.results?.[0];
      if (!row) throw new Error("[drycms] D1 counter update returned no row.");
      return { count: Number(row.count), windowStartedAt: Number(row.window_started_at) };
    },
    async deleteCounter(namespace, key) {
      await init();
      await database.prepare("DELETE FROM dry_kv_counters WHERE namespace = ? AND key = ?").bind(namespace, key).run();
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
