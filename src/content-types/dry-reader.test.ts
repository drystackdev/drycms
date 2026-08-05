import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteContentEngineAdapter } from "./engine/sqlite.js";
import { createSqliteContentEntryEngineAdapter } from "./engine/entries-sqlite.js";
import { getDryContext, runWithDryContext } from "./dry-context.js";
import { dry } from "./dry-reader.js";
import type { DrySeoLayers } from "./dry-seo.js";
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

  describe("seo cascade (dry-seo.ts's DrySeoLayers, recorded as a side effect of get())", () => {
    async function freshSeoSetup() {
      const dir = mkdtempSync(join(tmpdir(), "drycms-dry-reader-seo-test-"));
      const file = join(dir, "content.sqlite");
      const schema = createSqliteContentEngineAdapter({ engine: "sqlite", file });
      const entries = createSqliteContentEntryEngineAdapter({ engine: "sqlite", file });

      // `features.seo` flattens the built-in `seo` COMPONENT's fields in -
      // needs that component type to actually exist in the DB/`allTypes`
      // (same reason `entry-tree.test.ts` notes this), not just the flag.
      // Already there: `createSqliteContentEngineAdapter` auto-seeds every
      // default type (`seed.ts`'s `pendingSeedStatements`) on first init.

      const article: ContentTypeDefinition = {
        id: "custom-article",
        kind: "collection",
        name: "article",
        label: "Article",
        features: { slug: true, seo: true },
        fields: [],
        version: 0,
      };
      await schema.applySave(article, await schema.planSave(article));

      const page: ContentTypeDefinition = {
        id: "custom-page",
        kind: "singleton",
        name: "page",
        label: "Page",
        features: { seo: true },
        fields: [],
        version: 0,
      };
      await schema.applySave(page, await schema.planSave(page));
      await entries.ensureSingletonEntry(page, await schema.listContentTypes());

      const siteDefaults: ContentTypeDefinition = {
        id: "custom-site-defaults",
        kind: "singleton",
        name: "siteDefaults",
        label: "Site Defaults",
        features: { seo: true, seoDefault: true },
        fields: [],
        version: 0,
      };
      await schema.applySave(siteDefaults, await schema.planSave(siteDefaults));
      await entries.ensureSingletonEntry(siteDefaults, await schema.listContentTypes());

      const allTypes = await schema.listContentTypes();
      return { dir, entries, allTypes };
    }

    it("collection().get() records the 'entry' layer", async () => {
      const { dir, entries, allTypes } = await freshSeoSetup();
      dirs.push(dir);
      const articleType = allTypes.find((t) => t.name === "article")!;
      const created = await entries.createEntry(articleType, allTypes, {
        title: "Hello",
        slug: "hello",
        seo: { metaTitle: "Entry title" },
      });
      const seo: DrySeoLayers = {};
      await runWithDryContext({ entries, allTypes, seo }, async () => {
        await dry().collection("article").get(created.id);
      });
      expect(seo.entry).toMatchObject({ metaTitle: "Entry title" });
      expect(seo.default).toBeUndefined();
      expect(seo.singleton).toBeUndefined();
    });

    it("singleton().get() records the 'singleton' layer for an SEO singleton without seoDefault", async () => {
      const { dir, entries, allTypes } = await freshSeoSetup();
      dirs.push(dir);
      const pageType = allTypes.find((t) => t.name === "page")!;
      await entries.saveSingletonEntry(pageType, allTypes, { seo: { metaTitle: "Page title" } });
      const seo: DrySeoLayers = {};
      await runWithDryContext({ entries, allTypes, seo }, async () => {
        await dry().singleton("page").get();
      });
      expect(seo.singleton).toMatchObject({ metaTitle: "Page title" });
      expect(seo.default).toBeUndefined();
      expect(seo.entry).toBeUndefined();
    });

    it("singleton().get() records the 'default' layer when features.seoDefault is set", async () => {
      const { dir, entries, allTypes } = await freshSeoSetup();
      dirs.push(dir);
      const defaultsType = allTypes.find((t) => t.name === "siteDefaults")!;
      await entries.saveSingletonEntry(defaultsType, allTypes, { seo: { metaTitle: "Site default title" } });
      const seo: DrySeoLayers = {};
      await runWithDryContext({ entries, allTypes, seo }, async () => {
        await dry().singleton("siteDefaults").get();
      });
      expect(seo.default).toMatchObject({ metaTitle: "Site default title" });
      expect(seo.singleton).toBeUndefined();
      expect(seo.entry).toBeUndefined();
    });

    it("list() never records a layer - only a page's own single-entity get() represents 'the page'", async () => {
      const { dir, entries, allTypes } = await freshSeoSetup();
      dirs.push(dir);
      const articleType = allTypes.find((t) => t.name === "article")!;
      await entries.createEntry(articleType, allTypes, { title: "Hello", slug: "hello", seo: { metaTitle: "Entry title" } });
      const seo: DrySeoLayers = {};
      await runWithDryContext({ entries, allTypes, seo }, async () => {
        await dry().collection("article").list();
      });
      expect(seo).toEqual({});
    });

    it("is a no-op when the context omits seo (existing callers unaffected)", async () => {
      const { dir, entries, allTypes } = await freshSeoSetup();
      dirs.push(dir);
      await runWithDryContext({ entries, allTypes }, async () => {
        await expect(dry().singleton("page").get()).resolves.not.toBeNull();
      });
    });
  });
});
