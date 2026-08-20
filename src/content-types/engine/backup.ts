import { quoteIdent } from "../naming.js";
import { ContentEngineError } from "./types.js";
import type { D1Database } from "./d1-driver.js";
import type { SqliteHandle } from "./sqlite-driver.js";

/** Table names D1/SQLite manage for themselves - never part of a content
 * backup/restore, and dropping them would break the live connection or
 * D1's own bookkeeping. `dry_kv_*` (`kv/d1.ts`/`kv/sqlite.ts`) is this app's
 * own auth/session/rate-limit store under `kind: "cloudflare"` - it shares
 * this same database (`options.ts`'s `resolveKvOption` points `kv.kind:
 * "D1"` at the identical `CONTENT_DB` binding as `content`), not a separate
 * one, so without this exclusion a content restore/reset would silently wipe
 * every live session, MCP/OAuth token, and login rate-limit counter too. */
function isInternalTable(name: string): boolean {
  return name.startsWith("sqlite_") || name.startsWith("_cf_") || name === "d1_migrations" || name.startsWith("dry_kv_");
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
  /** Whether one `execAll` call is guaranteed to roll back as a whole. */
  atomicExecAll: boolean;
  listTables(): Promise<{ name: string; sql: string }[]>;
  /** Every standalone index (`CREATE [UNIQUE] INDEX ...`) - critically
   * including unique indexes migration.ts creates for `unique: true`
   * fields (`ux_user_email`, `ux_role_name`, ...), which live OUTSIDE the
   * owning table's own `CREATE TABLE` statement and so are invisible to
   * `listTables()`. Excludes sqlite's own auto-indexes for inline PK/UNIQUE
   * column constraints (`sql IS NULL` in `sqlite_master` for those - they
   * come back for free with the table's own `CREATE TABLE`, re-explaining
   * them here would be redundant at best). */
  listIndexes(): Promise<{ name: string; sql: string }[]>;
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
    atomicExecAll: true,
    async listTables() {
      const rows = handle.all<{ name: string; sql: string }>(
        `SELECT "name", "sql" FROM "sqlite_master" WHERE "type" = 'table' ORDER BY "name";`,
      );
      return rows.filter((row) => !isInternalTable(row.name));
    },
    async listIndexes() {
      const rows = handle.all<{ name: string; sql: string | null }>(
        `SELECT "name", "sql" FROM "sqlite_master" WHERE "type" = 'index' AND "sql" IS NOT NULL ORDER BY "name";`,
      );
      return rows.filter((row): row is { name: string; sql: string } => !isInternalTable(row.name));
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
    atomicExecAll: false,
    async listTables() {
      const result = await db
        .prepare(`SELECT "name", "sql" FROM "sqlite_master" WHERE "type" = 'table' ORDER BY "name";`)
        .all<{ name: string; sql: string }>();
      return (result.results ?? []).filter((row) => !isInternalTable(row.name));
    },
    async listIndexes() {
      const result = await db
        .prepare(`SELECT "name", "sql" FROM "sqlite_master" WHERE "type" = 'index' AND "sql" IS NOT NULL ORDER BY "name";`)
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

/** Exported for `routes/full-reset.ts`, which hand-builds a few extra
 * `INSERT` statements (the preserved admin's `user`/`role`/`user_roles` rows)
 * to append to a fresh-boot dump before replaying it via `restoreFromDump` -
 * reuses the exact same literal-escaping `buildSqlDump` uses for everything
 * else, rather than a second implementation that could drift from it. */
export function sqlLiteral(value: unknown): string {
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
 * a live query), followed by every standalone index (`listIndexes()`) -
 * emitted last, once every table it could reference already exists. Both
 * `content.engine` values produce this exact same format, and it's the only
 * format `restoreFromDump` accepts back - this is a drycms-to-drycms round
 * trip, not a general-purpose SQL dump importer.
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
  const indexes = await handle.listIndexes();
  for (const index of indexes) {
    lines.push(`${index.sql.trim().replace(/;\s*$/, "")};`);
  }
  if (indexes.length > 0) lines.push("");
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
  if (!/^\s*-- drycms content backup(?:\r?\n|$)/.test(text)) {
    throw new ContentEngineError("invalid_definition", "This is not a drycms database backup file.");
  }
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
  validateDumpStructure(statements);
  return statements;
}

const SQL_IDENTIFIER = String.raw`(?:"((?:[^"]|"")+)"|([A-Za-z_][A-Za-z0-9_$]*))`;
const DROP_TABLE_NAME = new RegExp(`^DROP TABLE IF EXISTS\\s+${SQL_IDENTIFIER}\\s*;?$`, "i");
const CREATE_TABLE_NAME = new RegExp(`^CREATE TABLE\\s+(?:IF NOT EXISTS\\s+)?${SQL_IDENTIFIER}(?=\\s|\\()`, "i");
const INSERT_TABLE_NAME = new RegExp(`^INSERT INTO\\s+${SQL_IDENTIFIER}(?=\\s|\\()`, "i");

function matchedIdentifier(match: RegExpMatchArray | null): string | null {
  if (!match) return null;
  return (match[1] ?? match[2] ?? "").replace(/""/g, '"');
}

/** Ensures the upload is a complete dump produced by `buildSqlDump`, rather
 * than merely a collection of individually safe SQL statements. This check
 * runs before the live database is touched. */
function validateDumpStructure(statements: string[]): void {
  const dropped = new Set<string>();
  const created = new Set<string>();

  for (const statement of statements) {
    const dropName = matchedIdentifier(statement.match(DROP_TABLE_NAME));
    if (dropName) {
      if (dropped.has(dropName)) throw new ContentEngineError("invalid_definition", `Duplicate table in backup: "${dropName}".`);
      dropped.add(dropName);
      continue;
    }

    const createName = matchedIdentifier(statement.match(CREATE_TABLE_NAME));
    if (createName) {
      if (!dropped.has(createName) || created.has(createName)) {
        throw new ContentEngineError("invalid_definition", `Invalid table definition order in backup: "${createName}".`);
      }
      created.add(createName);
      continue;
    }

    const insertName = matchedIdentifier(statement.match(INSERT_TABLE_NAME));
    if (insertName && !created.has(insertName)) {
      throw new ContentEngineError("invalid_definition", `Backup inserts into undefined table: "${insertName}".`);
    }
  }

  if (created.size === 0 || dropped.size !== created.size || [...dropped].some((name) => !created.has(name))) {
    throw new ContentEngineError("invalid_definition", "The backup does not contain a complete set of table definitions.");
  }
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
  if (handle.atomicExecAll) {
    await handle.execAll([...dropStatements, ...statements]);
  } else {
    // D1 cannot keep a restore larger than one batch in a single
    // transaction. Capture the exact old state before the first destructive
    // chunk so a mid-restore failure can be compensated immediately.
    const recoveryStatements = currentTables.length > 0 ? parseSqlDump(await buildSqlDump(handle)) : [];
    try {
      await handle.execAll([...dropStatements, ...statements]);
    } catch (restoreError) {
      try {
        const partialTables = await handle.listTables();
        const cleanup = partialTables.map((table) => `DROP TABLE IF EXISTS ${quoteIdent(table.name)};`);
        await handle.execAll([...cleanup, ...recoveryStatements]);
      } catch (recoveryError) {
        throw new AggregateError([restoreError, recoveryError], "Database restore failed and the previous state could not be recovered.");
      }
      throw restoreError;
    }
  }
  return statements.filter((statement) => /^INSERT INTO/i.test(statement)).length;
}
