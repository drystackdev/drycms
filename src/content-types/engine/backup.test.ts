import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { D1Database, D1PreparedStatement, D1Result } from "./d1-driver.js";
import { resolveSqliteDriver, type SqliteHandle } from "./sqlite-driver.js";
import { buildSqlDump, d1RawHandle, parseSqlDump, restoreFromDump, sqliteRawHandle } from "./backup.js";

/** Same fake-D1-over-real-SQLite double `entries-d1.test.ts` uses - see that
 * file's own doc comment for why this is a faithful enough stand-in for a
 * live Cloudflare binding. */
function createFakeD1(handle: SqliteHandle): D1Database {
  return {
    prepare(sql: string): D1PreparedStatement {
      let boundParams: unknown[] = [];
      const statement: D1PreparedStatement = {
        bind(...params: unknown[]) {
          boundParams = params;
          return statement;
        },
        async run(): Promise<D1Result> {
          const result = handle.run(sql, boundParams);
          return { success: true, meta: { changes: result.changes, last_row_id: result.lastInsertRowid } };
        },
        async all<T>(): Promise<D1Result<T>> {
          const results = handle.all<T>(sql, boundParams);
          return { success: true, results, meta: {} };
        },
      };
      return statement;
    },
    async batch(statements: D1PreparedStatement[]): Promise<D1Result[]> {
      const results: D1Result[] = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
  };
}

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

async function freshSqliteHandle(): Promise<SqliteHandle> {
  const dir = mkdtempSync(join(tmpdir(), "drycms-backup-test-"));
  dirs.push(dir);
  return resolveSqliteDriver(join(dir, "content.sqlite"));
}

/** Tricky-on-purpose content: an embedded single quote (SQL escaping), a
 * semicolon+newline inside a string (the exact case a naive `.split(";")`
 * statement splitter would break on), NULL, an integer, and real Vietnamese
 * text (this app's admin content is frequently Vietnamese). */
function seedContent(handle: SqliteHandle): void {
  handle.exec(`CREATE TABLE "post" ("id" INTEGER PRIMARY KEY, "title" TEXT, "body" TEXT, "views" INTEGER, "deleted_at" TEXT);`);
  handle.run(`INSERT INTO "post" ("id","title","body","views","deleted_at") VALUES (?,?,?,?,?);`, [
    1,
    "It's a test; with a twist",
    "line one;\nline two has a semicolon; right here\nline three - Xin chào thế giới",
    42,
    null,
  ]);
  handle.exec(`CREATE TABLE "tag" ("id" INTEGER PRIMARY KEY, "name" TEXT NOT NULL);`);
  handle.run(`INSERT INTO "tag" ("id","name") VALUES (?,?);`, [1, "News"]);
  handle.run(`INSERT INTO "tag" ("id","name") VALUES (?,?);`, [2, "Đời sống"]);
}

describe("buildSqlDump / parseSqlDump / restoreFromDump (sqlite)", () => {
  it("round-trips schema + rows, including quotes/semicolons/newlines/unicode, into a fresh database", async () => {
    const source = await freshSqliteHandle();
    seedContent(source);

    const dump = await buildSqlDump(sqliteRawHandle(source));
    const statements = parseSqlDump(dump);
    expect(statements.length).toBeGreaterThan(0);

    const target = await freshSqliteHandle();
    await restoreFromDump(sqliteRawHandle(target), statements);

    const posts = target.all<{ id: number; title: string; body: string; views: number; deleted_at: string | null }>(
      `SELECT * FROM "post" ORDER BY "id";`,
    );
    expect(posts).toEqual([
      {
        id: 1,
        title: "It's a test; with a twist",
        body: "line one;\nline two has a semicolon; right here\nline three - Xin chào thế giới",
        views: 42,
        deleted_at: null,
      },
    ]);
    const tags = target.all<{ id: number; name: string }>(`SELECT * FROM "tag" ORDER BY "id";`);
    expect(tags).toEqual([
      { id: 1, name: "News" },
      { id: 2, name: "Đời sống" },
    ]);
  });

  it("fully replaces the target's current tables, not merges", async () => {
    const source = await freshSqliteHandle();
    seedContent(source);
    const dump = await buildSqlDump(sqliteRawHandle(source));
    const statements = parseSqlDump(dump);

    const target = await freshSqliteHandle();
    // Pre-existing state the restore must wipe: a row that would collide on
    // primary key if this were a merge, and a whole table not present in the
    // dump at all (must be dropped, not left behind).
    target.exec(`CREATE TABLE "post" ("id" INTEGER PRIMARY KEY, "title" TEXT, "body" TEXT, "views" INTEGER, "deleted_at" TEXT);`);
    target.run(`INSERT INTO "post" ("id","title","body","views","deleted_at") VALUES (?,?,?,?,?);`, [1, "stale", "stale", 0, null]);
    target.exec(`CREATE TABLE "orphan" ("id" INTEGER PRIMARY KEY);`);

    const restoredRows = await restoreFromDump(sqliteRawHandle(target), statements);
    expect(restoredRows).toBe(3); // 1 post + 2 tags

    const posts = target.all<{ title: string }>(`SELECT "title" FROM "post";`);
    expect(posts).toEqual([{ title: "It's a test; with a twist" }]);
    expect(() => target.all(`SELECT * FROM "orphan";`)).toThrow();
  });

  it("rejects a statement outside the fixed allowlist", () => {
    expect(() => parseSqlDump(`DROP TABLE IF EXISTS "post";\nATTACH DATABASE 'evil.db' AS evil;`)).toThrow(/Unsupported statement/);
  });
});

describe("buildSqlDump / restoreFromDump (D1)", () => {
  it("round-trips through the D1 raw handle the same as sqlite", async () => {
    const sourceHandle = await freshSqliteHandle();
    seedContent(sourceHandle);
    const sourceDb = createFakeD1(sourceHandle);

    const dump = await buildSqlDump(d1RawHandle(sourceDb));
    const statements = parseSqlDump(dump);

    const targetHandle = await freshSqliteHandle();
    const targetDb = createFakeD1(targetHandle);
    const restoredRows = await restoreFromDump(d1RawHandle(targetDb), statements);
    expect(restoredRows).toBe(3);

    const tags = targetHandle.all<{ name: string }>(`SELECT "name" FROM "tag" ORDER BY "id";`);
    expect(tags).toEqual([{ name: "News" }, { name: "Đời sống" }]);
  });
});
