import { describe, expect, it } from "vitest";
import { planMigration, planSave } from "./migration.js";
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

function sql(plan: ReturnType<typeof planMigration>): string[] {
  return plan.tables.flatMap((t) => t.statements.map((s) => s.sql));
}

describe("planMigration", () => {
  it("creates the table for a brand-new content type", () => {
    const target = collection({ fields: [field({ id: "f1", name: "body" })] });
    const plan = planMigration({ target, oldAllTypes: [], newAllTypes: [target] });

    expect(plan.tables).toHaveLength(1);
    expect(plan.tables[0]!.action).toBe("create");
    expect(plan.expectedVersion).toBe(0);
    expect(plan.nextVersion).toBe(1);
    expect(sql(plan).some((s) => s.includes("CREATE TABLE") && s.includes("posts"))).toBe(true);
  });

  it("adds a column when a new field is introduced", () => {
    const old = collection({ fields: [field({ id: "f1", name: "body" })] });
    const next = collection({ fields: [field({ id: "f1", name: "body" }), field({ id: "f2", name: "summary" })] });
    const plan = planMigration({ target: next, oldAllTypes: [old], newAllTypes: [next] });

    expect(plan.tables[0]!.action).toBe("alter");
    expect(plan.tables[0]!.destructive).toEqual([]);
    expect(sql(plan).some((s) => s.includes('ADD COLUMN "summary"'))).toBe(true);
  });

  it("renames a column when the field id is unchanged but the name changed, with no data loss reported", () => {
    const old = collection({ fields: [field({ id: "f1", name: "body" })] });
    const next = collection({ fields: [field({ id: "f1", name: "content" })] });
    const plan = planMigration({ target: next, oldAllTypes: [old], newAllTypes: [next] });

    expect(plan.tables[0]!.action).toBe("alter");
    expect(plan.tables[0]!.destructive).toEqual([]);
    const statements = sql(plan);
    expect(statements.some((s) => s.includes("RENAME COLUMN"))).toBe(true);
  });

  it("drops a column when a field is removed, and reports it as destructive", () => {
    const old = collection({ fields: [field({ id: "f1", name: "body" })] });
    const next = collection({ fields: [] });
    const plan = planMigration({ target: next, oldAllTypes: [old], newAllTypes: [next] });

    expect(plan.tables[0]!.action).toBe("alter");
    expect(plan.tables[0]!.destructive).toEqual([{ kind: "drop-column", tableName: "posts", columnName: "body" }]);
    expect(sql(plan).some((s) => s.includes('DROP COLUMN "body"'))).toBe(true);
  });

  it("recreates the table when a field's type changes, reporting a lossy-retype", () => {
    const old = collection({ fields: [field({ id: "f1", name: "views", type: "text" })] });
    const next = collection({ fields: [field({ id: "f1", name: "views", type: "number" })] });
    const plan = planMigration({ target: next, oldAllTypes: [old], newAllTypes: [next] });

    expect(plan.tables[0]!.action).toBe("recreate");
    expect(plan.tables[0]!.destructive).toEqual([
      { kind: "lossy-retype", tableName: "posts", columnName: "views", from: "TEXT", to: "REAL" },
    ]);
    const statements = sql(plan);
    expect(statements.some((s) => s.includes("__migrate_tmp"))).toBe(true);
    expect(statements.some((s) => s.includes("CAST"))).toBe(true);
  });

  it("renames the table itself when the content type's own name changes", () => {
    const old = collection({ name: "posts" });
    const next = collection({ name: "articles" });
    const plan = planMigration({ target: next, oldAllTypes: [old], newAllTypes: [next] });

    expect(plan.tables[0]!.action).toBe("alter");
    expect(sql(plan).some((s) => s.includes('RENAME TO "articles"'))).toBe(true);
  });

  it("treats a relation flipping from one to many as a shape change, not a plain retype", () => {
    const category = collection({ id: "cat", name: "categories" });
    const old = collection({
      fields: [field({ id: "rel", name: "category", type: "relation", config: { target: "cat", cardinality: "one" } })],
    });
    const next = collection({
      fields: [field({ id: "rel", name: "category", type: "relation", config: { target: "cat", cardinality: "many" } })],
    });
    const plan = planMigration({ target: next, oldAllTypes: [old, category], newAllTypes: [next, category] });

    const shapeChange = plan.tables.flatMap((t) => t.destructive).find((d) => d.kind === "shape-changed");
    expect(shapeChange).toBeDefined();
    // A new child table for the join is created alongside the parent's alter.
    expect(plan.tables.some((t) => t.tableName === "posts_category" && t.action === "create")).toBe(true);
  });

  it("drops the title column when the slug feature is turned off, since title is bundled with slug", () => {
    const old = collection({ features: { slug: true } });
    const next = collection({ features: {} });
    const plan = planMigration({ target: next, oldAllTypes: [old], newAllTypes: [next] });

    expect(plan.tables[0]!.action).toBe("alter");
    expect(plan.tables[0]!.destructive).toEqual(
      expect.arrayContaining([{ kind: "drop-column", tableName: "posts", columnName: "title" }]),
    );
  });

  it("does nothing when nothing changed", () => {
    const type = collection({ fields: [field({ id: "f1", name: "body" })] });
    const plan = planMigration({ target: type, oldAllTypes: [type], newAllTypes: [type] });
    expect(plan.tables).toEqual([]);
  });
});

describe("planSave", () => {
  it("cascades a component save to every collection that embeds it, even though the collection's own fields are unchanged", () => {
    const oldSeo = component({ id: "seo", fields: [field({ id: "meta", name: "metaTitle", type: "text" })] });
    const newSeo = component({ id: "seo", fields: [field({ id: "meta", name: "title", type: "text" })] });
    const post = collection({
      id: "post",
      fields: [field({ id: "hero", name: "seo", type: "component", config: { componentId: "seo", repeatable: false } })],
    });

    const result = planSave({
      savedType: newSeo,
      oldAllTypes: [oldSeo, post],
      newAllTypes: [newSeo, post],
    });

    expect(result.primary.tables).toEqual([]); // components have no table of their own
    expect(result.cascaded).toHaveLength(1);
    expect(result.cascaded[0]!.targetContentTypeId).toBe("post");
    expect(sql(result.cascaded[0]!).some((s) => s.includes("RENAME COLUMN"))).toBe(true);
  });

  it("does not cascade for a plain collection save", () => {
    const type = collection({ fields: [field({ id: "f1", name: "body" })] });
    const result = planSave({ savedType: type, oldAllTypes: [], newAllTypes: [type] });
    expect(result.cascaded).toEqual([]);
  });
});
