import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { D1Database, D1PreparedStatement, D1Result } from "./d1-driver.js";
import { createD1PagesRegistryAdapter } from "./pages-registry-d1.js";
import { resolveSqliteDriver, type SqliteHandle } from "./sqlite-driver.js";
import type { PageRecord } from "./pages-registry-types.js";

/** Same fake-D1-over-real-SQLite double as `entries-d1.test.ts` uses - real
 * D1 is SQLite-compatible, so this exercises `pages-registry-d1.ts`'s own
 * SQL without a live Cloudflare binding. */
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

async function freshAdapter() {
  const dir = mkdtempSync(join(tmpdir(), "drycms-pages-registry-d1-test-"));
  const handle = await resolveSqliteDriver(join(dir, "content.sqlite"));
  const db = createFakeD1(handle);
  const binding = "CONTENT_DB";
  const adapter = createD1PagesRegistryAdapter({ engine: "D1", binding }, { [binding]: db });
  return { adapter, dir };
}

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function page(overrides: Partial<PageRecord> = {}): PageRecord {
  return {
    path: "/blogs/abc",
    objectKey: "pages/build-1/blogs/abc.html",
    buildId: "build-1",
    builtAt: 1000,
    inSitemap: true,
    sourceHash: null,
    ...overrides,
  };
}

describe("createD1PagesRegistryAdapter", () => {
  it("records a build and lists it in the sitemap", async () => {
    const { adapter, dir } = await freshAdapter();
    dirs.push(dir);

    await adapter.recordBuild(page(), [{ resource: "blog", version: 1 }]);

    const entries = await adapter.listSitemapEntries();
    expect(entries).toEqual([{ path: "/blogs/abc", builtAt: 1000 }]);
  });

  it("listAllPages returns every row regardless of sitemap state, sorted by path", async () => {
    const { adapter, dir } = await freshAdapter();
    dirs.push(dir);

    await adapter.recordBuild(page({ path: "/z-last", inSitemap: false }), []);
    await adapter.recordBuild(page({ path: "/a-first" }), []);

    const all = await adapter.listAllPages();
    expect(all.map((p) => p.path)).toEqual(["/a-first", "/z-last"]);
    expect(all[0]).toMatchObject({ path: "/a-first", inSitemap: true });
    expect(all[1]).toMatchObject({ path: "/z-last", inSitemap: false });
  });

  it("upsert replaces the dependency set, not appends to it", async () => {
    const { adapter, dir } = await freshAdapter();
    dirs.push(dir);

    await adapter.recordBuild(page(), [{ resource: "blog", version: 1 }, { resource: "settings", version: 1 }]);
    await adapter.recordBuild(page({ builtAt: 2000 }), [{ resource: "blog", version: 2 }]);

    expect(await adapter.listPathsByResource("blog")).toEqual(["/blogs/abc"]);
    expect(await adapter.listPathsByResource("settings")).toEqual([]);
  });

  it("listPathsByResource answers what to rebuild when a resource changes", async () => {
    const { adapter, dir } = await freshAdapter();
    dirs.push(dir);

    await adapter.recordBuild(page({ path: "/a" }), [{ resource: "blog", version: 1 }]);
    await adapter.recordBuild(page({ path: "/b" }), [{ resource: "blog", version: 1 }]);
    await adapter.recordBuild(page({ path: "/c" }), [{ resource: "settings", version: 1 }]);

    expect((await adapter.listPathsByResource("blog")).sort()).toEqual(["/a", "/b"]);
  });

  it("listResourcesByPath answers what a given page depends on - empty for a path never built", async () => {
    const { adapter, dir } = await freshAdapter();
    dirs.push(dir);

    expect(await adapter.listResourcesByPath("/never-built")).toEqual([]);

    await adapter.recordBuild(page(), [{ resource: "blog", version: 1 }, { resource: "settings", version: 1 }]);
    expect((await adapter.listResourcesByPath("/blogs/abc")).sort()).toEqual(["blog", "settings"]);

    await adapter.recordBuild(page({ builtAt: 2000 }), [{ resource: "blog", version: 2 }]);
    expect(await adapter.listResourcesByPath("/blogs/abc")).toEqual(["blog"]);
  });

  it("removePage deletes both the page row and its deps", async () => {
    const { adapter, dir } = await freshAdapter();
    dirs.push(dir);

    await adapter.recordBuild(page(), [{ resource: "blog", version: 1 }]);
    await adapter.removePage("/blogs/abc");

    expect(await adapter.listSitemapEntries()).toEqual([]);
    expect(await adapter.listPathsByResource("blog")).toEqual([]);
    expect(await adapter.listResourcesByPath("/blogs/abc")).toEqual([]);
  });

  it("clearAllPages deletes every page and dependency", async () => {
    const { adapter, dir } = await freshAdapter();
    dirs.push(dir);
    await adapter.recordBuild(page({ path: "/a" }), [{ resource: "blog", version: 1 }]);
    await adapter.recordBuild(page({ path: "/b" }), [{ resource: "settings", version: 2 }]);

    await adapter.clearAllPages();

    expect(await adapter.listAllPages()).toEqual([]);
    expect(await adapter.listPathsByResource("blog")).toEqual([]);
    expect(await adapter.listResourcesByPath("/b")).toEqual([]);
  });

  it("listStalePaths finds pages whose recorded dep version no longer matches _versions", async () => {
    const { adapter, dir } = await freshAdapter();
    dirs.push(dir);

    await adapter.recordBuild(page(), [{ resource: "blog", version: 1 }]);
    // Nothing in `_versions` yet - not stale (nothing to compare against).
    expect(await adapter.listStalePaths()).toEqual([]);

    // Same underlying file the fake D1 writes through - a second, direct
    // `node:sqlite` connection to simulate a content change bumping
    // `_versions` (real bookkeeping this adapter has no method of its own
    // for), same approach `pages-registry-sqlite.test.ts`'s own `rawDb`
    // helper uses.
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(join(dir, "content.sqlite"));
    try {
      db.exec('INSERT INTO "_versions" ("resource","version","updated_at") VALUES (\'blog\', 1, 0);');
      expect(await adapter.listStalePaths()).toEqual([]);

      db.exec('UPDATE "_versions" SET "version" = 2 WHERE "resource" = \'blog\';');
      expect(await adapter.listStalePaths()).toEqual([{ path: "/blogs/abc", resource: "blog" }]);
    } finally {
      db.close();
    }
  });

  it("round-trips a non-null sourceHash, and upsert replaces it like every other field", async () => {
    const { adapter, dir } = await freshAdapter();
    dirs.push(dir);

    await adapter.recordBuild(page({ sourceHash: "hash-1" }), []);
    expect((await adapter.listAllPages())[0]).toMatchObject({ sourceHash: "hash-1" });

    await adapter.recordBuild(page({ builtAt: 2000, sourceHash: "hash-2" }), []);
    expect((await adapter.listAllPages())[0]).toMatchObject({ sourceHash: "hash-2" });
  });

  it("migrates an existing pre-source_hash _pages table without throwing, and reads the old row back as sourceHash: null", async () => {
    const dir = mkdtempSync(join(tmpdir(), "drycms-pages-registry-d1-test-"));
    dirs.push(dir);
    const file = join(dir, "content.sqlite");

    // Simulate a real pre-existing tenant D1 database: the table exists in
    // the OLD 5-column shape, with a row already in it, before this
    // adapter's guarded `ALTER TABLE` ever runs against it.
    const { DatabaseSync } = await import("node:sqlite");
    const preMigration = new DatabaseSync(file);
    try {
      preMigration.exec(
        'CREATE TABLE "_pages" ("path" TEXT PRIMARY KEY, "object_key" TEXT NOT NULL, "build_id" TEXT NOT NULL, "built_at" INTEGER NOT NULL, "in_sitemap" INTEGER NOT NULL);',
      );
      preMigration.exec(`INSERT INTO "_pages" VALUES ('/legacy', 'pages/build-0/legacy.html', 'build-0', 500, 1);`);
    } finally {
      preMigration.close();
    }

    const handle = await resolveSqliteDriver(file);
    const adapter = createD1PagesRegistryAdapter({ engine: "D1", binding: "CONTENT_DB" }, { CONTENT_DB: createFakeD1(handle) });
    const all = await adapter.listAllPages();
    expect(all).toEqual([
      { path: "/legacy", objectKey: "pages/build-0/legacy.html", buildId: "build-0", builtAt: 500, inSitemap: true, sourceHash: null },
    ]);
  });

  it("bootstrapping twice against the same file doesn't throw (ALTER TABLE idempotency across cold starts)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "drycms-pages-registry-d1-test-"));
    dirs.push(dir);
    const file = join(dir, "content.sqlite");

    const first = createD1PagesRegistryAdapter({ engine: "D1", binding: "CONTENT_DB" }, { CONTENT_DB: createFakeD1(await resolveSqliteDriver(file)) });
    await first.recordBuild(page(), []);

    // A fresh `D1Database` object (real Cloudflare gives a new binding per
    // isolate cold start) over the SAME underlying file - `ensureBootstrap`'s
    // `WeakMap` is keyed by the `db` object, so this genuinely re-runs the
    // guarded `ALTER TABLE` rather than reusing the first adapter's memoized
    // bootstrap.
    const second = createD1PagesRegistryAdapter({ engine: "D1", binding: "CONTENT_DB" }, { CONTENT_DB: createFakeD1(await resolveSqliteDriver(file)) });
    await expect(second.listAllPages()).resolves.toMatchObject([{ path: "/blogs/abc" }]);
  });
});
