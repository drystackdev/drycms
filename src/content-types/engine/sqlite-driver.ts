import { ContentEngineError } from "./types.js";

/** Shared by both the schema engine (`engine/sqlite.ts`) and the entry engine
 * (`engine/entries-sqlite.ts`) - one connection-resolution/wrapper layer for
 * whichever of `bun:sqlite`/`node:sqlite`/`better-sqlite3` is actually
 * available on the host platform. */
export interface SqliteHandle {
  exec(sql: string): void;
  run(sql: string, params?: unknown[]): { changes: number; lastInsertRowid?: number };
  all<T = unknown>(sql: string, params?: unknown[]): T[];
}

function wrapBunSqlite(DatabaseCtor: any, file: string): SqliteHandle {
  const db = new DatabaseCtor(file);
  return {
    exec(sql) {
      db.run(sql);
    },
    run(sql, params = []) {
      const result = db.run(sql, ...params);
      return { changes: result?.changes ?? 0, lastInsertRowid: Number(result?.lastInsertRowid ?? 0) };
    },
    all(sql, params = []) {
      return db.query(sql).all(...params);
    },
  };
}

function wrapNodeSqlite(DatabaseSyncCtor: any, file: string): SqliteHandle {
  const db = new DatabaseSyncCtor(file);
  return {
    exec(sql) {
      db.exec(sql);
    },
    run(sql, params = []) {
      const result = db.prepare(sql).run(...params);
      return { changes: Number(result.changes), lastInsertRowid: Number(result.lastInsertRowid ?? 0) };
    },
    all(sql, params = []) {
      return db.prepare(sql).all(...params);
    },
  };
}

function wrapBetterSqlite3(DatabaseCtor: any, file: string): SqliteHandle {
  const db = new DatabaseCtor(file);
  return {
    exec(sql) {
      db.exec(sql);
    },
    run(sql, params = []) {
      const result = db.prepare(sql).run(...params);
      return { changes: result.changes, lastInsertRowid: Number(result.lastInsertRowid ?? 0) };
    },
    all(sql, params = []) {
      return db.prepare(sql).all(...params);
    },
  };
}

/** Takes the module specifier as a runtime value (not a string literal) on
 * purpose: TypeScript only attempts to resolve/typecheck a dynamic `import()`
 * whose argument is a literal, so routing it through a `string`-typed
 * parameter here sidesteps needing ambient types (or a real dependency) for
 * `bun:sqlite`/`node:sqlite`/the optional `better-sqlite3` peer dependency -
 * exactly one of which is expected to actually resolve at runtime, depending
 * on the host platform. */
async function tryImport(specifier: string): Promise<any | undefined> {
  try {
    return await import(/* @vite-ignore */ specifier);
  } catch {
    return undefined;
  }
}

export async function resolveSqliteDriver(file: string): Promise<SqliteHandle> {
  const bun = await tryImport("bun:sqlite");
  if (bun) return wrapBunSqlite(bun.Database, file);

  const node = await tryImport("node:sqlite");
  if (node) return wrapNodeSqlite(node.DatabaseSync, file);

  const better = await tryImport("better-sqlite3");
  if (better) return wrapBetterSqlite3(better.default ?? better, file);

  throw new ContentEngineError(
    "unsupported",
    '[drycms] content.engine "sqlite" needs one of bun:sqlite, node:sqlite (Node 22.5+), or the optional peer dependency "better-sqlite3" (run `bun add better-sqlite3`) - none were available.',
  );
}
