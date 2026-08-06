import { describe, expect, it } from "vitest";
import { buildMagicWriteSystemPrompt, describeFieldsForPrompt } from "./ai-magic-write-prompt.js";
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

  it("keeps relation and never-exposed field types out of the description", () => {
    const nodes: EntryFieldNode[] = [
      column({ fieldName: "password", fieldType: "password", label: "Mật khẩu" }),
      {
        kind: "relation",
        fieldId: "category",
        fieldName: "category",
        label: "Danh mục",
        cardinality: "manyToOne",
        targetTypeId: "cat",
        columnName: "category_id",
        sortable: false,
        validation: {},
      },
    ];
    expect(describeFieldsForPrompt(nodes, {})).toBe("(this content type has no field Magic Write can write to)");
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
});
