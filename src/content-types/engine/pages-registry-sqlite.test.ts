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

  it("removePage deletes both the page row and its deps", async () => {
    const { adapter, dir } = freshAdapter();
    dirs.push(dir);

    await adapter.recordBuild(page(), [{ resource: "blog", version: 1 }]);
    await adapter.removePage("/blogs/abc");

    expect(await adapter.listSitemapEntries()).toEqual([]);
    expect(await adapter.listPathsByResource("blog")).toEqual([]);
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
});
