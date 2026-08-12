import { quoteIdent } from "../naming.js";
import { ContentEngineError } from "./types.js";
import type { D1Database } from "./d1-driver.js";
import type { SqliteHandle } from "./sqlite-driver.js";

/** Table names D1/SQLite manage for themselves - never part of a content
 * backup/restore, and dropping them would break the live connection or
 * D1's own bookkeeping. */
function isInternalTable(name: string): boolean {
  return name.startsWith("sqlite_") || name.startsWith("_cf_") || name === "d1_migrations";
}

/**
 * Thin engine-agnostic view over "list real tables" / "read a whole table" /
 * "run a batch of writes" - lets `buildSqlDump`/`restoreFromDump` below
 * share one implementation across both the local SQLite driver and a D1
 * binding, the same split every other `content-types/engine/*` adapter
 * already makes between the two, just scoped to whole-database backup/
 * restore instead of per-content-type CRUD.
 */
export interface RawSqlHandle {
  listTables(): Promise<{ name: string; sql: string }[]>;
  queryAll(table: string): Promise<Record<string, unknown>[]>;
  /** Runs every statement as one all-or-nothing unit where the underlying
   * engine supports it (a real transaction locally); D1 has no
   * multi-batch transaction (see `engine/d1.ts`'s own doc comment on this
   * same limitation) - a restore there is atomic per internal chunk, not as
   * a whole. */
  execAll(statements: string[]): Promise<void>;
}

export function sqliteRawHandle(handle: SqliteHandle): RawSqlHandle {
  return {
    async listTables() {
      const rows = handle.all<{ name: string; sql: string }>(
        `SELECT "name", "sql" FROM "sqlite_master" WHERE "type" = 'table' ORDER BY "name";`,
      );
      return rows.filter((row) => !isInternalTable(row.name));
    },
    async queryAll(table) {
      return handle.all<Record<string, unknown>>(`SELECT * FROM ${quoteIdent(table)};`);
    },
    async execAll(statements) {
      handle.exec("BEGIN IMMEDIATE;");
      try {
        for (const statement of statements) handle.exec(statement);
        handle.exec("COMMIT;");
      } catch (error) {
        handle.exec("ROLLBACK;");
        throw error;
      }
    },
  };
}

/** Keeps each `db.batch()` call comfortably under D1's per-batch statement
 * cap (1,000 on the free tier, per `references/d1/gotchas.md`) - a restore
 * of a large content DB can easily exceed that in INSERT statements alone. */
const D1_BATCH_CHUNK = 500;

export function d1RawHandle(db: D1Database): RawSqlHandle {
  return {
    async listTables() {
      const result = await db
        .prepare(`SELECT "name", "sql" FROM "sqlite_master" WHERE "type" = 'table' ORDER BY "name";`)
        .all<{ name: string; sql: string }>();
      return (result.results ?? []).filter((row) => !isInternalTable(row.name));
    },
    async queryAll(table) {
      const result = await db.prepare(`SELECT * FROM ${quoteIdent(table)};`).all<Record<string, unknown>>();
      return result.results ?? [];
    },
    async execAll(statements) {
      for (let i = 0; i < statements.length; i += D1_BATCH_CHUNK) {
        const chunk = statements.slice(i, i + D1_BATCH_CHUNK);
        await db.batch(chunk.map((sql) => db.prepare(sql)));
      }
    },
  };
}

function sqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  if (value instanceof Uint8Array) return `X'${Buffer.from(value).toString("hex")}'`;
  if (Array.isArray(value)) return `X'${Buffer.from(value as number[]).toString("hex")}'`;
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Dumps every real content table (schema + rows) to a plain, portable SQL
 * script - `DROP TABLE IF EXISTS` + the table's own `CREATE TABLE` (verbatim
 * from `sqlite_master`) + one `INSERT INTO ... VALUES (...)` per row, values
 * inlined as literals rather than parameterized (this is a static file, not
 * a live query). Both `content.engine` values produce this exact same
 * format, and it's the only format `restoreFromDump` accepts back - this is
 * a drycms-to-drycms round trip, not a general-purpose SQL dump importer.
 */
export async function buildSqlDump(handle: RawSqlHandle): Promise<string> {
  const tables = await handle.listTables();
  const lines: string[] = ["-- drycms content backup", `-- generated ${new Date().toISOString()}`, ""];
  for (const table of tables) {
    const createSql = table.sql.trim().replace(/;\s*$/, "");
    lines.push(`DROP TABLE IF EXISTS ${quoteIdent(table.name)};`, `${createSql};`);
    const rows = await handle.queryAll(table.name);
    for (const row of rows) {
      const columns = Object.keys(row);
      if (columns.length === 0) continue;
      const values = columns.map((column) => sqlLiteral(row[column]));
      lines.push(`INSERT INTO ${quoteIdent(table.name)} (${columns.map(quoteIdent).join(", ")}) VALUES (${values.join(", ")});`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

const STATEMENT_ALLOWLIST = /^(DROP TABLE IF EXISTS|CREATE TABLE|CREATE UNIQUE INDEX|CREATE INDEX|INSERT INTO)\s/i;

function stripCommentLines(statement: string): string {
  return statement.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n").trim();
}

/**
 * Splits a SQL script into individual statements, respecting `'...'`/`"..."`
 * quoted spans (with their standard doubled-quote escape) so a `;` inside a
 * string value never ends a statement early - the one thing a naive
 * `.split(";")` gets wrong for real content (rich text, JSON fields, ...).
 * Leading `--` comment lines are stripped from each statement (this format
 * never puts one anywhere else), then every statement is checked against a
 * fixed allowlist of the exact statement kinds `buildSqlDump` ever emits -
 * restoring is Super Admin-only already, but a whole uploaded file is about
 * to be executed verbatim, so this is defense in depth against a corrupted
 * or hand-edited upload, not just a format check.
 */
export function parseSqlDump(text: string): string[] {
  const statements: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    current += ch;
    if (quote) {
      if (ch === quote) {
        if (text[i + 1] === quote) {
          current += quote;
          i++;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (ch === ";") {
      const statement = stripCommentLines(current);
      if (statement) statements.push(statement);
      current = "";
    }
  }
  const tail = stripCommentLines(current);
  if (tail) statements.push(tail);

  for (const statement of statements) {
    if (!STATEMENT_ALLOWLIST.test(statement)) {
      throw new ContentEngineError("invalid_definition", `Unsupported statement in backup file: "${statement.slice(0, 60)}".`);
    }
  }
  return statements;
}

/**
 * Wipes every current real table and replays a dump's statements against it
 * - `handle.listTables()` is read fresh right before dropping (not the
 * dump's own table list), so a table that existed when the backup was taken
 * but was later removed from the live schema still gets dropped: the same
 * "restore fully replaces current state" contract a real database restore
 * implies, not a merge. Returns the number of rows restored (for the
 * caller's confirmation toast).
 */
export async function restoreFromDump(handle: RawSqlHandle, statements: string[]): Promise<number> {
  const currentTables = await handle.listTables();
  const dropStatements = currentTables.map((table) => `DROP TABLE IF EXISTS ${quoteIdent(table.name)};`);
  await handle.execAll([...dropStatements, ...statements]);
  return statements.filter((statement) => /^INSERT INTO/i.test(statement)).length;
}
