import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteContentEngineAdapter } from "./engine/sqlite.js";
import { createSqliteContentEntryEngineAdapter } from "./engine/entries-sqlite.js";
import { getDryContext, runWithDryContext } from "./dry-context.js";
import { dry } from "./dry-reader.js";
import type { ContentTypeDefinition } from "./types.js";

async function freshDrySetup() {
  const dir = mkdtempSync(join(tmpdir(), "drycms-dry-reader-test-"));
  const file = join(dir, "content.sqlite");
  const schema = createSqliteContentEngineAdapter({ engine: "sqlite", file });
  const entries = createSqliteContentEntryEngineAdapter({ engine: "sqlite", file });

  const post: ContentTypeDefinition = {
    id: "custom-post",
    kind: "collection",
    name: "post",
    label: "Post",
    features: { slug: true, draft: true },
    fields: [{ id: "f-views", name: "views", label: "Views", type: "number", config: {}, validation: {}, order: 0 }],
    version: 0,
  };
  await schema.applySave(post, await schema.planSave(post));

  const settings: ContentTypeDefinition = {
    id: "custom-settings",
    kind: "singleton",
    name: "settings",
    label: "Settings",
    fields: [{ id: "f-title", name: "siteTitle", label: "Site title", type: "text", config: {}, validation: {}, order: 0 }],
    version: 0,
  };
  await schema.applySave(settings, await schema.planSave(settings));
  await entries.ensureSingletonEntry(settings, await schema.listContentTypes());

  const allTypes = await schema.listContentTypes();
  return { dir, entries, allTypes };
}

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("dry()", () => {
  it("throws when called outside runWithDryContext", () => {
    expect(() => getDryContext()).toThrow(/outside a request/);
  });

  it("collection().get(id) returns the row merged with its id, published by default", async () => {
    const { dir, entries, allTypes } = await freshDrySetup();
    dirs.push(dir);
    const postType = allTypes.find((t) => t.name === "post")!;
    const created = await entries.createEntry(postType, allTypes, { title: "Hello", slug: "hello", views: 3 });

    await runWithDryContext({ entries, allTypes }, async () => {
      const found = await dry().collection("post").get(created.id);
      expect(found).toEqual({ id: created.id, title: "Hello", slug: "hello", views: 3, draft: null });
    });
  });

  it("collection().get(slug) looks up by slug", async () => {
    const { dir, entries, allTypes } = await freshDrySetup();
    dirs.push(dir);
    const postType = allTypes.find((t) => t.name === "post")!;
    const created = await entries.createEntry(postType, allTypes, { title: "Hello", slug: "hello", views: 3 });

    await runWithDryContext({ entries, allTypes }, async () => {
      const found = await dry().collection("post").get("hello");
      expect(found?.id).toBe(created.id);
      expect(await dry().collection("post").get("nope")).toBeNull();
    });
  });

  it("collection().get() never returns a draft row, by id or by slug", async () => {
    const { dir, entries, allTypes } = await freshDrySetup();
    dirs.push(dir);
    const postType = allTypes.find((t) => t.name === "post")!;
    const created = await entries.createEntry(postType, allTypes, { title: "Secret", slug: "secret", views: 0, draft: true });

    await runWithDryContext({ entries, allTypes }, async () => {
      expect(await dry().collection("post").get(created.id)).toBeNull();
      expect(await dry().collection("post").get("secret")).toBeNull();
    });
  });

  it("collection().list() excludes drafts by default and includes them with includeDraft", async () => {
    const { dir, entries, allTypes } = await freshDrySetup();
    dirs.push(dir);
    const postType = allTypes.find((t) => t.name === "post")!;
    await entries.createEntry(postType, allTypes, { title: "Live", slug: "live", views: 1 });
    await entries.createEntry(postType, allTypes, { title: "Draft", slug: "draft-post", views: 2, draft: true });

    await runWithDryContext({ entries, allTypes }, async () => {
      const published = await dry().collection("post").list();
      expect(published.total).toBe(1);
      expect(published.rows[0]?.slug).toBe("live");

      const withDrafts = await dry().collection("post").list({ includeDraft: true });
      expect(withDrafts.total).toBe(2);
    });
  });

  it("collection().list() accepts where/sort/page options", async () => {
    const { dir, entries, allTypes } = await freshDrySetup();
    dirs.push(dir);
    const postType = allTypes.find((t) => t.name === "post")!;
    await entries.createEntry(postType, allTypes, { title: "A", slug: "a", views: 5 });
    await entries.createEntry(postType, allTypes, { title: "B", slug: "b", views: 15 });

    await runWithDryContext({ entries, allTypes }, async () => {
      const result = await dry().collection("post").list({ where: [{ field: "views", op: "gte", value: 10 }] });
      expect(result.total).toBe(1);
      expect(result.rows[0]?.slug).toBe("b");
    });
  });

  it("singleton().get() returns the one row", async () => {
    const { dir, entries, allTypes } = await freshDrySetup();
    dirs.push(dir);

    await runWithDryContext({ entries, allTypes }, async () => {
      const settings = await dry().singleton("settings").get();
      expect(settings).not.toBeNull();
      expect(settings).toHaveProperty("siteTitle");
    });
  });

  it("collection() throws a clear error for an unknown type name", async () => {
    const { dir, entries, allTypes } = await freshDrySetup();
    dirs.push(dir);
    await runWithDryContext({ entries, allTypes }, async () => {
      await expect(dry().collection("does-not-exist" as never).get(1)).rejects.toThrow(/no content type named/);
    });
  });

  it("collection() throws a clear error when the name is actually a singleton", async () => {
    const { dir, entries, allTypes } = await freshDrySetup();
    dirs.push(dir);
    await runWithDryContext({ entries, allTypes }, async () => {
      await expect(dry().collection("settings" as never).get(1)).rejects.toThrow(/is a singleton, not a collection/);
    });
  });

  describe("touchedTypes (pages-cache dependency tracking)", () => {
    it("records the collection name read by get() and list()", async () => {
      const { dir, entries, allTypes } = await freshDrySetup();
      dirs.push(dir);
      const postType = allTypes.find((t) => t.name === "post")!;
      const created = await entries.createEntry(postType, allTypes, { title: "Hello", slug: "hello", views: 3 });
      const touchedTypes = new Set<string>();

      await runWithDryContext({ entries, allTypes, touchedTypes }, async () => {
        await dry().collection("post").get(created.id);
        await dry().collection("post").list();
      });
      expect(touchedTypes).toEqual(new Set(["post"]));
    });

    it("records the singleton name read by get()", async () => {
      const { dir, entries, allTypes } = await freshDrySetup();
      dirs.push(dir);
      const touchedTypes = new Set<string>();

      await runWithDryContext({ entries, allTypes, touchedTypes }, async () => {
        await dry().singleton("settings").get();
      });
      expect(touchedTypes).toEqual(new Set(["settings"]));
    });

    it("is a no-op when the context omits touchedTypes (existing callers unaffected)", async () => {
      const { dir, entries, allTypes } = await freshDrySetup();
      dirs.push(dir);
      await runWithDryContext({ entries, allTypes }, async () => {
        await expect(dry().singleton("settings").get()).resolves.not.toBeNull();
      });
    });
  });

  describe("callLog (client hydration replay)", () => {
    it("records collection get()/list() and singleton get() in call order", async () => {
      const { dir, entries, allTypes } = await freshDrySetup();
      dirs.push(dir);
      const postType = allTypes.find((t) => t.name === "post")!;
      const created = await entries.createEntry(postType, allTypes, { title: "Hello", slug: "hello", views: 3 });
      const callLog: import("./dry-context.js").DryCallLogEntry[] = [];

      await runWithDryContext({ entries, allTypes, callLog }, async () => {
        await dry().collection("post").get(created.id);
        await dry().collection("post").list();
        await dry().singleton("settings").get();
      });

      expect(callLog.map((e) => `${e.kind}.${e.name}.${e.method}`)).toEqual([
        "collection.post.get",
        "collection.post.list",
        "singleton.settings.get",
      ]);
      expect((callLog[0]!.result as { slug: string }).slug).toBe("hello");
    });

    it("is a no-op when the context omits callLog (existing callers unaffected)", async () => {
      const { dir, entries, allTypes } = await freshDrySetup();
      dirs.push(dir);
      await runWithDryContext({ entries, allTypes }, async () => {
        await expect(dry().singleton("settings").get()).resolves.not.toBeNull();
      });
    });
  });
});
