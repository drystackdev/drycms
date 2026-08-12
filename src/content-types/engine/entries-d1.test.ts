import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ContentTypeDefinition } from "../types.js";
import type { D1Database, D1PreparedStatement, D1Result } from "./d1-driver.js";
import { createD1ContentEngineAdapter } from "./d1.js";
import { createD1ContentEntryEngineAdapter } from "./entries-d1.js";
import { resolveSqliteDriver, type SqliteHandle } from "./sqlite-driver.js";

/**
 * A `D1Database` faked over a real local SQLite file, for tests only - real
 * D1 IS SQLite-compatible (`migration.ts`'s DDL is shared, unmodified,
 * between the `sqlite` and `D1` schema engines), so this is a faithful
 * enough double for exercising `entries-d1.ts`'s SQL without a live
 * Cloudflare binding. `batch()` always `.run()`s each statement (never
 * `.all()`) - the only real caller, `reorderEntries`, only ever batches
 * writes.
 */
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

async function freshAdapters() {
  const dir = mkdtempSync(join(tmpdir(), "drycms-entries-d1-test-"));
  const file = join(dir, "content.sqlite");
  const handle = await resolveSqliteDriver(file);
  const db = createFakeD1(handle);
  const binding = "CONTENT_DB";
  const runtimeEnv = { [binding]: db };
  const schema = createD1ContentEngineAdapter({ engine: "D1", binding }, runtimeEnv);
  const entries = createD1ContentEntryEngineAdapter({ engine: "D1", binding }, runtimeEnv);
  return { schema, entries, dir };
}

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("createD1ContentEntryEngineAdapter", () => {
  it("creates, reads back, and lists entries against the fake D1 (smoke test for the harness itself)", async () => {
    const { schema, entries, dir } = await freshAdapters();
    dirs.push(dir);
    const allTypes = await schema.listContentTypes();
    const menu = allTypes.find((t) => t.name === "menu")!;

    const created = await entries.createEntry(menu, allTypes, { name: "Main nav", refs: [] });
    expect(created.value.name).toBe("Main nav");

    const fetched = await entries.getEntry(menu, allTypes, created.id);
    expect(fetched?.value.name).toBe("Main nav");

    const listed = await entries.listEntries(menu, allTypes, { page: 0, pageSize: 10 });
    expect(listed.total).toBe(1);
  });

  it("findEntry looks a row up by slug (features.slug) and returns null on no match", async () => {
    const { schema, entries, dir } = await freshAdapters();
    dirs.push(dir);
    const custom: ContentTypeDefinition = {
      id: "custom-post",
      kind: "collection",
      name: "post",
      label: "Post",
      features: { slug: true },
      fields: [],
      version: 0,
    };
    await schema.applySave(custom, await schema.planSave(custom));
    const allTypes = await schema.listContentTypes();
    const post = allTypes.find((t) => t.id === "custom-post")!;

    const created = await entries.createEntry(post, allTypes, { title: "Hello", slug: "hello" });
    await entries.createEntry(post, allTypes, { title: "Other", slug: "other" });

    const found = await entries.findEntry(post, allTypes, [{ field: "slug", op: "eq", value: "hello" }]);
    expect(found?.id).toBe(created.id);
    expect(await entries.findEntry(post, allTypes, [{ field: "slug", op: "eq", value: "nope" }])).toBeNull();
  });

  it("listEntries applies a `where` filter, resolved against queryable field names", async () => {
    const { schema, entries, dir } = await freshAdapters();
    dirs.push(dir);
    const custom: ContentTypeDefinition = {
      id: "custom-article",
      kind: "collection",
      name: "article",
      label: "Article",
      fields: [{ id: "f-views", name: "views", label: "Views", type: "number", config: {}, validation: {}, order: 0 }],
      version: 0,
    };
    await schema.applySave(custom, await schema.planSave(custom));
    const allTypes = await schema.listContentTypes();
    const article = allTypes.find((t) => t.id === "custom-article")!;

    await entries.createEntry(article, allTypes, { views: 5 });
    await entries.createEntry(article, allTypes, { views: 15 });
    await entries.createEntry(article, allTypes, { views: 25 });

    const highViews = await entries.listEntries(article, allTypes, {
      page: 0,
      pageSize: 10,
      where: [{ field: "views", op: "gte", value: 10 }],
    });
    expect(highViews.total).toBe(2);
    expect(highViews.rows.map((r) => r.value.views).sort()).toEqual([15, 25]);
  });

  it("publishedOnly excludes draft rows and future-scheduled rows, treating an untouched draft/schedule as published", async () => {
    const { schema, entries, dir } = await freshAdapters();
    dirs.push(dir);
    const custom: ContentTypeDefinition = {
      id: "custom-story",
      kind: "collection",
      name: "story",
      label: "Story",
      features: { slug: true, draft: true, schedule: true },
      fields: [],
      version: 0,
    };
    await schema.applySave(custom, await schema.planSave(custom));
    const allTypes = await schema.listContentTypes();
    const story = allTypes.find((t) => t.id === "custom-story")!;

    const untouched = await entries.createEntry(story, allTypes, { title: "Untouched", slug: "untouched" });
    await entries.createEntry(story, allTypes, { title: "Draft", slug: "draft-story", draft: true });
    const past = await entries.createEntry(story, allTypes, {
      title: "Past",
      slug: "past",
      draft: false,
      schedule: new Date(Date.now() - 86_400_000),
    });
    await entries.createEntry(story, allTypes, {
      title: "Future",
      slug: "future",
      draft: false,
      schedule: new Date(Date.now() + 86_400_000),
    });

    const published = await entries.listEntries(story, allTypes, { page: 0, pageSize: 10, publishedOnly: true });
    expect(published.total).toBe(2);
    expect(published.rows.map((r) => r.id).sort()).toEqual([untouched.id, past.id].sort());

    expect(
      await entries.findEntry(story, allTypes, [{ field: "slug", op: "eq", value: "future" }], { publishedOnly: true }),
    ).toBeNull();
  });

  it("clears every inbound relation when a row is deleted, and bumps the referencing type's own version", async () => {
    const { schema, entries, dir } = await freshAdapters();
    dirs.push(dir);

    const tag: ContentTypeDefinition = { id: "t-tag", kind: "collection", name: "tag", label: "Tag", fields: [], version: 0 };
    await schema.applySave(tag, await schema.planSave(tag));
    const post: ContentTypeDefinition = {
      id: "t-post",
      kind: "collection",
      name: "post",
      label: "Post",
      fields: [
        { id: "f-title", name: "title", label: "Title", type: "text", config: {}, validation: {}, order: 0 },
        { id: "f-primary-tag", name: "primaryTag", label: "Primary tag", type: "relation", config: { target: "t-tag", cardinality: "manyToOne" }, validation: {}, order: 1 },
        { id: "f-tags", name: "tags", label: "Tags", type: "relation", config: { target: "t-tag", cardinality: "manyToMany" }, validation: {}, order: 2 },
      ],
      version: 0,
    };
    await schema.applySave(post, await schema.planSave(post));

    const allTypes = await schema.listContentTypes();
    const tagType = allTypes.find((t) => t.name === "tag")!;
    const postType = allTypes.find((t) => t.name === "post")!;

    const doomed = await entries.createEntry(tagType, allTypes, {});
    const kept = await entries.createEntry(tagType, allTypes, {});
    const article = await entries.createEntry(postType, allTypes, {
      title: "One",
      primaryTag: doomed.id,
      tags: [doomed.id, kept.id],
    });
    const versionBefore = await entries.getResourceVersion(postType);

    await entries.deleteEntry(tagType, allTypes, doomed.id);

    const after = await entries.getEntry(postType, allTypes, article.id);
    expect(after?.value.primaryTag).toBeNull();
    expect(after?.value.tags).toEqual([kept.id]);
    expect(await entries.getResourceVersion(postType)).toBeGreaterThan(versionBefore);
  });

  it("listEntries omits a non-inline richtext field by default, includes it when asked, and getEntry always includes it", async () => {
    const { schema, entries, dir } = await freshAdapters();
    dirs.push(dir);
    const article: ContentTypeDefinition = {
      id: "custom-article",
      kind: "collection",
      name: "article",
      label: "Article",
      features: {},
      fields: [
        { id: "f-title", name: "title", label: "Title", type: "text", config: {}, validation: {}, order: 0 },
        { id: "f-body", name: "body", label: "Body", type: "richtext", config: { inline: false }, validation: {}, order: 1 },
      ],
      version: 0,
    };
    await schema.applySave(article, await schema.planSave(article));
    const allTypes = await schema.listContentTypes();
    const articleType = allTypes.find((t) => t.id === "custom-article")!;

    const created = await entries.createEntry(articleType, allTypes, { title: "Hello", body: "<p>Full body</p>" });

    const listed = await entries.listEntries(articleType, allTypes, { page: 0, pageSize: 10 });
    expect(listed.rows[0]?.value.title).toBe("Hello");
    expect(listed.rows[0]?.value.body).toBeNull();

    const listedWithBody = await entries.listEntries(articleType, allTypes, { page: 0, pageSize: 10, include: ["body"] });
    expect(listedWithBody.rows[0]?.value.body).toBe("<p>Full body</p>");

    const fetched = await entries.getEntry(articleType, allTypes, created.id);
    expect(fetched?.value.body).toBe("<p>Full body</p>");
  });

  it("listEntries batches relation/component-repeat/relation-mirror population across a whole page, keeping each row's own data correctly grouped and ordered", async () => {
    const { schema, entries, dir } = await freshAdapters();
    dirs.push(dir);

    const tag: ContentTypeDefinition = { id: "t-tag", kind: "collection", name: "tag", label: "Tag", fields: [], version: 0 };
    await schema.applySave(tag, await schema.planSave(tag));

    const link: ContentTypeDefinition = {
      id: "c-link",
      kind: "component",
      name: "link",
      label: "Link",
      fields: [{ id: "f-url", name: "url", label: "URL", type: "text", config: {}, validation: {}, order: 0 }],
      version: 0,
    };
    await schema.applySave(link, await schema.planSave(link));

    const post: ContentTypeDefinition = {
      id: "t-post",
      kind: "collection",
      name: "post",
      label: "Post",
      fields: [
        { id: "f-primary-tag", name: "primaryTag", label: "Primary tag", type: "relation", config: { target: "t-tag", cardinality: "manyToOne" }, validation: {}, order: 0 },
        { id: "f-tags", name: "tags", label: "Tags", type: "relation", config: { target: "t-tag", cardinality: "manyToMany" }, validation: {}, order: 1 },
        { id: "f-links", name: "links", label: "Links", type: "component", config: { componentId: "c-link", repeatable: true }, validation: {}, order: 2 },
      ],
      version: 0,
    };
    await schema.applySave(post, await schema.planSave(post));

    const category: ContentTypeDefinition = {
      id: "t-category",
      kind: "collection",
      name: "category",
      label: "Category",
      fields: [
        { id: "f-posts", name: "posts", label: "Posts", type: "relation", config: { target: "t-post", cardinality: "oneToMany" }, validation: {}, order: 0 },
      ],
      version: 0,
    };
    await schema.applySave(category, await schema.planSave(category));

    const allTypes = await schema.listContentTypes();
    const tagType = allTypes.find((t) => t.name === "tag")!;
    const postType = allTypes.find((t) => t.name === "post")!;
    const categoryType = allTypes.find((t) => t.name === "category")!;

    const tag1 = await entries.createEntry(tagType, allTypes, {});
    const tag2 = await entries.createEntry(tagType, allTypes, {});
    const tag3 = await entries.createEntry(tagType, allTypes, {});

    const postA = await entries.createEntry(postType, allTypes, {
      primaryTag: tag1.id,
      tags: [tag1.id, tag2.id],
      links: [{ url: "a1" }, { url: "a2" }],
    });
    const postB = await entries.createEntry(postType, allTypes, {
      primaryTag: tag2.id,
      tags: [tag2.id, tag3.id],
      links: [{ url: "b1" }],
    });
    const postC = await entries.createEntry(postType, allTypes, {
      primaryTag: null,
      tags: [],
      links: [],
    });

    const categoryEntry = await entries.createEntry(categoryType, allTypes, { posts: [postA.id, postB.id] });

    const listedPosts = await entries.listEntries(postType, allTypes, { page: 0, pageSize: 10 });
    const byId = new Map(listedPosts.rows.map((r) => [r.id, r]));
    const rowA = byId.get(postA.id);
    const rowB = byId.get(postB.id);
    const rowC = byId.get(postC.id);
    expect(rowA!.id).toBe(postA.id);
    expect(rowA!.value.primaryTag).toBe(tag1.id);
    expect(rowA!.value.tags).toEqual([tag1.id, tag2.id]);
    expect((rowA!.value.links as { url: string }[]).map((l) => l.url)).toEqual(["a1", "a2"]);
    expect(rowA!.value.category).toBe(categoryEntry.id);

    expect(rowB!.id).toBe(postB.id);
    expect(rowB!.value.primaryTag).toBe(tag2.id);
    expect(rowB!.value.tags).toEqual([tag2.id, tag3.id]);
    expect((rowB!.value.links as { url: string }[]).map((l) => l.url)).toEqual(["b1"]);
    expect(rowB!.value.category).toBe(categoryEntry.id);

    expect(rowC!.id).toBe(postC.id);
    expect(rowC!.value.primaryTag).toBeNull();
    expect(rowC!.value.tags).toEqual([]);
    expect(rowC!.value.links).toEqual([]);
    expect(rowC!.value.category).toBeNull();

    const listedTags = await entries.listEntries(tagType, allTypes, { page: 0, pageSize: 10 });
    const byTagId = new Map(listedTags.rows.map((r) => [r.id, r]));
    const rowTag1 = byTagId.get(tag1.id);
    const rowTag2 = byTagId.get(tag2.id);
    const rowTag3 = byTagId.get(tag3.id);
    expect(rowTag1!.id).toBe(tag1.id);
    expect(rowTag1!.value.postPrimaryTag).toEqual([postA.id]);
    expect(rowTag1!.value.postTags).toEqual([postA.id]);

    expect(rowTag2!.id).toBe(tag2.id);
    expect(rowTag2!.value.postPrimaryTag).toEqual([postB.id]);
    expect(rowTag2!.value.postTags).toEqual([postA.id, postB.id]);

    expect(rowTag3!.id).toBe(tag3.id);
    expect(rowTag3!.value.postPrimaryTag).toEqual([]);
    expect(rowTag3!.value.postTags).toEqual([postB.id]);

    // Cross-check against the unbatched single-row path (`getEntry`) to make
    // sure batching produced exactly the same shape, not just plausible data.
    for (const row of listedPosts.rows) {
      const single = await entries.getEntry(postType, allTypes, row.id);
      expect(row.value).toEqual(single!.value);
    }
    for (const row of listedTags.rows) {
      const single = await entries.getEntry(tagType, allTypes, row.id);
      expect(row.value).toEqual(single!.value);
    }
  });
});
