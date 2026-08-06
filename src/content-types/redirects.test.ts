import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteContentEntryEngineAdapter } from "./engine/entries-sqlite.js";
import { createSqliteContentEngineAdapter } from "./engine/sqlite.js";
import { recordSlugRedirect } from "./redirects.js";

function freshAdapters() {
  const dir = mkdtempSync(join(tmpdir(), "drycms-redirects-test-"));
  const file = join(dir, "content.sqlite");
  const schema = createSqliteContentEngineAdapter({ engine: "sqlite", file });
  const entries = createSqliteContentEntryEngineAdapter({ engine: "sqlite", file });
  return { schema, entries, dir };
}

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("recordSlugRedirect", () => {
  it("creates a new from/to row when none exists yet", async () => {
    const { schema, entries, dir } = freshAdapters();
    dirs.push(dir);
    const allTypes = await schema.listContentTypes();
    const redirect = allTypes.find((t) => t.name === "redirect")!;

    await recordSlugRedirect(entries, allTypes, "old-post", "new-post");

    const row = await entries.findEntry(redirect, allTypes, [{ field: "from", op: "eq", value: "old-post" }]);
    expect(row?.value.to).toBe("new-post");
  });

  it("updates an existing row for the same `from` in place instead of duplicating", async () => {
    const { schema, entries, dir } = freshAdapters();
    dirs.push(dir);
    const allTypes = await schema.listContentTypes();
    const redirect = allTypes.find((t) => t.name === "redirect")!;

    await recordSlugRedirect(entries, allTypes, "old-post", "mid-post");
    await recordSlugRedirect(entries, allTypes, "old-post", "new-post");

    const { rows, total } = await entries.listEntries(redirect, allTypes, { page: 0, pageSize: 100 });
    expect(total).toBe(1);
    expect(rows[0]?.value).toMatchObject({ from: "old-post", to: "new-post" });
  });

  it("deletes a stale row that redirected away from a slug that's live again", async () => {
    const { schema, entries, dir } = freshAdapters();
    dirs.push(dir);
    const allTypes = await schema.listContentTypes();
    const redirect = allTypes.find((t) => t.name === "redirect")!;

    // "a" was renamed to "b" ...
    await recordSlugRedirect(entries, allTypes, "a", "b");
    // ... then renamed back to "a" - the stale a->b row must go, or it would
    // now shadow the live "a" page.
    await recordSlugRedirect(entries, allTypes, "b", "a");

    const stale = await entries.findEntry(redirect, allTypes, [{ field: "from", op: "eq", value: "a" }]);
    expect(stale).toBeNull();
    const fresh = await entries.findEntry(redirect, allTypes, [{ field: "from", op: "eq", value: "b" }]);
    expect(fresh?.value.to).toBe("a");
  });

  it("is a no-op when from and to are the same", async () => {
    const { schema, entries, dir } = freshAdapters();
    dirs.push(dir);
    const allTypes = await schema.listContentTypes();
    const redirect = allTypes.find((t) => t.name === "redirect")!;

    await recordSlugRedirect(entries, allTypes, "same-slug", "same-slug");

    const { total } = await entries.listEntries(redirect, allTypes, { page: 0, pageSize: 100 });
    expect(total).toBe(0);
  });
});
