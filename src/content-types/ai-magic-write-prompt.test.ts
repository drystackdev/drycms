import { describe, expect, it } from "vitest";
import { buildMagicWriteSystemPrompt, buildRewriteTurnMessage, describeFieldsForPrompt } from "./ai-magic-write-prompt.js";
import type { EntryFieldNode } from "./engine/entry-tree.js";
import type { ContentTypeDefinition } from "./types.js";

function column(overrides: Partial<EntryFieldNode> & { fieldName: string; fieldType: string }): EntryFieldNode {
  return {
    kind: "column",
    fieldId: overrides.fieldName,
    fieldName: overrides.fieldName,
    label: overrides.fieldName,
    columnName: overrides.fieldName,
    validation: {},
    fieldConfig: undefined,
    ...overrides,
  } as EntryFieldNode;
}

describe("describeFieldsForPrompt", () => {
  it("lists a label the field name can't be read off of", () => {
    const description = describeFieldsForPrompt([column({ fieldName: "title", fieldType: "text", label: "Tiêu đề" })], {});
    expect(description).toBe('- "title" (label: "Tiêu đề") (text) - current value: (empty)');
  });

  it("omits a label that only re-spells the field name", () => {
    const nodes = [
      column({ fieldName: "title", fieldType: "text", label: "Title" }),
      column({ fieldName: "publishedDate", fieldType: "date", label: "Published Date" }),
    ];
    expect(describeFieldsForPrompt(nodes, {})).not.toContain("label:");
  });

  it("labels group and repeatable fields too", () => {
    const nodes: EntryFieldNode[] = [
      {
        kind: "flatten",
        fieldId: "author",
        fieldName: "author",
        label: "Tác giả",
        children: [column({ fieldName: "name", fieldType: "text", label: "Họ tên" })],
      },
      {
        kind: "component-repeat",
        fieldId: "sections",
        fieldName: "sections",
        label: "Các phần",
        tableName: "post_sections",
        sortable: false,
        validation: {},
        itemFields: [column({ fieldName: "heading", fieldType: "text", label: "Tiêu đề phần" })],
      },
    ];
    const description = describeFieldsForPrompt(nodes, {});
    expect(description).toContain('- "author" (label: "Tác giả")');
    expect(description).toContain('- "name" (label: "Họ tên")');
    expect(description).toContain('- "sections" (label: "Các phần")');
    expect(description).toContain('- "heading" (label: "Tiêu đề phần")');
  });

  it("keeps password/secretkey and relation-mirror out of the description", () => {
    const nodes: EntryFieldNode[] = [
      column({ fieldName: "password", fieldType: "password", label: "Mật khẩu" }),
      { kind: "relation-mirror", fieldId: "posts", fieldName: "posts", label: "Posts", resolved: false },
    ];
    expect(describeFieldsForPrompt(nodes, {})).toBe("(this content type has no field Magic Write can write to)");
  });

  it("describes a relation field by its target's NAME (typeSlug), not its internal id (Phase B - now writable)", () => {
    const nodes: EntryFieldNode[] = [
      {
        kind: "relation",
        fieldId: "category",
        fieldName: "category",
        label: "Danh mục",
        cardinality: "manyToOne",
        targetTypeId: "cat-internal-id",
        columnName: "category_id",
        sortable: false,
        validation: {},
      },
      {
        kind: "relation",
        fieldId: "tags",
        fieldName: "tags",
        label: "Tags",
        cardinality: "manyToMany",
        targetTypeId: "tag-internal-id",
        tableName: "post_tags",
        sortable: false,
        validation: {},
      },
    ];
    const allTypes = [
      { id: "cat-internal-id", kind: "collection", name: "category", label: "Category", fields: [], version: 0 },
      { id: "tag-internal-id", kind: "collection", name: "tag", label: "Tag", fields: [], version: 0 },
    ] as ContentTypeDefinition[];
    const description = describeFieldsForPrompt(nodes, { category: 12, tags: [1, 5] }, allTypes);
    // "typeSlug" here is deliberately the target's NAME ("category"/"tag"),
    // NEVER `targetTypeId` ("cat-internal-id"/...) - a real smoke test showed
    // the model trying the internal id first (a wasted `kind: fetch` hop)
    // when this only showed the bare id with no hint a different string was
    // the one `typeSlug` actually matches against.
    expect(description).toContain('- "category" (label: "Danh mục") (relation, links content type typeSlug "category", one) - current value: 12');
    expect(description).toContain('- "tags" (relation, links content type typeSlug "tag", many) - current value: [1,5]');
    expect(description).not.toContain("cat-internal-id");
    expect(description).not.toContain("tag-internal-id");
  });

  it("omits a relation field whose target type doesn't exist (broken schema), same degrade-by-omission as loadRelationContext", () => {
    const nodes: EntryFieldNode[] = [
      {
        kind: "relation",
        fieldId: "category",
        fieldName: "category",
        label: "Category",
        cardinality: "manyToOne",
        targetTypeId: "does-not-exist",
        columnName: "category_id",
        sortable: false,
        validation: {},
      },
    ];
    expect(describeFieldsForPrompt(nodes, {}, [])).toBe("(this content type has no field Magic Write can write to)");
  });
});

describe("buildMagicWriteSystemPrompt", () => {
  it("tells the model to match on labels but write back under field names", () => {
    const prompt = buildMagicWriteSystemPrompt({
      lang: "Tiếng Việt",
      typeLabel: "Bài viết",
      fieldsDescription: '- "title" (label: "Tiêu đề") (text) - current value: (empty)',
    });
    expect(prompt).toContain("refer to fields by that label");
    expect(prompt).toContain("MUST be the exact quoted field name, never the label");
  });

  it("documents kind: rewrite as a fifth reply, restricted to explicit rewrite requests", () => {
    const prompt = buildMagicWriteSystemPrompt({
      lang: "English",
      typeLabel: "Post",
      fieldsDescription: "(none)",
    });
    expect(prompt).toContain("kind: rewrite");
    expect(prompt).toContain("five possible top-level replies");
  });

  it("omits kind: create entirely when the entry's type has no relation field", () => {
    const prompt = buildMagicWriteSystemPrompt({
      lang: "English",
      typeLabel: "Post",
      fieldsDescription: "(none)",
    });
    expect(prompt).not.toContain("kind: create");
    expect(prompt).not.toContain("directly related");
  });

  it("documents kind: create as a sixth reply, scoped to the given typeSlugs, when the entry's type has relation fields", () => {
    const prompt = buildMagicWriteSystemPrompt({
      lang: "English",
      typeLabel: "Post",
      fieldsDescription: "(none)",
      creatableRelatedTypes: ["category", "tag"],
    });
    expect(prompt).toContain("six possible top-level replies");
    expect(prompt).toContain("kind: create");
    expect(prompt).toContain("category, tag");
    expect(prompt).toContain("only when the admin explicitly asks");
  });
});

describe("buildRewriteTurnMessage", () => {
  it("tells the model this is a rewrite request and includes the passage", () => {
    const message = buildRewriteTurnMessage('Rewrite selection: "shorter"', "<p>Original text.</p>", false);
    expect(message).toContain('Rewrite selection: "shorter"');
    expect(message).toContain("rewrite-a-passage request");
    expect(message).toContain("Passage to rewrite:");
    expect(message).toContain("<p>Original text.</p>");
    expect(message).not.toContain("inline run of text");
  });

  it("adds the inline-only restriction when the selection is inline-scoped", () => {
    const message = buildRewriteTurnMessage('Rewrite selection: "shorter"', "just a run of text", true);
    expect(message).toContain("inline run of text");
    expect(message).toContain("Do NOT wrap it in <p>");
  });
});
