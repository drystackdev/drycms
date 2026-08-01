import { describe, expect, it } from "vitest";
import { describeDestructiveChange, diffContentType } from "./draft-diff.js";
import type { ContentTypeDefinition, FieldDefinition } from "./types.js";

function field(overrides: Partial<FieldDefinition> = {}): FieldDefinition {
  return { id: "f1", name: "field1", label: "Field 1", type: "text", config: {}, validation: {}, order: 0, ...overrides };
}

function collection(overrides: Partial<ContentTypeDefinition> = {}): ContentTypeDefinition {
  return { id: "c1", kind: "collection", name: "posts", label: "Posts", fields: [], version: 0, ...overrides };
}

describe("diffContentType", () => {
  it("reports every active field as added when there's no live definition (a brand-new draft)", () => {
    const draft = collection({ fields: [field({ id: "f1", name: "body" })] });
    const diff = diffContentType(undefined, draft);

    expect(diff.isNew).toBe(true);
    expect(diff.fieldChanges).toEqual([
      expect.objectContaining({ kind: "added", fieldId: "f1" }),
    ]);
    expect(diff.editedCount).toBe(1);
  });

  it("reports no changes when the draft is identical to live", () => {
    const live = collection({ fields: [field({ id: "f1", name: "body" })] });
    const draft = collection({ fields: [field({ id: "f1", name: "body" })] });
    const diff = diffContentType(live, draft);

    expect(diff.isNew).toBe(false);
    expect(diff.fieldChanges).toEqual([]);
    expect(diff.featureChanges).toEqual([]);
    expect(diff.editedCount).toBe(0);
  });

  it("doesn't count a pure reorder (`order` only) as a change", () => {
    const live = collection({
      fields: [field({ id: "f1", name: "a", order: 0 }), field({ id: "f2", name: "b", order: 1 })],
    });
    const draft = collection({
      fields: [field({ id: "f2", name: "b", order: 0 }), field({ id: "f1", name: "a", order: 1 })],
    });
    const diff = diffContentType(live, draft);

    expect(diff.fieldChanges).toEqual([]);
    expect(diff.editedCount).toBe(0);
  });

  it("detects an added field", () => {
    const live = collection({ fields: [field({ id: "f1", name: "body" })] });
    const draft = collection({ fields: [field({ id: "f1", name: "body" }), field({ id: "f2", name: "summary" })] });
    const diff = diffContentType(live, draft);

    expect(diff.fieldChanges).toEqual([
      expect.objectContaining({ kind: "added", fieldId: "f2" }),
    ]);
  });

  it("detects a removed field", () => {
    const live = collection({ fields: [field({ id: "f1", name: "body" }), field({ id: "f2", name: "summary" })] });
    const draft = collection({ fields: [field({ id: "f1", name: "body" })] });
    const diff = diffContentType(live, draft);

    expect(diff.fieldChanges).toEqual([
      expect.objectContaining({ kind: "removed", fieldId: "f2" }),
    ]);
  });

  it("detects a changed field (label edited)", () => {
    const live = collection({ fields: [field({ id: "f1", name: "body", label: "Body" })] });
    const draft = collection({ fields: [field({ id: "f1", name: "body", label: "Main Body" })] });
    const diff = diffContentType(live, draft);

    expect(diff.fieldChanges).toEqual([
      expect.objectContaining({ kind: "changed", fieldId: "f1" }),
    ]);
  });

  it("ignores a field currently sitting in the trash (deletedFieldIds) - only ACTIVE fields are diffed", () => {
    const shared = field({ id: "f1", name: "body" });
    const live = collection({ fields: [shared], deletedFieldIds: [] });
    const draft = collection({ fields: [shared], deletedFieldIds: ["f1"] });
    const diff = diffContentType(live, draft);

    // Trashing "body" makes it disappear from the active set - same as removing it.
    expect(diff.fieldChanges).toEqual([
      expect.objectContaining({ kind: "removed", fieldId: "f1" }),
    ]);
  });

  it("detects a feature toggle turning on", () => {
    const live = collection({ features: { slug: false } });
    const draft = collection({ features: { slug: true } });
    const diff = diffContentType(live, draft);

    expect(diff.featureChanges).toEqual([{ key: "slug", enabled: true }]);
    expect(diff.editedCount).toBe(1);
  });

  it("detects a feature toggle turning off", () => {
    const live = collection({ features: { slug: true } });
    const draft = collection({ features: { slug: false } });
    const diff = diffContentType(live, draft);

    expect(diff.featureChanges).toEqual([{ key: "slug", enabled: false }]);
  });

  it("sums field and feature changes into editedCount", () => {
    const live = collection({ fields: [field({ id: "f1", name: "body" })], features: { slug: false } });
    const draft = collection({
      fields: [field({ id: "f1", name: "body" }), field({ id: "f2", name: "summary" })],
      features: { slug: true },
    });
    const diff = diffContentType(live, draft);
    expect(diff.editedCount).toBe(2);
  });

  it("flags labelChanged when the label/name/description differs", () => {
    const live = collection({ label: "Posts" });
    const draft = collection({ label: "Blog Posts" });
    expect(diffContentType(live, draft).labelChanged).toBe(true);
    expect(diffContentType(live, live).labelChanged).toBe(false);
  });
});

describe("describeDestructiveChange", () => {
  it("describes a SQL drop-column change", () => {
    const text = describeDestructiveChange({ kind: "drop-column", tableName: "posts", columnName: "body" });
    expect(text).toContain("posts");
    expect(text).toContain("body");
  });

  it("describes a SQL drop-table change", () => {
    const text = describeDestructiveChange({ kind: "drop-table", tableName: "posts" });
    expect(text).toContain("posts");
  });

  it("describes a SQL shape-changed change (column <-> child-table)", () => {
    const text = describeDestructiveChange({
      kind: "shape-changed",
      tableName: "posts",
      columnOrField: "tags",
      from: "column",
      to: "child-table",
    });
    expect(text).toContain("tags");
  });

  it("describes a SQL lossy-retype change", () => {
    const text = describeDestructiveChange({
      kind: "lossy-retype",
      tableName: "posts",
      columnName: "views",
      from: "TEXT",
      to: "INTEGER",
    });
    expect(text).toContain("views");
  });

  it("describes a file-engine field-removed change without confusing it for SQL's shape-changed", () => {
    const text = describeDestructiveChange({ kind: "field-removed", typeName: "posts", fieldName: "body" });
    expect(text).toContain("body");
    expect(text).toContain("posts");
  });

  it("describes a file-engine shape-changed change using its own (typeName/fieldName) shape", () => {
    const text = describeDestructiveChange({
      kind: "shape-changed",
      typeName: "posts",
      fieldName: "tags",
      detail: "column becomes an array",
    });
    expect(text).toContain("tags");
    expect(text).toContain("posts");
    expect(text).toContain("column becomes an array");
  });
});
