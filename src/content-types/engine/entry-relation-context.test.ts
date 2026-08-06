import { describe, expect, it } from "vitest";
import { loadRelationContext } from "./entry-relation-context.js";
import type { ContentEntryEngineAdapter, EntryRow } from "./entries-types.js";
import type { EntryFieldNode } from "./entry-tree.js";
import type { ContentTypeDefinition } from "../types.js";

const AUTHOR_TYPE = { id: "author", kind: "collection", name: "author", label: "Author", fields: [], version: 1 } as ContentTypeDefinition;
const ALL_TYPES: ContentTypeDefinition[] = [AUTHOR_TYPE];

function fakeAdapter(rows: Record<number, EntryRow>): ContentEntryEngineAdapter {
  return {
    getEntry: async (_type, _allTypes, id) => rows[id] ?? null,
  } as unknown as ContentEntryEngineAdapter;
}

const MANY_TO_ONE_NODE: EntryFieldNode = {
  kind: "relation",
  fieldId: "author",
  fieldName: "author",
  label: "Author",
  cardinality: "manyToOne",
  targetTypeId: "author",
  columnName: "author_id",
  sortable: false,
  validation: {},
};

const MANY_TO_MANY_NODE: EntryFieldNode = {
  kind: "relation",
  fieldId: "coAuthors",
  fieldName: "coAuthors",
  label: "Co-authors",
  cardinality: "manyToMany",
  targetTypeId: "author",
  tableName: "post_co_authors",
  sortable: false,
  validation: {},
};

const UNRESOLVED_MIRROR_NODE: EntryFieldNode = {
  kind: "relation-mirror",
  fieldId: "posts",
  fieldName: "posts",
  label: "Posts",
  resolved: false,
};

describe("loadRelationContext", () => {
  it("returns an empty string when there are no relation fields", async () => {
    const context = await loadRelationContext(fakeAdapter({}), ALL_TYPES, [], {});
    expect(context).toBe("");
  });

  it("describes a manyToOne relation's linked row with a few preview fields", async () => {
    const adapter = fakeAdapter({ 1: { id: 1, value: { name: "Jane Doe", bio: "A writer.", secretkey: { hasExisting: true } } } });
    const context = await loadRelationContext(adapter, ALL_TYPES, [MANY_TO_ONE_NODE], { author: 1 });
    expect(context).toContain('"Author" -> Author #1');
    expect(context).toContain('name: "Jane Doe"');
    expect(context).toContain('bio: "A writer."');
    // Masked/object values are never expanded into the preview.
    expect(context).not.toContain("secretkey");
  });

  it("describes every linked row of a multi-valued relation", async () => {
    const adapter = fakeAdapter({
      1: { id: 1, value: { name: "Jane" } },
      2: { id: 2, value: { name: "Alex" } },
    });
    const context = await loadRelationContext(adapter, ALL_TYPES, [MANY_TO_MANY_NODE], { coAuthors: [1, 2] });
    expect(context).toContain("#1");
    expect(context).toContain("#2");
  });

  it("skips a field with no current value and an unresolved relation-mirror", async () => {
    const adapter = fakeAdapter({ 1: { id: 1, value: { name: "Jane" } } });
    const context = await loadRelationContext(adapter, ALL_TYPES, [MANY_TO_ONE_NODE, UNRESOLVED_MIRROR_NODE], {});
    expect(context).toBe("");
  });

  it("skips an id that no longer resolves to a row", async () => {
    const context = await loadRelationContext(fakeAdapter({}), ALL_TYPES, [MANY_TO_ONE_NODE], { author: 999 });
    expect(context).toBe("");
  });
});
