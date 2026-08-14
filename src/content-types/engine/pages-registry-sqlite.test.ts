import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSqlitePagesRegistryAdapter } from "./pages-registry-sqlite.js";
import type { PageRecord } from "./pages-registry-types.js";

function freshAdapter() {
  const dir = mkdtempSync(join(tmpdir(), "drycms-pages-registry-test-"));
  const adapter = createSqlitePagesRegistryAdapter({ engine: "sqlite", file: join(dir, "content.sqlite") });
  return { adapter, dir };
}

async function rawDb(dir: string) {
  const { DatabaseSync } = await import("node:sqlite");
  return new DatabaseSync(join(dir, "content.sqlite"));
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

describe("createSqlitePagesRegistryAdapter", () => {
  it("records a build and lists it in the sitemap", async () => {
    const { adapter, dir } = freshAdapter();
    dirs.push(dir);

    await adapter.recordBuild(page(), [{ resource: "blog", version: 1 }]);

    const entries = await adapter.listSitemapEntries();
    expect(entries).toEqual([{ path: "/blogs/abc", builtAt: 1000 }]);
  });

  it("listAllPages returns every row regardless of sitemap state, sorted by path", async () => {
    const { adapter, dir } = freshAdapter();
    dirs.push(dir);

    await adapter.recordBuild(page({ path: "/z-last", inSitemap: false }), []);
    await adapter.recordBuild(page({ path: "/a-first" }), []);

    const all = await adapter.listAllPages();
    expect(all.map((p) => p.path)).toEqual(["/a-first", "/z-last"]);
    expect(all[0]).toMatchObject({ path: "/a-first", inSitemap: true });
    expect(all[1]).toMatchObject({ path: "/z-last", inSitemap: false });
  });

  it("excludes noIndex pages from the sitemap", async () => {
    const { adapter, dir } = freshAdapter();
    dirs.push(dir);

    await adapter.recordBuild(page({ path: "/noindex", inSitemap: false }), []);
    await adapter.recordBuild(page({ path: "/live" }), []);

    const entries = await adapter.listSitemapEntries();
    expect(entries.map((e) => e.path)).toEqual(["/live"]);
  });

  it("upsert replaces the dependency set, not appends to it", async () => {
    const { adapter, dir } = freshAdapter();
    dirs.push(dir);

    await adapter.recordBuild(page(), [{ resource: "blog", version: 1 }, { resource: "settings", version: 1 }]);
    await adapter.recordBuild(page({ builtAt: 2000 }), [{ resource: "blog", version: 2 }]);

    expect(await adapter.listPathsByResource("blog")).toEqual(["/blogs/abc"]);
    expect(await adapter.listPathsByResource("settings")).toEqual([]);
  });

  it("listPathsByResource answers what to rebuild when a resource changes", async () => {
    const { adapter, dir } = freshAdapter();
    dirs.push(dir);

    await adapter.recordBuild(page({ path: "/a" }), [{ resource: "blog", version: 1 }]);
    await adapter.recordBuild(page({ path: "/b" }), [{ resource: "blog", version: 1 }]);
    await adapter.recordBuild(page({ path: "/c" }), [{ resource: "settings", version: 1 }]);

    expect((await adapter.listPathsByResource("blog")).sort()).toEqual(["/a", "/b"]);
  });

  it("listResourcesByPath answers what a given page depends on - empty for a path never built", async () => {
    const { adapter, dir } = freshAdapter();
    dirs.push(dir);

    expect(await adapter.listResourcesByPath("/never-built")).toEqual([]);

    await adapter.recordBuild(page(), [{ resource: "blog", version: 1 }, { resource: "settings", version: 1 }]);
    expect((await adapter.listResourcesByPath("/blogs/abc")).sort()).toEqual(["blog", "settings"]);

    // Upsert replaces the dependency set here too, same as
    // `listPathsByResource`'s own "upsert replaces, not appends" test above.
    await adapter.recordBuild(page({ builtAt: 2000 }), [{ resource: "blog", version: 2 }]);
    expect(await adapter.listResourcesByPath("/blogs/abc")).toEqual(["blog"]);
  });

  it("removePage deletes both the page row and its deps", async () => {
    const { adapter, dir } = freshAdapter();
    dirs.push(dir);

    await adapter.recordBuild(page(), [{ resource: "blog", version: 1 }]);
    await adapter.removePage("/blogs/abc");

    expect(await adapter.listSitemapEntries()).toEqual([]);
    expect(await adapter.listPathsByResource("blog")).toEqual([]);
  });

  it("clearAllPages deletes every page and dependency without touching versions", async () => {
    const { adapter, dir } = freshAdapter();
    dirs.push(dir);
    await adapter.recordBuild(page({ path: "/a" }), [{ resource: "blog", version: 1 }]);
    await adapter.recordBuild(page({ path: "/b" }), [{ resource: "settings", version: 2 }]);
    const db = await rawDb(dir);
    try {
      db.exec('INSERT INTO "_versions" ("resource","version","updated_at") VALUES (\'blog\', 1, 0);');
    } finally {
      db.close();
    }

    await adapter.clearAllPages();

    expect(await adapter.listAllPages()).toEqual([]);
    expect(await adapter.listPathsByResource("blog")).toEqual([]);
    const verify = await rawDb(dir);
    try {
      expect(verify.prepare('SELECT "resource" FROM "_versions";').all()).toEqual([{ resource: "blog" }]);
    } finally {
      verify.close();
    }
  });

  it("listStalePaths finds pages whose recorded dep version no longer matches _versions", async () => {
    const { adapter, dir } = freshAdapter();
    dirs.push(dir);

    await adapter.recordBuild(page(), [{ resource: "blog", version: 1 }]);
    // Nothing in `_versions` yet - not stale (nothing to compare against).
    expect(await adapter.listStalePaths()).toEqual([]);

    const db = await rawDb(dir);
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
    const { adapter, dir } = freshAdapter();
    dirs.push(dir);

    await adapter.recordBuild(page({ sourceHash: "hash-1" }), []);
    expect((await adapter.listAllPages())[0]).toMatchObject({ sourceHash: "hash-1" });

    await adapter.recordBuild(page({ builtAt: 2000, sourceHash: "hash-2" }), []);
    expect((await adapter.listAllPages())[0]).toMatchObject({ sourceHash: "hash-2" });
  });

  it("migrates an existing pre-source_hash _pages table without throwing, and reads the old row back as sourceHash: null", async () => {
    const dir = mkdtempSync(join(tmpdir(), "drycms-pages-registry-test-"));
    dirs.push(dir);

    // Simulate a real pre-existing tenant DB: the table exists in the OLD
    // 5-column shape, with a row already in it, before this adapter (and its
    // guarded `ALTER TABLE`) ever runs against this file.
    const preMigration = await rawDb(dir);
    try {
      preMigration.exec(
        'CREATE TABLE "_pages" ("path" TEXT PRIMARY KEY, "object_key" TEXT NOT NULL, "build_id" TEXT NOT NULL, "built_at" INTEGER NOT NULL, "in_sitemap" INTEGER NOT NULL);',
      );
      preMigration.exec(
        `INSERT INTO "_pages" VALUES ('/legacy', 'pages/build-0/legacy.html', 'build-0', 500, 1);`,
      );
    } finally {
      preMigration.close();
    }

    const adapter = createSqlitePagesRegistryAdapter({ engine: "sqlite", file: join(dir, "content.sqlite") });
    const all = await adapter.listAllPages();
    expect(all).toEqual([
      { path: "/legacy", objectKey: "pages/build-0/legacy.html", buildId: "build-0", builtAt: 500, inSitemap: true, sourceHash: null },
    ]);
  });

  it("bootstrapping twice against the same file doesn't throw (ALTER TABLE idempotency across cold starts)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "drycms-pages-registry-test-"));
    dirs.push(dir);
    const file = join(dir, "content.sqlite");

    const first = createSqlitePagesRegistryAdapter({ engine: "sqlite", file });
    await first.recordBuild(page(), []);

    const second = createSqlitePagesRegistryAdapter({ engine: "sqlite", file });
    await expect(second.listAllPages()).resolves.toMatchObject([{ path: "/blogs/abc" }]);
  });
});
