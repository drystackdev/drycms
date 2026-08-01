import type { Statement } from "../migration.js";

/**
 * A minimal, hand-rolled subset of Cloudflare's `D1Database` API - the same
 * small Cloudflare-specific shapes rather than depending on
 * `@cloudflare/workers-types` just for one interface. Structurally
 * compatible with the real binding; consumers pass the genuine object at
 * runtime, this is only a type. Shared by both the schema engine
 * (`engine/d1.ts`) and the entry engine (`engine/entries-d1.ts`).
 */
export interface D1Result<T = unknown> {
  results?: T[];
  success: boolean;
  meta: { changes?: number; last_row_id?: number; [key: string]: unknown };
}
export interface D1PreparedStatement {
  bind(...params: unknown[]): D1PreparedStatement;
  run(): Promise<D1Result>;
  all<T = unknown>(): Promise<D1Result<T>>;
}
export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<D1Result[]>;
}

export function prepare(db: D1Database, statement: Statement): D1PreparedStatement {
  return db.prepare(statement.sql).bind(...(statement.params ?? []));
}

export async function runBatch(db: D1Database, statements: Statement[]): Promise<void> {
  if (statements.length === 0) return;
  await db.batch(statements.map((s) => prepare(db, s)));
}
