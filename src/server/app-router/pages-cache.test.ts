import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ContentTypeDefinition } from "../../content-types/types.js";

const tempDirBox = vi.hoisted(() => ({ path: "" }));

vi.mock("../config.js", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  tempDirBox.path = mkdtempSync(join(tmpdir(), "drycms-pages-cache-storage-"));
  return { pagesCacheStorage: { kind: "local", root: tempDirBox.path } };
});

const { readPageCache, writePageCache } = await import("./pages-cache.js");
const { buildId } = await import("./build-id.js");
const { createSqliteContentEngineAdapter } = await import("../../content-types/engine/sqlite.js");
const { createSqliteContentEntryEngineAdapter } = await import("../../content-types/engine/entries-sqlite.js");

async function freshSetup() {
  const dir = mkdtempSync(join(tmpdir(), "drycms-pages-cache-content-"));
  const file = join(dir, "content.sqlite");
  const schema = createSqliteContentEngineAdapter({ engine: "sqlite", file });
  const entries = createSqliteContentEntryEngineAdapter({ engine: "sqlite", file });
  const post: ContentTypeDefinition = {
    id: "custom-post",
    kind: "collection",
    name: "post",
    label: "Post",
    features: {},
    fields: [],
    version: 0,
  };
  await schema.applySave(post, await schema.planSave(post));
  const allTypes = await schema.listContentTypes();
  return { dir, entries, allTypes };
}

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const context = { env: {} };

/** Same encoding `pages-cache.ts`'s own (unexported) `cacheKeyFor` uses -
 * duplicated here rather than exporting an internal helper just for tests. */
function cacheFilePath(pathname: string): string {
  const normalized = pathname === "/" ? "__root__" : pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  return join(tempDirBox.path, `${encodeURIComponent(normalized)}.json`);
}

describe("pages-cache", () => {
  it("misses when nothing has been cached yet", async () => {
    const { dir, entries, allTypes } = await freshSetup();
    dirs.push(dir);
    expect(await readPageCache(context, "/blog/hello", entries, allTypes)).toBeNull();
  });

  it("hits with the cached html when every touched type's version still matches", async () => {
    const { dir, entries, allTypes } = await freshSetup();
    dirs.push(dir);
    await writePageCache(context, "/blog/hello", "<html>cached</html>", new Set(["post"]), entries, allTypes);
    expect(await readPageCache(context, "/blog/hello", entries, allTypes)).toBe("<html>cached</html>");
  });

  it("misses once a touched type's entries change (its version bumps)", async () => {
    const { dir, entries, allTypes } = await freshSetup();
    dirs.push(dir);
    const postType = allTypes.find((t) => t.name === "post")!;
    await writePageCache(context, "/blog/hello", "<html>stale</html>", new Set(["post"]), entries, allTypes);
    await entries.createEntry(postType, allTypes, {});
    expect(await readPageCache(context, "/blog/hello", entries, allTypes)).toBeNull();
  });

  it("misses when the cache entry's buildId doesn't match the running process", async () => {
    const { dir, entries, allTypes } = await freshSetup();
    dirs.push(dir);
    await writePageCache(context, "/blog/hello", "<html>old-build</html>", new Set(["post"]), entries, allTypes);
    const path = cacheFilePath("/blog/hello");
    const envelope = JSON.parse(readFileSync(path, "utf8"));
    expect(envelope.buildId).toBe(buildId());
    envelope.buildId = "a-previous-deploy";
    writeFileSync(path, JSON.stringify(envelope));

    expect(await readPageCache(context, "/blog/hello", entries, allTypes)).toBeNull();
  });

  it("overwrites the same cache path on a second write rather than accumulating files", async () => {
    const { dir, entries, allTypes } = await freshSetup();
    dirs.push(dir);
    await writePageCache(context, "/blog/hello", "<html>v1</html>", new Set(["post"]), entries, allTypes);
    await writePageCache(context, "/blog/hello", "<html>v2</html>", new Set(["post"]), entries, allTypes);
    expect(await readPageCache(context, "/blog/hello", entries, allTypes)).toBe("<html>v2</html>");
  });
});
