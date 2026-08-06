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

describe("applyMagicWriteFields - mode: empty", () => {
  it("only writes fields that were empty, coerced to their real type", () => {
    const currentValue = { title: "", body: "", views: 3, featured: false, publishedDate: null, status: null };
    const result = applyMagicWriteFields(
      NODES,
      {
        title: "New Title",
        body: "<p>Hi</p>",
        views: "42",
        featured: "true",
        publishedDate: "2026-08-06",
        status: "live",
      },
      currentValue,
      { mode: "empty" },
    );
    // "views" and "featured" were already non-empty in currentValue, so must be skipped.
    expect(result.writtenFieldNames.sort()).toEqual(["body", "publishedDate", "status", "title"].sort());
    expect(result.value.title).toBe("New Title");
    expect(result.value.body).toBe("<p>Hi</p>");
    expect(result.value.publishedDate).toBe(new Date("2026-08-06").toISOString());
    expect(result.value.status).toBe("live");
    expect(result.value.views).toBeUndefined();
    expect(result.value.featured).toBeUndefined();
  });

  it("never writes relation, secretkey, or password fields", () => {
    const result = applyMagicWriteFields(
      NODES,
      { category: "1", secretkey: "leak-me", password: "leak-me" },
      {},
      { mode: "empty" },
    );
    expect(result.writtenFieldNames).toEqual([]);
  });

  it("drops an out-of-range select value and an unparseable number/date", () => {
    const result = applyMagicWriteFields(
      NODES,
      { status: "not-an-option", views: "not-a-number", publishedDate: "not-a-date" },
      {},
      { mode: "empty" },
    );
    expect(result.writtenFieldNames).toEqual([]);
  });

  it("recurses into a flatten group and only includes it if a child was written", () => {
    const result = applyMagicWriteFields(NODES, { author: { name: "Jane" } }, {}, { mode: "empty" });
    expect(result.value.author).toEqual({ name: "Jane" });
    expect(result.writtenFieldNames).toContain("author");
  });
});

describe("applyMagicWriteFields - mode: selected", () => {
  it("only writes fields explicitly in targetFields, even if already filled", () => {
    const result = applyMagicWriteFields(
      NODES,
      { title: "Overwritten", body: "<p>Overwritten</p>" },
      { title: "Old Title", body: "<p>Old</p>" },
      { mode: "selected", targetFields: ["title"] },
    );
    expect(result.writtenFieldNames).toEqual(["title"]);
    expect(result.value.title).toBe("Overwritten");
    expect(result.value.body).toBeUndefined();
  });
});

describe("applyMagicWriteFields - richtext sanitization", () => {
  it("sanitizes richtext HTML through the shared sanitizer", () => {
    const result = applyMagicWriteFields(
      NODES,
      { body: '<p>safe</p><script>alert(1)</script>' },
      {},
      { mode: "empty" },
    );
    expect(result.value.body).toBe("<p>safe</p>");
  });

  it("passes allowedImageSrcs through to the richtext sanitizer", () => {
    const result = applyMagicWriteFields(
      NODES,
      { body: '<p><img src="photos/a.jpg"></p>' },
      {},
      { mode: "empty" },
      new Set(["photos/a.jpg"]),
    );
    expect(result.value.body).toBe('<p><img src="photos/a.jpg" alt=""></p>');
  });
});

describe("applyMagicWriteFields - image fields (Phase 2)", () => {
  it("drops an image path that isn't in the allowed set", () => {
    const result = applyMagicWriteFields(NODES, { cover: "photos/a.jpg" }, {}, { mode: "empty" });
    expect(result.writtenFieldNames).toEqual([]);
  });

  it("writes a bare path for a single-image field once it's allowed", () => {
    const result = applyMagicWriteFields(NODES, { cover: "photos/a.jpg" }, {}, { mode: "empty" }, new Set(["photos/a.jpg"]));
    expect(result.value.cover).toBe("photos/a.jpg");
  });

  it("wraps the value in a single-element array for a multiple: true image field", () => {
    const result = applyMagicWriteFields(NODES, { gallery: "photos/a.jpg" }, {}, { mode: "empty" }, new Set(["photos/a.jpg"]));
    expect(result.value.gallery).toEqual(["photos/a.jpg"]);
  });
});

describe("applyMagicWriteFields - component-repeat (Phase 3)", () => {
  it("writes a fresh array of coerced items, dropping an item that ends up empty", () => {
    const result = applyMagicWriteFields(
      NODES,
      {
        sections: [
          { heading: "First", body: "<p>One</p>" },
          {}, // No usable fields - dropped entirely.
          { heading: "Second", body: '<p>Two</p><script>alert(1)</script>' },
        ],
      },
      {},
      { mode: "empty" },
    );
    expect(result.writtenFieldNames).toEqual(["sections"]);
    expect(result.value.sections).toEqual([
      { heading: "First", body: "<p>One</p>" },
      { heading: "Second", body: "<p>Two</p>" },
    ]);
  });

  it("replaces the whole array wholesale in mode: selected, even with existing items", () => {
    const result = applyMagicWriteFields(
      NODES,
      { sections: [{ heading: "New" }] },
      { sections: [{ heading: "Old", body: "<p>Old</p>" }] },
      { mode: "selected", targetFields: ["sections"] },
    );
    expect(result.value.sections).toEqual([{ heading: "New" }]);
  });

  it("is empty (for mode: empty scoping) only when the current array has zero items", () => {
    const withItems = applyMagicWriteFields(
      NODES,
      { sections: [{ heading: "New" }] },
      { sections: [{ heading: "Existing" }] },
      { mode: "empty" },
    );
    expect(withItems.writtenFieldNames).toEqual([]);

    const withoutItems = applyMagicWriteFields(NODES, { sections: [{ heading: "New" }] }, { sections: [] }, { mode: "empty" });
    expect(withoutItems.writtenFieldNames).toEqual(["sections"]);
  });

  it("drops the field entirely when every item ends up empty", () => {
    const result = applyMagicWriteFields(NODES, { sections: [{}, {}] }, {}, { mode: "empty" });
    expect(result.writtenFieldNames).toEqual([]);
  });
});
