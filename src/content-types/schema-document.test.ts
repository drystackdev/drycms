import { describe, expect, it } from "vitest";
import type { ContentTypeDefinition } from "./types.js";
import {
  SCHEMA_DOCUMENT_FORMAT,
  emptySchemaDocument,
  findDraft,
  parseSchemaDocument,
  serializeSchemaDocument,
  withAppliedType,
  withDraft,
  withoutAppliedType,
  withoutDraft,
} from "./schema-document.js";

function type(id: string, name: string, version = 1): ContentTypeDefinition {
  return { id, kind: "collection", name, label: name, fields: [], version } as ContentTypeDefinition;
}

describe("parseSchemaDocument", () => {
  it("round-trips a serialized document", () => {
    const doc = withDraft(withAppliedType(emptySchemaDocument(), type("a", "post")), type("b", "author", 0), { now: 10 });
    const parsed = parseSchemaDocument(serializeSchemaDocument(doc));
    expect(parsed.applied.map((t) => t.name)).toEqual(["post"]);
    expect(parsed.drafts.map((d) => d.definition.name)).toEqual(["author"]);
    expect(parsed.revision).toBe(1);
  });

  it("orders `applied` by name so the file's diff only shows real changes", () => {
    let doc = emptySchemaDocument();
    for (const name of ["zebra", "apple", "Mango"]) doc = withAppliedType(doc, type(name, name));
    const text = serializeSchemaDocument(doc);
    expect(text.indexOf('"apple"')).toBeLessThan(text.indexOf('"Mango"'));
    expect(text.indexOf('"Mango"')).toBeLessThan(text.indexOf('"zebra"'));
    expect(text.endsWith("\n")).toBe(true);
  });

  it("rejects a corrupt or future-format file instead of reporting an empty schema", () => {
    expect(() => parseSchemaDocument("{ not json")).toThrow(/valid JSON/);
    expect(() => parseSchemaDocument("[]")).toThrow(/JSON object/);
    expect(() => parseSchemaDocument(JSON.stringify({ revision: 1 }))).toThrow(/"applied"/);
    expect(() => parseSchemaDocument(JSON.stringify({ applied: [{ id: "x" }] }))).toThrow(/not a content type/);
    expect(() =>
      parseSchemaDocument(JSON.stringify({ format: SCHEMA_DOCUMENT_FORMAT + 1, applied: [] })),
    ).toThrow(/newer version/);
  });
});

describe("applied/draft transitions", () => {
  it("bumps `revision` on an apply and clears that type's staged draft", () => {
    const staged = withDraft(emptySchemaDocument(), type("a", "post", 0));
    expect(staged.revision).toBe(0);
    expect(findDraft(staged, "a")?.isNew).toBe(true);

    const applied = withAppliedType(staged, type("a", "post", 1));
    expect(applied.revision).toBe(1);
    expect(applied.drafts).toEqual([]);
    expect(applied.applied.map((t) => t.version)).toEqual([1]);
  });

  it("keeps `revision` still for a draft write - nothing live changed", () => {
    const live = withAppliedType(emptySchemaDocument(), type("a", "post", 1));
    const edited = withDraft(live, { ...type("a", "post", 1), label: "Posts" });
    expect(edited.revision).toBe(live.revision);
    // Not new: this id is already live, so the UI has a baseline to diff.
    expect(findDraft(edited, "a")?.isNew).toBe(false);
    expect(withoutDraft(edited, "a").drafts).toEqual([]);
  });

  it("drops a deleted type's draft along with the type itself", () => {
    const live = withDraft(withAppliedType(emptySchemaDocument(), type("a", "post", 1)), { ...type("a", "post", 1), label: "Posts" });
    const removed = withoutAppliedType(live, "a");
    expect(removed.applied).toEqual([]);
    expect(removed.drafts).toEqual([]);
    expect(removed.revision).toBe(live.revision + 1);
  });
});
