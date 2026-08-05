import { describe, expect, it } from "vitest";
import { generateDryTypes } from "./codegen.js";
import type { ContentTypeDefinition } from "./types.js";

function field(partial: Partial<ContentTypeDefinition["fields"][number]> & { id: string; name: string; type: string }): ContentTypeDefinition["fields"][number] {
  return { label: partial.name, config: {}, validation: {}, order: 0, ...partial };
}

describe("generateDryTypes", () => {
  it("emits a required field without `?` and an optional one with `?`", () => {
    const post: ContentTypeDefinition = {
      id: "post",
      kind: "collection",
      name: "post",
      label: "Post",
      version: 0,
      fields: [
        field({ id: "f1", name: "title", type: "text", validation: { required: true } }),
        field({ id: "f2", name: "views", type: "number" }),
      ],
    };
    const out = generateDryTypes([post]);
    expect(out).toContain("export interface Post {");
    expect(out).toContain("  id: number;");
    expect(out).toContain("  title: string;");
    expect(out).toContain("  views?: number;");
  });

  it("converts a kebab-case type name to a PascalCase interface name", () => {
    const type: ContentTypeDefinition = { id: "t", kind: "collection", name: "blog-post", label: "Blog Post", version: 0, fields: [] };
    expect(generateDryTypes([type])).toContain("export interface BlogPost {");
  });

  it("types a manyToOne relation as `number | null` and a manyToMany as `number[]`", () => {
    const category: ContentTypeDefinition = { id: "category", kind: "collection", name: "category", label: "Category", version: 0, fields: [] };
    const post: ContentTypeDefinition = {
      id: "post",
      kind: "collection",
      name: "post",
      label: "Post",
      version: 0,
      fields: [
        field({ id: "f1", name: "category", type: "relation", config: { target: "category", cardinality: "manyToOne" } }),
        field({ id: "f2", name: "tags", type: "relation", config: { target: "category", cardinality: "manyToMany" } }),
      ],
    };
    const out = generateDryTypes([post, category]);
    expect(out).toMatch(/category\?: number \| null;/);
    expect(out).toMatch(/tags\?: number\[\];/);
  });

  it("resolves a relationmirror to the flipped cardinality of its source relation", () => {
    const author: ContentTypeDefinition = {
      id: "author",
      kind: "collection",
      name: "author",
      label: "Author",
      version: 0,
      fields: [{ id: "mirror-posts", name: "posts", label: "Posts", type: "relationmirror", config: { sourceTypeId: "post", sourceFieldId: "f-author" }, validation: {}, order: 0 }],
    };
    const post: ContentTypeDefinition = {
      id: "post",
      kind: "collection",
      name: "post",
      label: "Post",
      version: 0,
      fields: [field({ id: "f-author", name: "author", type: "relation", config: { target: "author", cardinality: "manyToOne" } })],
    };
    const out = generateDryTypes([author, post]);
    // source is manyToOne -> mirror (flipped) is oneToMany -> number[].
    expect(out).toMatch(/posts\?: number\[\];/);
  });

  it("omits an unresolvable relationmirror instead of throwing", () => {
    const orphanMirror: ContentTypeDefinition = {
      id: "orphan",
      kind: "collection",
      name: "orphan",
      label: "Orphan",
      version: 0,
      fields: [{ id: "mirror", name: "mirror", label: "Mirror", type: "relationmirror", config: { sourceTypeId: "does-not-exist", sourceFieldId: "nope" }, validation: {}, order: 0 }],
    };
    expect(() => generateDryTypes([orphanMirror])).not.toThrow();
    const out = generateDryTypes([orphanMirror]);
    expect(out).not.toContain("mirror");
  });

  it("emits a nested interface reference for a flatten component and an array for a repeatable one", () => {
    const seo: ContentTypeDefinition = {
      id: "seo",
      kind: "component",
      name: "seo",
      label: "SEO",
      version: 0,
      fields: [field({ id: "f1", name: "metaTitle", type: "text" })],
    };
    const link: ContentTypeDefinition = {
      id: "link",
      kind: "component",
      name: "link",
      label: "Link",
      version: 0,
      fields: [field({ id: "f1", name: "href", type: "text", validation: { required: true } })],
    };
    const page: ContentTypeDefinition = {
      id: "page",
      kind: "collection",
      name: "page",
      label: "Page",
      version: 0,
      fields: [
        field({ id: "f-seo", name: "seo", type: "component", config: { componentId: "seo", repeatable: false } }),
        field({ id: "f-links", name: "links", type: "component", config: { componentId: "link", repeatable: true } }),
      ],
    };
    const out = generateDryTypes([page, seo, link]);
    expect(out).toContain("export interface Seo {");
    expect(out).toContain("export interface Link {");
    expect(out).toMatch(/seo: Seo;/);
    expect(out).toMatch(/links: Link\[\];/);
    // components have no `id` (never present in rowToValue's output).
    expect(out).not.toMatch(/export interface Seo \{\s*id: number;/);
  });

  it("types a select field as a string-literal union, and as an array when multiple", () => {
    const type: ContentTypeDefinition = {
      id: "t",
      kind: "collection",
      name: "t",
      label: "T",
      version: 0,
      fields: [
        field({ id: "f1", name: "status", type: "select", config: { options: ["draft", "live"], multiple: false } }),
        field({ id: "f2", name: "tags", type: "select", config: { options: ["a", "b"], multiple: true } }),
      ],
    };
    const out = generateDryTypes([type]);
    expect(out).toContain('status?: "draft" | "live";');
    expect(out).toContain('tags?: ("a" | "b")[];');
  });

  it("never emits password/secretkey fields", () => {
    const user: ContentTypeDefinition = {
      id: "user",
      kind: "collection",
      name: "user",
      label: "User",
      version: 0,
      fields: [field({ id: "f1", name: "password", type: "password" }), field({ id: "f2", name: "apiKey", type: "secretkey" })],
    };
    const out = generateDryTypes([user]);
    expect(out).not.toContain("password");
    expect(out).not.toContain("apiKey");
  });

  it("adds the slug/draft/schedule system fields implied by features", () => {
    const post: ContentTypeDefinition = {
      id: "post",
      kind: "collection",
      name: "post",
      label: "Post",
      version: 0,
      features: { slug: true, draft: true, schedule: true },
      fields: [],
    };
    const out = generateDryTypes([post]);
    expect(out).toContain("title: string;");
    expect(out).toContain("slug: string;");
    expect(out).toContain("draft?: boolean;");
    expect(out).toContain("schedule?: Date;");
  });

  it("builds DryCollectionName/DrySingletonName unions and maps, excluding components", () => {
    const post: ContentTypeDefinition = { id: "post", kind: "collection", name: "post", label: "Post", version: 0, fields: [] };
    const settings: ContentTypeDefinition = { id: "settings", kind: "singleton", name: "settings", label: "Settings", version: 0, fields: [] };
    const seo: ContentTypeDefinition = { id: "seo", kind: "component", name: "seo", label: "SEO", version: 0, fields: [] };
    const out = generateDryTypes([post, settings, seo]);
    expect(out).toContain('export type DryCollectionName = "post";');
    expect(out).toContain('export type DrySingletonName = "settings";');
    expect(out).toContain('"post": Post;');
    expect(out).toContain('"settings": Settings;');
    expect(out).not.toMatch(/DryCollectionName = "seo"/);
    expect(out).not.toMatch(/DrySingletonName = "seo"/);
  });

  it("declares the ambient global dry() typed against the generated maps", () => {
    const post: ContentTypeDefinition = { id: "post", kind: "collection", name: "post", label: "Post", version: 0, fields: [] };
    const out = generateDryTypes([post]);
    expect(out).toContain("declare global {");
    expect(out).toContain("function dry(): DryReader<DryCollectionMap, DrySingletonMap, DryCollectionRelationsMap, DrySingletonRelationsMap>;");
  });

  describe("<Type>Relations (typed populate())", () => {
    it("types a manyToOne relation field as the target interface or null", () => {
      const category: ContentTypeDefinition = { id: "category", kind: "collection", name: "category", label: "Category", version: 0, fields: [] };
      const post: ContentTypeDefinition = {
        id: "post",
        kind: "collection",
        name: "post",
        label: "Post",
        version: 0,
        fields: [field({ id: "f1", name: "category", type: "relation", config: { target: "category", cardinality: "manyToOne" } })],
      };
      const out = generateDryTypes([post, category]);
      expect(out).toContain("export interface PostRelations {");
      expect(out).toMatch(/category: Category \| null;/);
    });

    it("types a manyToMany relation field as the target interface array", () => {
      const category: ContentTypeDefinition = { id: "category", kind: "collection", name: "category", label: "Category", version: 0, fields: [] };
      const post: ContentTypeDefinition = {
        id: "post",
        kind: "collection",
        name: "post",
        label: "Post",
        version: 0,
        fields: [field({ id: "f1", name: "tags", type: "relation", config: { target: "category", cardinality: "manyToMany" } })],
      };
      const out = generateDryTypes([post, category]);
      expect(out).toMatch(/tags: Category\[\];/);
    });

    it("types a relationmirror field using the flipped cardinality of its source relation", () => {
      const author: ContentTypeDefinition = { id: "author", kind: "collection", name: "author", label: "Author", version: 0, fields: [] };
      const post: ContentTypeDefinition = {
        id: "post",
        kind: "collection",
        name: "post",
        label: "Post",
        version: 0,
        fields: [field({ id: "f-author", name: "author", type: "relation", config: { target: "author", cardinality: "manyToOne" } })],
      };
      const out = generateDryTypes([author, post]);
      // source is manyToOne -> mirror (flipped) is oneToMany -> Post[]; the
      // auto-generated mirror field on `author` is named after `post` (the
      // source type), same as `relationMirrorFieldsFor` names it - not
      // hand-declared, see `field-registry.ts`'s "auto-generated, never
      // hand-added" doc comment.
      expect(out).toMatch(/export interface AuthorRelations \{\s*post: Post\[\];\s*\}/);
    });

    it("emits an empty interface for a type with no populatable relation fields", () => {
      const post: ContentTypeDefinition = {
        id: "post",
        kind: "collection",
        name: "post",
        label: "Post",
        version: 0,
        fields: [field({ id: "f1", name: "title", type: "text" })],
      };
      const out = generateDryTypes([post]);
      expect(out).toContain("export interface PostRelations {}");
    });

    it("builds DryCollectionRelationsMap/DrySingletonRelationsMap with one entry per collection/singleton", () => {
      const post: ContentTypeDefinition = { id: "post", kind: "collection", name: "post", label: "Post", version: 0, fields: [] };
      const settings: ContentTypeDefinition = { id: "settings", kind: "singleton", name: "settings", label: "Settings", version: 0, fields: [] };
      const out = generateDryTypes([post, settings]);
      expect(out).toContain("export interface DryCollectionRelationsMap {");
      expect(out).toMatch(/"post": PostRelations;/);
      expect(out).toContain("export interface DrySingletonRelationsMap {");
      expect(out).toMatch(/"settings": SettingsRelations;/);
    });
  });
});
