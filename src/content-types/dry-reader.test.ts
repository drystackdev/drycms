import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSqliteContentEngineAdapter } from "./engine/sqlite.js";
import { createSqliteContentEntryEngineAdapter } from "./engine/entries-sqlite.js";
import { getDryContext, runWithDryContext, type DryCallLogEntry } from "./dry-context.js";
import { dry } from "./dry-reader.js";
import { refOf } from "./dry-vei.js";
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

  describe("list({ select })", () => {
    it("returns only the named fields (plus id), leaving the rest out of the row entirely", async () => {
      const { dir, entries, allTypes } = await freshDrySetup();
      dirs.push(dir);
      const postType = allTypes.find((t) => t.name === "post")!;
      const created = await entries.createEntry(postType, allTypes, { title: "Hello", slug: "hello", views: 3 });

      await runWithDryContext({ entries, allTypes }, async () => {
        const { rows } = await dry().collection("post").list({ select: { title: true } });
        expect(rows).toEqual([{ id: created.id, title: "Hello" }]);
      });
    });

    it("runs a field's function on its stored value and returns that instead", async () => {
      const { dir, entries, allTypes } = await freshDrySetup();
      dirs.push(dir);
      const postType = allTypes.find((t) => t.name === "post")!;
      await entries.createEntry(postType, allTypes, { title: "Xin chào thế giới", slug: "hello", views: 3 });

      await runWithDryContext({ entries, allTypes }, async () => {
        const { rows } = await dry()
          .collection("post")
          .list({ select: { title: (value) => value.slice(0, 7), views: (value) => (value ?? 0) * 2 } });
        expect(rows[0]?.title).toBe("Xin chà");
        expect(rows[0]?.views).toBe(6);
      });
    });

    it("no select at all still returns every field - existing callers unaffected", async () => {
      const { dir, entries, allTypes } = await freshDrySetup();
      dirs.push(dir);
      const postType = allTypes.find((t) => t.name === "post")!;
      const created = await entries.createEntry(postType, allTypes, { title: "Hello", slug: "hello", views: 3 });

      await runWithDryContext({ entries, allTypes }, async () => {
        const { rows } = await dry().collection("post").list();
        expect(rows[0]).toEqual({ id: created.id, title: "Hello", slug: "hello", views: 3, draft: null });
      });
    });

    it("filters/sorts on a field it doesn't select", async () => {
      const { dir, entries, allTypes } = await freshDrySetup();
      dirs.push(dir);
      const postType = allTypes.find((t) => t.name === "post")!;
      await entries.createEntry(postType, allTypes, { title: "A", slug: "a", views: 5 });
      await entries.createEntry(postType, allTypes, { title: "B", slug: "b", views: 15 });

      await runWithDryContext({ entries, allTypes }, async () => {
        const { rows, total } = await dry()
          .collection("post")
          .list({ select: { title: true }, where: [{ field: "views", op: "gte", value: 10 }], sort: { field: "views", dir: "asc" } });
        expect(total).toBe(1);
        expect(rows).toEqual([{ id: expect.any(Number), title: "B" }]);
      });
    });

    it("logs the already-projected rows for hydration replay, not the full ones", async () => {
      const { dir, entries, allTypes } = await freshDrySetup();
      dirs.push(dir);
      const postType = allTypes.find((t) => t.name === "post")!;
      await entries.createEntry(postType, allTypes, { title: "Hello", slug: "hello", views: 3 });
      const callLog: DryCallLogEntry[] = [];

      await runWithDryContext({ entries, allTypes, callLog }, async () => {
        await dry().collection("post").list({ select: { title: (value) => value.toUpperCase() } });
      });
      expect(callLog[0]?.result).toEqual({ rows: [{ id: expect.any(Number), title: "HELLO" }], total: 1 });
    });

    it("hands a transform the plain stored value even in an edit-mode render, and leaves its result unboxed", async () => {
      const { dir, entries, allTypes } = await freshDrySetup();
      dirs.push(dir);
      const postType = allTypes.find((t) => t.name === "post")!;
      await entries.createEntry(postType, allTypes, { title: "Xin chào", slug: "hello", views: 1 });
      const vei = { canUpdate: () => true };

      await runWithDryContext({ entries, allTypes, vei }, async () => {
        const { rows } = await dry().collection("post").list({ select: { title: (value) => typeof value, slug: true } });
        // The transform saw a real string, not a boxed `String` object...
        expect(rows[0]?.title).toBe("string");
        // ...its result carries no editing ref, while a plain `true` field still does.
        expect(refOf(rows[0]?.title)).toBeNull();
        expect(refOf(rows[0]?.slug)).not.toBeNull();
      });
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

      // `seoDefaults` itself is one of the built-in types `pendingSeedStatements`
      // already auto-seeded above (see `seed.ts`) - no need to declare it by
      // hand, just create its initial (empty) entry row like `page`'s.
      const preTypes = await schema.listContentTypes();
      const seoDefaultsType = preTypes.find((t) => t.name === "seoDefaults")!;
      await entries.ensureSingletonEntry(seoDefaultsType, preTypes);

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

    it("singleton().get() records the 'singleton' layer for an SEO singleton that isn't the built-in seoDefaults", async () => {
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

    it("singleton().get() records the 'default' layer for the built-in seoDefaults singleton", async () => {
      const { dir, entries, allTypes } = await freshSeoSetup();
      dirs.push(dir);
      const defaultsType = allTypes.find((t) => t.name === "seoDefaults")!;
      await entries.saveSingletonEntry(defaultsType, allTypes, { seo: { metaTitle: "Site default title" } });
      const seo: DrySeoLayers = {};
      await runWithDryContext({ entries, allTypes, seo }, async () => {
        await dry().singleton("seoDefaults").get();
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

  describe("populate (get()'s N+1 relation resolution - see dry-populate.ts)", () => {
    async function freshPopulateSetup() {
      const dir = mkdtempSync(join(tmpdir(), "drycms-dry-reader-populate-test-"));
      const file = join(dir, "content.sqlite");
      const schema = createSqliteContentEngineAdapter({ engine: "sqlite", file });
      const entries = createSqliteContentEntryEngineAdapter({ engine: "sqlite", file });

      const author: ContentTypeDefinition = {
        id: "custom-author",
        kind: "collection",
        name: "author",
        label: "Author",
        features: { slug: true, draft: true },
        fields: [{ id: "f-name", name: "name", label: "Name", type: "text", config: {}, validation: {}, order: 0 }],
        version: 0,
      };
      await schema.applySave(author, await schema.planSave(author));

      const tag: ContentTypeDefinition = {
        id: "custom-tag",
        kind: "collection",
        name: "tag",
        label: "Tag",
        features: { slug: true },
        fields: [{ id: "f-name", name: "name", label: "Name", type: "text", config: {}, validation: {}, order: 0 }],
        version: 0,
      };
      await schema.applySave(tag, await schema.planSave(tag));

      const post: ContentTypeDefinition = {
        id: "custom-post",
        kind: "collection",
        name: "post",
        label: "Post",
        features: { slug: true, draft: true },
        fields: [
          { id: "f-author", name: "author", label: "Author", type: "relation", config: { target: "custom-author", cardinality: "manyToOne" }, validation: {}, order: 0 },
          { id: "f-tags", name: "tags", label: "Tags", type: "relation", config: { target: "custom-tag", cardinality: "manyToMany" }, validation: {}, order: 1 },
        ],
        version: 0,
      };
      await schema.applySave(post, await schema.planSave(post));

      const siteSettings: ContentTypeDefinition = {
        id: "custom-site-settings",
        kind: "singleton",
        name: "siteSettings",
        label: "Site Settings",
        fields: [{ id: "f-featured", name: "featuredAuthor", label: "Featured Author", type: "relation", config: { target: "custom-author", cardinality: "manyToOne" }, validation: {}, order: 0 }],
        version: 0,
      };
      await schema.applySave(siteSettings, await schema.planSave(siteSettings));
      await entries.ensureSingletonEntry(siteSettings, await schema.listContentTypes());

      const allTypes = await schema.listContentTypes();
      return { dir, entries, allTypes };
    }

    it("resolves a manyToOne relation field into the target's full published row, and records both types as touched", async () => {
      const { dir, entries, allTypes } = await freshPopulateSetup();
      dirs.push(dir);
      const authorType = allTypes.find((t) => t.name === "author")!;
      const postType = allTypes.find((t) => t.name === "post")!;
      const author = await entries.createEntry(authorType, allTypes, { title: "Ada", name: "Ada", slug: "ada" });
      const post = await entries.createEntry(postType, allTypes, { title: "Hello", slug: "hello", author: author.id });
      const touchedTypes = new Set<string>();

      await runWithDryContext({ entries, allTypes, touchedTypes }, async () => {
        const found = await dry().collection("post").get(post.id, { populate: ["author"] });
        expect(found?.author).toMatchObject({ id: author.id, name: "Ada", slug: "ada" });
      });
      expect(touchedTypes).toEqual(new Set(["post", "author"]));
    });

    it("leaves a null manyToOne relation as null rather than looking anything up", async () => {
      const { dir, entries, allTypes } = await freshPopulateSetup();
      dirs.push(dir);
      const postType = allTypes.find((t) => t.name === "post")!;
      const post = await entries.createEntry(postType, allTypes, { title: "Hello", slug: "hello" });

      await runWithDryContext({ entries, allTypes }, async () => {
        const found = await dry().collection("post").get(post.id, { populate: ["author"] });
        expect(found?.author).toBeNull();
      });
    });

    it("filters an unpublished (draft) manyToOne target out to null", async () => {
      const { dir, entries, allTypes } = await freshPopulateSetup();
      dirs.push(dir);
      const authorType = allTypes.find((t) => t.name === "author")!;
      const postType = allTypes.find((t) => t.name === "post")!;
      const ghost = await entries.createEntry(authorType, allTypes, { title: "Ghost", name: "Ghost", slug: "ghost", draft: true });
      const post = await entries.createEntry(postType, allTypes, { title: "Hello", slug: "hello", author: ghost.id });

      await runWithDryContext({ entries, allTypes }, async () => {
        const found = await dry().collection("post").get(post.id, { populate: ["author"] });
        expect(found?.author).toBeNull();
      });
    });

    it("resolves a manyToMany relation field into an array of the target's rows", async () => {
      const { dir, entries, allTypes } = await freshPopulateSetup();
      dirs.push(dir);
      const tagType = allTypes.find((t) => t.name === "tag")!;
      const postType = allTypes.find((t) => t.name === "post")!;
      const tagA = await entries.createEntry(tagType, allTypes, { title: "A", name: "A", slug: "a" });
      const tagB = await entries.createEntry(tagType, allTypes, { title: "B", name: "B", slug: "b" });
      const post = await entries.createEntry(postType, allTypes, { title: "Hello", slug: "hello", tags: [tagA.id, tagB.id] });

      await runWithDryContext({ entries, allTypes }, async () => {
        const found = await dry().collection("post").get(post.id, { populate: ["tags"] });
        expect(found?.tags).toEqual([expect.objectContaining({ id: tagA.id, name: "A" }), expect.objectContaining({ id: tagB.id, name: "B" })]);
      });
    });

    it("resolves a relationmirror field (the reverse of a manyToOne) into an array of the source rows", async () => {
      const { dir, entries, allTypes } = await freshPopulateSetup();
      dirs.push(dir);
      const authorType = allTypes.find((t) => t.name === "author")!;
      const postType = allTypes.find((t) => t.name === "post")!;
      const author = await entries.createEntry(authorType, allTypes, { title: "Ada", name: "Ada", slug: "ada" });
      const post1 = await entries.createEntry(postType, allTypes, { title: "One", slug: "one", author: author.id });
      const post2 = await entries.createEntry(postType, allTypes, { title: "Two", slug: "two", author: author.id });

      await runWithDryContext({ entries, allTypes }, async () => {
        // the auto-generated reverse mirror field on `author` is literally
        // named after the source type ("post") - see `system-fields.ts`'s
        // `relationMirrorFieldsFor`.
        const found = await dry().collection("author").get(author.id, { populate: ["post"] });
        expect(found?.post).toEqual(expect.arrayContaining([expect.objectContaining({ id: post1.id }), expect.objectContaining({ id: post2.id })]));
      });
    });

    it("singleton().get() resolves a populate field the same way as collection().get()", async () => {
      const { dir, entries, allTypes } = await freshPopulateSetup();
      dirs.push(dir);
      const authorType = allTypes.find((t) => t.name === "author")!;
      const settingsType = allTypes.find((t) => t.name === "siteSettings")!;
      const author = await entries.createEntry(authorType, allTypes, { title: "Ada", name: "Ada", slug: "ada" });
      await entries.saveSingletonEntry(settingsType, allTypes, { featuredAuthor: author.id });

      await runWithDryContext({ entries, allTypes }, async () => {
        const found = await dry().singleton("siteSettings").get({ populate: ["featuredAuthor"] });
        expect(found?.featuredAuthor).toMatchObject({ id: author.id, name: "Ada" });
      });
    });

    it("list()'s `where` can filter on a manyToOne relation field and exclude by id - the blog related-posts pattern", async () => {
      const { dir, entries, allTypes } = await freshPopulateSetup();
      dirs.push(dir);
      const authorType = allTypes.find((t) => t.name === "author")!;
      const postType = allTypes.find((t) => t.name === "post")!;
      const author = await entries.createEntry(authorType, allTypes, { title: "Ada", name: "Ada", slug: "ada" });
      const other = await entries.createEntry(authorType, allTypes, { title: "Bea", name: "Bea", slug: "bea" });
      const p1 = await entries.createEntry(postType, allTypes, { title: "One", slug: "one", author: author.id });
      const p2 = await entries.createEntry(postType, allTypes, { title: "Two", slug: "two", author: author.id });
      await entries.createEntry(postType, allTypes, { title: "Other author", slug: "other-author", author: other.id });

      await runWithDryContext({ entries, allTypes }, async () => {
        const result = await dry()
          .collection("post")
          .list({ where: [{ field: "author", op: "eq", value: author.id }, { field: "id", op: "ne", value: p1.id }] });
        expect(result.rows.map((r) => r.id)).toEqual([p2.id]);
      });
    });

    it("throws a clear error for a populate field that isn't a relation/relationmirror field", async () => {
      const { dir, entries, allTypes } = await freshPopulateSetup();
      dirs.push(dir);
      const postType = allTypes.find((t) => t.name === "post")!;
      const post = await entries.createEntry(postType, allTypes, { title: "Hello", slug: "hello" });

      await runWithDryContext({ entries, allTypes }, async () => {
        await expect(dry().collection("post").get(post.id, { populate: ["title" as never] })).rejects.toThrow(/has no relation\/relationmirror field named/);
      });
    });
  });
});
