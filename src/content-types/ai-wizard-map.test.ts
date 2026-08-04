import { describe, expect, it } from "vitest";
import { mapWizardTables } from "./ai-wizard-map.js";
import type { ContentTypeDefinition } from "./types.js";
import type { WizardProposedTable } from "./ai-wizard-protocol.js";

const existingCategory: ContentTypeDefinition = {
  id: "cat-1",
  kind: "collection",
  name: "category",
  label: "Category",
  features: {},
  fields: [
    { id: "f-name", name: "name", label: "Name", type: "text", config: {}, validation: { required: true }, order: 0 },
  ],
  version: 1,
};

describe("mapWizardTables", () => {
  it("builds a fresh ContentTypeDefinition for a new table", () => {
    const table: WizardProposedTable = {
      name: "posts",
      label: "Posts",
      kind: "collection",
      isNew: true,
      fields: [
        { name: "heading", label: "Heading", type: "text", required: true },
        { name: "status", label: "Status", type: "select", options: ["draft", "published"] },
      ],
    };
    const [result] = mapWizardTables([table], []);
    expect(result!.ok).toBe(true);
    if (result!.ok) {
      expect(result.isNew).toBe(true);
      expect(result.definition.name).toBe("posts");
      expect(result.definition.version).toBe(0);
      expect(result.definition.fields).toHaveLength(2);
      expect(result.definition.fields[0]!.type).toBe("text");
      expect(result.definition.fields[0]!.validation.required).toBe(true);
      expect(result.definition.fields[1]!.config).toEqual({ options: ["draft", "published"], multiple: false });
    }
  });

  it("resolves a relation targeting an existing table by name", () => {
    const table: WizardProposedTable = {
      name: "posts",
      label: "Posts",
      kind: "collection",
      isNew: true,
      fields: [{ name: "category", label: "Category", type: "relation", relationTarget: "category" }],
    };
    const [result] = mapWizardTables([table], [existingCategory]);
    expect(result!.ok).toBe(true);
    if (result!.ok) {
      const field = result.definition.fields[0]!;
      expect(field.config).toEqual({ target: "cat-1", cardinality: "manyToOne" });
    }
  });

  it("resolves a relation targeting another new table in the same batch", () => {
    const tables: WizardProposedTable[] = [
      { name: "authors", label: "Authors", kind: "collection", isNew: true, fields: [{ name: "name", label: "Name", type: "text" }] },
      { name: "posts", label: "Posts", kind: "collection", isNew: true, fields: [{ name: "author", label: "Author", type: "relation", relationTarget: "authors", relationCardinality: "oneToMany" }] },
    ];
    const results = mapWizardTables(tables, []);
    const postsResult = results[1]!;
    expect(postsResult.ok).toBe(true);
    if (postsResult.ok) {
      const authorsResult = results[0]!;
      expect(authorsResult.ok).toBe(true);
      const relationField = postsResult.definition.fields[0]!;
      if (authorsResult.ok) {
        expect((relationField.config as { target: string }).target).toBe(authorsResult.definition.id);
      }
      expect((relationField.config as { cardinality: string }).cardinality).toBe("oneToMany");
    }
  });

  it("extends an existing table by adding fields, skipping ones that already exist", () => {
    const table: WizardProposedTable = {
      name: "category",
      label: "Category",
      kind: "collection",
      isNew: false,
      fields: [
        { name: "name", label: "Name", type: "text" }, // already exists - should be skipped
        { name: "shortCode", label: "Short code", type: "text" },
      ],
    };
    const [result] = mapWizardTables([table], [existingCategory]);
    expect(result!.ok).toBe(true);
    if (result!.ok) {
      expect(result.isNew).toBe(false);
      expect(result.definition.fields.map((f) => f.name)).toEqual(["name", "shortCode"]);
    }
  });

  it("stages removeFields into deletedFieldIds instead of deleting the field", () => {
    const table: WizardProposedTable = {
      name: "category",
      label: "Category",
      kind: "collection",
      isNew: false,
      fields: [],
      removeFields: ["name"],
    };
    const [result] = mapWizardTables([table], [existingCategory]);
    expect(result!.ok).toBe(true);
    if (result!.ok) {
      expect(result.definition.fields.map((f) => f.name)).toContain("name");
      expect(result.definition.deletedFieldIds).toEqual(["f-name"]);
    }
  });

  it("fails a proposed extension of a table that no longer exists", () => {
    const table: WizardProposedTable = {
      name: "ghost",
      label: "Ghost",
      kind: "collection",
      isNew: false,
      fields: [{ name: "x", label: "X", type: "text" }],
    };
    const [result] = mapWizardTables([table], [existingCategory]);
    expect(result!.ok).toBe(false);
    if (!result!.ok) expect(result!.error).toMatch(/no longer exists/);
  });

  it("fails a new table whose name collides with an existing one", () => {
    const table: WizardProposedTable = {
      name: "category",
      label: "Category",
      kind: "collection",
      isNew: true,
      fields: [{ name: "x", label: "X", type: "text" }],
    };
    const [result] = mapWizardTables([table], [existingCategory]);
    expect(result!.ok).toBe(false);
    if (!result!.ok) expect(result!.error).toMatch(/already used/);
  });

  it("fails a new table with a reserved field name", () => {
    const table: WizardProposedTable = {
      name: "posts",
      label: "Posts",
      kind: "collection",
      isNew: true,
      fields: [{ name: "id", label: "Id", type: "text" }],
    };
    const [result] = mapWizardTables([table], []);
    expect(result!.ok).toBe(false);
  });
});
