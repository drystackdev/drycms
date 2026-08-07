import { describe, expect, it } from "vitest";
import { defaultContentTypeDefinitions } from "../seed.js";
import type { ContentTypeDefinition, FieldDefinition } from "../types.js";
import { buildEntryFieldTree, type EntryColumnNode } from "./entry-tree.js";
import { buildEntrySummary, type ResolveRelation } from "./entry-summary.js";

const allTypes = defaultContentTypeDefinitions();

const noopResolve: ResolveRelation = async () => undefined;

function column(overrides: Partial<EntryColumnNode> & Pick<EntryColumnNode, "fieldName" | "fieldType">): EntryColumnNode {
  return {
    kind: "column",
    fieldId: overrides.fieldName,
    label: overrides.fieldName,
    columnName: overrides.fieldName,
    fieldConfig: {},
    validation: {},
    ...overrides,
  };
}

describe("buildEntrySummary", () => {
  it("falls back to the first displayable field when displayFields is empty", async () => {
    const nodes = [column({ fieldName: "title", fieldType: "text" }), column({ fieldName: "body", fieldType: "text" })];
    const lines = await buildEntrySummary(undefined, nodes, { title: "Hello", body: "World" }, allTypes, noopResolve);
    expect(lines).toEqual([{ fieldName: "title", label: "title", kind: "text", text: "Hello" }]);
  });

  it("renders every chosen field, one line each, in the requested order (not schema order)", async () => {
    const nodes = [column({ fieldName: "title", fieldType: "text" }), column({ fieldName: "body", fieldType: "text" })];
    const lines = await buildEntrySummary(["body", "title"], nodes, { title: "Hello", body: "World" }, allTypes, noopResolve);
    expect(lines.map((l) => l.fieldName)).toEqual(["body", "title"]);
  });

  it("silently skips a displayFields entry that no longer matches any field", async () => {
    const nodes = [column({ fieldName: "title", fieldType: "text" })];
    const lines = await buildEntrySummary(["deletedField", "title"], nodes, { title: "Hello" }, allTypes, noopResolve);
    expect(lines).toEqual([{ fieldName: "title", label: "title", kind: "text", text: "Hello" }]);
  });

  it("formats an image field as imageIds, single or multiple", async () => {
    const nodes = [column({ fieldName: "photo", fieldType: "image" })];
    const single = await buildEntrySummary(["photo"], nodes, { photo: "abc.jpg" }, allTypes, noopResolve);
    expect(single[0]).toMatchObject({ kind: "image", imageIds: ["abc.jpg"] });

    const multi = await buildEntrySummary(["photo"], nodes, { photo: ["a.jpg", "b.jpg"] }, allTypes, noopResolve);
    expect(multi[0]).toMatchObject({ kind: "image", imageIds: ["a.jpg", "b.jpg"] });
  });

  it("formats boolean as On/Off and strips HTML from richtext", async () => {
    const nodes = [column({ fieldName: "active", fieldType: "boolean" }), column({ fieldName: "notes", fieldType: "richtext" })];
    const lines = await buildEntrySummary(
      ["active", "notes"],
      nodes,
      { active: true, notes: "<p>Hello <b>world</b></p>" },
      allTypes,
      noopResolve,
    );
    expect(lines[0]?.text).toBe("On");
    expect(lines[1]?.text).toBe("Hello world");
  });

  it("shows a dash for an empty/missing value", async () => {
    const nodes = [column({ fieldName: "title", fieldType: "text" })];
    const lines = await buildEntrySummary(["title"], nodes, { title: "" }, allTypes, noopResolve);
    expect(lines[0]?.text).toBe("-");
  });

  it("recurses into a component-repeat display field using its own (nested) displayFields, inline - no fetch needed", async () => {
    const menu = allTypes.find((t) => t.name === "menu")!;
    const nodes = buildEntryFieldTree(menu, allTypes);
    const value = {
      refs: [
        { label: "Home", description: "", href: "/" },
        { label: "About", description: "", href: "/about" },
      ],
    };
    const lines = await buildEntrySummary(["refs"], nodes, value, allTypes, noopResolve);
    expect(lines).toHaveLength(1);
    const [line] = lines;
    expect(line?.kind).toBe("list-items");
    expect(line?.items).toHaveLength(2);
    // `refs`' own `displayFields` isn't set on the seeded menu type, so each
    // item falls back to its own first field ("label").
    expect(line?.items?.map((item) => item.lines)).toEqual([
      [{ fieldName: "label", label: "Label", kind: "text", text: "Home" }],
      [{ fieldName: "label", label: "Label", kind: "text", text: "About" }],
    ]);
  });

  it("recurses into a relation display field by fetching each target id via resolveRelation", async () => {
    const user = allTypes.find((t) => t.name === "user")!;
    const role = allTypes.find((t) => t.name === "role")!;
    const nodes = buildEntryFieldTree(user, allTypes);

    const resolveRelation: ResolveRelation = async (targetTypeId, id) => {
      if (targetTypeId === role.id && id === "role-1") return { name: "Super Admin", description: "", isSuperAdmin: true };
      return undefined;
    };

    const lines = await buildEntrySummary(["roles"], nodes, { roles: ["role-1"] }, allTypes, resolveRelation);
    expect(lines).toHaveLength(1);
    const [line] = lines;
    expect(line?.kind).toBe("list-items");
    expect(line?.items).toEqual([{ id: "role-1", lines: [{ fieldName: "name", label: "Name", kind: "text", text: "Super Admin" }] }]);
  });

  it("degrades a relation id that resolveRelation can't find to a bare id line", async () => {
    const user = allTypes.find((t) => t.name === "user")!;
    const nodes = buildEntryFieldTree(user, allTypes);
    const lines = await buildEntrySummary(["roles"], nodes, { roles: ["missing-role"] }, allTypes, noopResolve);
    expect(lines[0]?.items).toEqual([{ id: "missing-role", lines: [{ fieldName: "id", label: "ID", kind: "text", text: "missing-role" }] }]);
  });

  it("stops recursing (truncated) instead of looping forever on a mutual self-relation cycle", async () => {
    const catAId = "cat-a";
    const catBId = "cat-b";
    const catAFieldToB: FieldDefinition = {
      id: "field-a-next",
      name: "next",
      label: "Next",
      type: "relation",
      config: { target: catBId, cardinality: "manyToOne", displayFields: ["title", "next"] },
      validation: {},
      order: 1,
    };
    const catATitle: FieldDefinition = { id: "field-a-title", name: "title", label: "Title", type: "text", config: {}, validation: {}, order: 0 };
    const catBFieldToA: FieldDefinition = {
      id: "field-b-next",
      name: "next",
      label: "Next",
      type: "relation",
      config: { target: catAId, cardinality: "manyToOne", displayFields: ["title", "next"] },
      validation: {},
      order: 1,
    };
    const catBTitle: FieldDefinition = { id: "field-b-title", name: "title", label: "Title", type: "text", config: {}, validation: {}, order: 0 };

    const catA: ContentTypeDefinition = { id: catAId, kind: "collection", name: "cata", label: "CatA", fields: [catATitle, catAFieldToB] };
    const catB: ContentTypeDefinition = { id: catBId, kind: "collection", name: "catb", label: "CatB", fields: [catBTitle, catBFieldToA] };
    const cyclicTypes = [catA, catB];

    const resolveRelation: ResolveRelation = async (targetTypeId, id) => {
      if (targetTypeId === catAId) return { title: `A-${id}`, next: "b-1" };
      if (targetTypeId === catBId) return { title: `B-${id}`, next: "a-1" };
      return undefined;
    };

    const nodes = buildEntryFieldTree(catA, cyclicTypes);
    const lines = await buildEntrySummary(["title", "next"], nodes, { title: "A-root", next: "b-1" }, cyclicTypes, resolveRelation);

    expect(lines[0]).toMatchObject({ fieldName: "title", text: "A-root" });
    // Walk the nested chain until it terminates - it must terminate (this
    // `await` resolving at all, without vitest's own timeout firing, is
    // itself part of what this test is checking), and the last link must be
    // explicitly marked `truncated` rather than just quietly empty.
    let current = lines[1];
    let hops = 0;
    while (current?.items?.[0]?.lines?.[1] && !current.truncated) {
      current = current.items[0].lines[1];
      hops++;
      expect(hops).toBeLessThan(10);
    }
    expect(current?.truncated).toBe(true);
  });
});
