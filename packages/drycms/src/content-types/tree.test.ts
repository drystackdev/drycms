import { describe, expect, it } from "vitest";
import { findDependents, resolveTableTree } from "./tree.js";
import type { ContentTypeDefinition, FieldDefinition } from "./types.js";

function field(overrides: Partial<FieldDefinition> = {}): FieldDefinition {
  return { id: "f1", name: "field1", label: "Field 1", type: "text", config: {}, validation: {}, ...overrides };
}

function collection(overrides: Partial<ContentTypeDefinition> = {}): ContentTypeDefinition {
  return { id: "c1", kind: "collection", name: "posts", label: "Posts", fields: [], version: 0, ...overrides };
}

function component(overrides: Partial<ContentTypeDefinition> = {}): ContentTypeDefinition {
  return { id: "comp1", kind: "component", name: "seo", label: "SEO", fields: [], version: 0, ...overrides };
}

describe("resolveTableTree", () => {
  it("always includes the title system column, plus a column per scalar field", () => {
    const type = collection({ fields: [field({ id: "f1", name: "body", type: "text" })] });
    const tree = resolveTableTree(type, [type]);

    expect(tree.tableName).toBe("posts");
    expect(tree.tableKind).toBe("root-collection");
    const names = tree.columns.map((c) => c.name);
    expect(names).toEqual(["title", "body"]);
  });

  it("adds slug/draft/schedule columns only when the matching feature is on", () => {
    const type = collection({ features: { slug: true, draft: true } });
    const tree = resolveTableTree(type, [type]);
    expect(tree.columns.map((c) => c.name)).toEqual(["title", "slug", "draft"]);
  });

  it("does not add draft/schedule for a singleton, even if requested in features", () => {
    const type: ContentTypeDefinition = {
      id: "s1",
      kind: "singleton",
      name: "home",
      label: "Home",
      // draft/schedule aren't valid singleton features, but prove the tree
      // resolver itself enforces this regardless of what's passed in.
      features: { slug: true, draft: true, schedule: true } as any,
      fields: [],
      version: 0,
    };
    const tree = resolveTableTree(type, [type]);
    expect(tree.columns.map((c) => c.name)).toEqual(["title", "slug"]);
  });

  it("flattens a non-repeatable component's fields with a name/id-path prefix", () => {
    const seo = component({ id: "seo", fields: [field({ id: "seo-title", name: "title", type: "text" })] });
    const type = collection({
      fields: [
        field({
          id: "hero",
          name: "hero",
          type: "component",
          config: { componentId: "seo", repeatable: false },
        }),
      ],
    });
    const tree = resolveTableTree(type, [type, seo]);

    const heroTitle = tree.columns.find((c) => c.name === "hero_title");
    expect(heroTitle).toBeDefined();
    expect(heroTitle?.localIdPath).toEqual(["hero", "seo-title"]);
    expect(tree.children).toHaveLength(0);
  });

  it("gives a repeatable component its own child table, named with the full flatten-prefix chain", () => {
    const slide = component({ id: "slide", fields: [field({ id: "slide-text", name: "text", type: "text" })] });
    const carousel = component({
      id: "carousel",
      fields: [field({ id: "items", name: "items", type: "component", config: { componentId: "slide", repeatable: true } })],
    });
    const type = collection({
      fields: [
        field({ id: "hero", name: "hero", type: "component", config: { componentId: "carousel", repeatable: false } }),
      ],
    });
    const tree = resolveTableTree(type, [type, carousel, slide]);

    expect(tree.children).toHaveLength(1);
    const child = tree.children[0]!;
    expect(child.tableName).toBe("posts_hero_items");
    expect(child.kind).toBe("component-repeat");
    expect(child.localIdPath).toEqual(["hero", "items"]);
    expect(child.node.columns.map((c) => c.name)).toEqual(["id", "parent_id", "position", "text"]);
  });

  it("gives a relation with cardinality 'many' a join child table", () => {
    const category = collection({ id: "cat", name: "categories" });
    const type = collection({
      fields: [
        field({ id: "cats", name: "categories", type: "relation", config: { target: "cat", cardinality: "many" } }),
      ],
    });
    const tree = resolveTableTree(type, [type, category]);

    expect(tree.children).toHaveLength(1);
    const child = tree.children[0]!;
    expect(child.tableName).toBe("posts_categories");
    expect(child.kind).toBe("relation-many");
    expect(child.node.columns.map((c) => c.name)).toEqual(["id", "parent_id", "position", "target_id"]);
  });

  it("a relation with cardinality 'one' is a plain column, not a child table", () => {
    const category = collection({ id: "cat", name: "categories" });
    const type = collection({
      fields: [field({ id: "cat-ref", name: "category", type: "relation", config: { target: "cat", cardinality: "one" } })],
    });
    const tree = resolveTableTree(type, [type, category]);

    expect(tree.children).toHaveLength(0);
    const col = tree.columns.find((c) => c.name === "category");
    expect(col?.sqlType).toBe("INTEGER");
  });

  it("only fills ftsColumns when features.fullSearch is on", () => {
    const withSearch = collection({ features: { fullSearch: true }, fields: [field({ id: "f1", name: "body" })] });
    const withoutSearch = collection({ fields: [field({ id: "f1", name: "body" })] });

    expect(resolveTableTree(withSearch, [withSearch]).ftsColumns).toEqual(["title", "body"]);
    expect(resolveTableTree(withoutSearch, [withoutSearch]).ftsColumns).toEqual([]);
  });

  it("excludes date/image columns from FTS even when fullSearch is on", () => {
    const type = collection({
      features: { fullSearch: true },
      fields: [field({ id: "d1", name: "published", type: "date" }), field({ id: "i1", name: "cover", type: "image" })],
    });
    expect(resolveTableTree(type, [type]).ftsColumns).toEqual(["title"]);
  });
});

describe("findDependents", () => {
  it("finds a collection that directly embeds a component", () => {
    const seo = component({ id: "seo" });
    const post = collection({
      id: "post",
      fields: [field({ id: "f1", name: "seo", type: "component", config: { componentId: "seo", repeatable: false } })],
    });
    expect(findDependents("seo", [seo, post]).map((t) => t.id)).toEqual(["post"]);
  });

  it("finds a collection that embeds a component transitively through another component", () => {
    const badge = component({ id: "badge" });
    const card = component({
      id: "card",
      fields: [field({ id: "f1", name: "badge", type: "component", config: { componentId: "badge", repeatable: false } })],
    });
    const post = collection({
      id: "post",
      fields: [field({ id: "f2", name: "card", type: "component", config: { componentId: "card", repeatable: false } })],
    });
    expect(findDependents("badge", [badge, card, post]).map((t) => t.id)).toEqual(["post"]);
  });

  it("returns nothing for a component nobody embeds", () => {
    const orphan = component({ id: "orphan" });
    expect(findDependents("orphan", [orphan])).toEqual([]);
  });
});
