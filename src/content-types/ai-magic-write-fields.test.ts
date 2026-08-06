import { describe, expect, it } from "vitest";
import { applyMagicWriteFields, isEmptyValue } from "./ai-magic-write-fields.js";
import type { EntryFieldNode } from "./engine/entry-tree.js";

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

const NODES: EntryFieldNode[] = [
  column({ fieldName: "title", fieldType: "text" }),
  column({ fieldName: "body", fieldType: "richtext" }),
  column({ fieldName: "views", fieldType: "number" }),
  column({ fieldName: "featured", fieldType: "boolean" }),
  column({ fieldName: "publishedDate", fieldType: "date" }),
  column({ fieldName: "status", fieldType: "select", fieldConfig: { options: ["draft", "live"], multiple: false } }),
  column({ fieldName: "secretkey", fieldType: "secretkey" }),
  column({ fieldName: "password", fieldType: "password" }),
  column({ fieldName: "cover", fieldType: "image" }),
  column({ fieldName: "gallery", fieldType: "image", fieldConfig: { multiple: true } }),
  {
    kind: "flatten",
    fieldId: "author",
    fieldName: "author",
    label: "Author",
    children: [column({ fieldName: "name", fieldType: "text" })],
  },
  {
    kind: "relation",
    fieldId: "category",
    fieldName: "category",
    label: "Category",
    cardinality: "manyToOne",
    targetTypeId: "cat",
    columnName: "category_id",
    sortable: false,
    validation: {},
  },
  {
    kind: "component-repeat",
    fieldId: "sections",
    fieldName: "sections",
    label: "Sections",
    tableName: "post_sections",
    sortable: false,
    validation: {},
    itemFields: [
      column({ fieldName: "heading", fieldType: "text" }),
      column({ fieldName: "body", fieldType: "richtext" }),
    ],
  },
];

describe("isEmptyValue", () => {
  it("treats null/undefined/blank string/empty array as empty", () => {
    expect(isEmptyValue(null)).toBe(true);
    expect(isEmptyValue(undefined)).toBe(true);
    expect(isEmptyValue("  ")).toBe(true);
    expect(isEmptyValue([])).toBe(true);
  });
  it("treats a non-empty string/number/array as not empty", () => {
    expect(isEmptyValue("hi")).toBe(false);
    expect(isEmptyValue(0)).toBe(false);
    expect(isEmptyValue([1])).toBe(false);
  });
});

describe("applyMagicWriteFields", () => {
  it("writes every field the model included, coerced to its real type, regardless of current value", () => {
    const result = applyMagicWriteFields(NODES, {
      title: "New Title",
      body: "<p>Hi</p>",
      views: "42",
      featured: "true",
      publishedDate: "2026-08-06",
      status: "live",
    });
    expect(result.writtenFieldNames.sort()).toEqual(["body", "featured", "publishedDate", "status", "title", "views"].sort());
    expect(result.value.title).toBe("New Title");
    expect(result.value.body).toBe("<p>Hi</p>");
    expect(result.value.views).toBe(42);
    expect(result.value.featured).toBe(true);
    expect(result.value.publishedDate).toBe(new Date("2026-08-06").toISOString());
    expect(result.value.status).toBe("live");
  });

  it("only writes fields the model actually included in its reply", () => {
    const result = applyMagicWriteFields(NODES, { title: "Only Title" });
    expect(result.writtenFieldNames).toEqual(["title"]);
    expect(result.value.body).toBeUndefined();
  });

  it("never writes relation, secretkey, or password fields", () => {
    const result = applyMagicWriteFields(NODES, { category: "1", secretkey: "leak-me", password: "leak-me" });
    expect(result.writtenFieldNames).toEqual([]);
  });

  it("drops an out-of-range select value and an unparseable number/date", () => {
    const result = applyMagicWriteFields(NODES, { status: "not-an-option", views: "not-a-number", publishedDate: "not-a-date" });
    expect(result.writtenFieldNames).toEqual([]);
  });

  it("recurses into a flatten group and only includes it if a child was written", () => {
    const result = applyMagicWriteFields(NODES, { author: { name: "Jane" } });
    expect(result.value.author).toEqual({ name: "Jane" });
    expect(result.writtenFieldNames).toContain("author");
  });
});

describe("applyMagicWriteFields - richtext sanitization", () => {
  it("sanitizes richtext HTML through the shared sanitizer", () => {
    const result = applyMagicWriteFields(NODES, { body: '<p>safe</p><script>alert(1)</script>' });
    expect(result.value.body).toBe("<p>safe</p>");
  });

  it("passes allowedImageSrcs through to the richtext sanitizer", () => {
    const result = applyMagicWriteFields(NODES, { body: '<p><img src="photos/a.jpg"></p>' }, new Set(["photos/a.jpg"]));
    expect(result.value.body).toBe('<p><img src="photos/a.jpg" alt=""></p>');
  });
});

describe("applyMagicWriteFields - image fields (Phase 2)", () => {
  it("drops an image path that isn't in the allowed set", () => {
    const result = applyMagicWriteFields(NODES, { cover: "photos/a.jpg" });
    expect(result.writtenFieldNames).toEqual([]);
  });

  it("writes a bare path for a single-image field once it's allowed", () => {
    const result = applyMagicWriteFields(NODES, { cover: "photos/a.jpg" }, new Set(["photos/a.jpg"]));
    expect(result.value.cover).toBe("photos/a.jpg");
  });

  it("wraps the value in a single-element array for a multiple: true image field", () => {
    const result = applyMagicWriteFields(NODES, { gallery: "photos/a.jpg" }, new Set(["photos/a.jpg"]));
    expect(result.value.gallery).toEqual(["photos/a.jpg"]);
  });
});

describe("applyMagicWriteFields - component-repeat (Phase 3)", () => {
  it("writes a fresh array of coerced items, dropping an item that ends up empty", () => {
    const result = applyMagicWriteFields(NODES, {
      sections: [
        { heading: "First", body: "<p>One</p>" },
        {}, // No usable fields - dropped entirely.
        { heading: "Second", body: '<p>Two</p><script>alert(1)</script>' },
      ],
    });
    expect(result.writtenFieldNames).toEqual(["sections"]);
    expect(result.value.sections).toEqual([
      { heading: "First", body: "<p>One</p>" },
      { heading: "Second", body: "<p>Two</p>" },
    ]);
  });

  it("replaces the whole array wholesale, even when the entry already has items", () => {
    const result = applyMagicWriteFields(NODES, { sections: [{ heading: "New" }] });
    expect(result.value.sections).toEqual([{ heading: "New" }]);
  });

  it("drops the field entirely when every item ends up empty", () => {
    const result = applyMagicWriteFields(NODES, { sections: [{}, {}] });
    expect(result.writtenFieldNames).toEqual([]);
  });
});
