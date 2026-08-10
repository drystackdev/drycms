import { describe, expect, it } from "vitest";
import { defaultContentTypeDefinitions } from "../seed.js";
import { SYSTEM_FIELD_IDS } from "../system-fields.js";
import type { ContentTypeDefinition, FieldDefinition } from "../types.js";
import {
  buildEntryFieldTree,
  flattenDisplayColumns,
  flattenQueryableColumns,
  flattenWhereColumns,
  ID_WHERE_COLUMN,
  type EntryColumnNode,
  type EntryRelationMirrorNode,
  type EntryRelationNode,
} from "./entry-tree.js";

const allTypes = defaultContentTypeDefinitions();

function byName(nodes: ReturnType<typeof buildEntryFieldTree>, name: string) {
  const found = nodes.find((n) => n.fieldName === name);
  if (!found) throw new Error(`node "${name}" not found among [${nodes.map((n) => n.fieldName).join(", ")}]`);
  return found;
}

describe("buildEntryFieldTree", () => {
  it("maps the user collection's scalar fields to columns, in field order plus system fields after", () => {
    const user = allTypes.find((t) => t.name === "user")!;
    const nodes = buildEntryFieldTree(user, allTypes);

    // The declared fields lead, in their own order; `timestamps` is user's
    // only feature, so createdAt/updatedAt trail after them, followed by the
    // auto-generated relationmirror for `memory`'s `user` relation (see
    // `system-fields.ts`'s `relationMirrorFieldsFor`).
    expect(nodes.map((n) => n.fieldName)).toEqual(["name", "avatar", "email", "password", "roles", "createdAt", "updatedAt", "memory"]);

    const name = byName(nodes, "name") as EntryColumnNode;
    expect(name.kind).toBe("column");
    expect(name.columnName).toBe("name");
    expect(name.fieldType).toBe("text");

    const password = byName(nodes, "password") as EntryColumnNode;
    expect(password.kind).toBe("column");
    expect(password.fieldType).toBe("password");
  });

  it("hides a trashed field and a trashed feature's system field(s) from the entry tree", () => {
    const user = allTypes.find((t) => t.name === "user")!;
    const password = user.fields.find((f) => f.name === "password")!;
    const trashed: ContentTypeDefinition = {
      ...user,
      deletedFieldIds: [password.id],
      deletedFeatureKeys: ["timestamps"],
    };
    const nodes = buildEntryFieldTree(trashed, allTypes);
    // Same trailing `memory` relationmirror as the test above - trashing a
    // field/feature on `user` doesn't touch a relation some OTHER type
    // (`memory`) points at it with.
    expect(nodes.map((n) => n.fieldName)).toEqual(["name", "avatar", "email", "roles", "memory"]);
  });

  it("maps a manyToMany relation field to a child table, not a column", () => {
    const user = allTypes.find((t) => t.name === "user")!;
    const nodes = buildEntryFieldTree(user, allTypes);
    const roles = byName(nodes, "roles") as EntryRelationNode;

    expect(roles.kind).toBe("relation");
    expect(roles.cardinality).toBe("manyToMany");
    expect(roles.columnName).toBeUndefined();
    expect(roles.tableName).toBe("user_roles");
  });

  it("maps a repeatable component field to a child table with its own nested item fields", () => {
    const menu = allTypes.find((t) => t.name === "menu")!;
    const nodes = buildEntryFieldTree(menu, allTypes);
    const refs = byName(nodes, "refs");

    expect(refs.kind).toBe("component-repeat");
    if (refs.kind !== "component-repeat") throw new Error("unreachable");
    expect(refs.tableName).toBe("menu_refs");
    expect(refs.itemFields.map((f) => f.fieldName)).toEqual(["label", "description", "href"]);
    expect(refs.itemFields.every((f) => f.kind === "column")).toBe(true);
  });

  it("threads fieldId onto every node kind, not just columns - needed to resolve ContentTypeDefinition.fieldSides per field", () => {
    const user = allTypes.find((t) => t.name === "user")!;
    const roles = byName(buildEntryFieldTree(user, allTypes), "roles") as EntryRelationNode;
    expect(roles.fieldId).toBe(user.fields.find((f) => f.name === "roles")!.id);

    const menu = allTypes.find((t) => t.name === "menu")!;
    const refs = byName(buildEntryFieldTree(menu, allTypes), "refs");
    if (refs.kind !== "component-repeat") throw new Error("unreachable");
    expect(refs.fieldId).toBe(menu.fields.find((f) => f.name === "refs")!.id);

    // No seeded type ships with `features.seo` on - build a synthetic one to
    // exercise the `flatten` node kind (the built-in seo component is still
    // seeded in `allTypes` regardless, so it resolves fine).
    const withSeo: ContentTypeDefinition = {
      id: "t-with-seo",
      kind: "collection",
      name: "page",
      label: "Page",
      fields: [],
      features: { seo: true },
      version: 0,
    };
    const seo = byName(buildEntryFieldTree(withSeo, allTypes), "seo");
    expect(seo.kind).toBe("flatten");
    expect(seo.fieldId).toBe(SYSTEM_FIELD_IDS.seo);
  });
});

describe("buildEntryFieldTree - relationmirror resolution", () => {
  function relationMirrorField(overrides: Partial<FieldDefinition> & { config: Record<string, unknown> }): FieldDefinition {
    return {
      id: "f-mirror",
      name: "mirror",
      label: "Mirror",
      type: "relationmirror",
      validation: {},
      order: 0,
      ...overrides,
    };
  }

  it("resolves a mirror of a manyToMany relation to reverseCardinality manyToMany, pointed at the source's child table", () => {
    // Reuses the seed's real user.roles (manyToMany -> role) pair as the
    // source, mirrored back onto role - exactly the User/Role example from
    // the original ask.
    const user = allTypes.find((t) => t.name === "user")!;
    const role = allTypes.find((t) => t.name === "role")!;
    const rolesField = user.fields.find((f) => f.name === "roles")!;

    const roleWithMirror: ContentTypeDefinition = {
      ...role,
      fields: [
        ...role.fields,
        relationMirrorField({
          id: "role-users-mirror",
          name: "users",
          config: { sourceTypeId: user.id, sourceFieldId: rolesField.id },
        }),
      ],
    };
    const typesWithMirror = allTypes.map((t) => (t.id === role.id ? roleWithMirror : t));

    const mirror = byName(buildEntryFieldTree(roleWithMirror, typesWithMirror), "users") as EntryRelationMirrorNode;
    expect(mirror.kind).toBe("relation-mirror");
    if (!mirror.resolved) throw new Error("expected mirror to resolve");
    expect(mirror.reverseCardinality).toBe("manyToMany");
    expect(mirror.sourceTypeId).toBe(user.id);
    expect(mirror.sourceTableName).toBe("user");
    expect(mirror.sourceChildTableName).toBe("user_roles");
    expect(mirror.sourceColumnName).toBeUndefined();
  });

  it("resolves a mirror of a manyToOne relation to reverseCardinality oneToMany, pointed at the source's own column - also covers a self-relation", () => {
    // A single self-referencing type: `manager` is manyToOne -> itself,
    // mirrored back as `directReports` - proves self-relations need no
    // special-casing (source type === the mirror field's own type).
    const employee: ContentTypeDefinition = {
      id: "t-employee",
      kind: "collection",
      name: "employee",
      label: "Employee",
      fields: [
        {
          id: "f-manager",
          name: "manager",
          label: "Manager",
          type: "relation",
          config: { target: "t-employee", cardinality: "manyToOne" },
          validation: {},
          order: 0,
        },
        relationMirrorField({
          id: "f-direct-reports",
          name: "directReports",
          config: { sourceTypeId: "t-employee", sourceFieldId: "f-manager" },
        }),
      ],
      version: 0,
    };

    const mirror = byName(buildEntryFieldTree(employee, [employee]), "directReports") as EntryRelationMirrorNode;
    if (!mirror.resolved) throw new Error("expected mirror to resolve");
    expect(mirror.reverseCardinality).toBe("oneToMany");
    expect(mirror.sourceTypeId).toBe("t-employee");
    expect(mirror.sourceTableName).toBe("employee");
    expect(mirror.sourceColumnName).toBe("manager");
    expect(mirror.sourceChildTableName).toBeUndefined();
  });

  it("resolves a mirror of a oneToMany relation to reverseCardinality manyToOne, pointed at the source's child table", () => {
    // `department.employees` claims each `employee2` row for at most one
    // department (oneToMany); mirrored back on `employee2` as a single-value
    // `department` field (manyToOne reverse).
    const department: ContentTypeDefinition = {
      id: "t-department",
      kind: "collection",
      name: "department",
      label: "Department",
      fields: [
        {
          id: "f-employees",
          name: "employees",
          label: "Employees",
          type: "relation",
          config: { target: "t-employee2", cardinality: "oneToMany" },
          validation: {},
          order: 0,
        },
      ],
      version: 0,
    };
    const employee2: ContentTypeDefinition = {
      id: "t-employee2",
      kind: "collection",
      name: "employee2",
      label: "Employee 2",
      fields: [
        relationMirrorField({
          id: "f-department-mirror",
          name: "department",
          config: { sourceTypeId: "t-department", sourceFieldId: "f-employees" },
        }),
      ],
      version: 0,
    };

    const mirror = byName(buildEntryFieldTree(employee2, [department, employee2]), "department") as EntryRelationMirrorNode;
    if (!mirror.resolved) throw new Error("expected mirror to resolve");
    expect(mirror.reverseCardinality).toBe("manyToOne");
    expect(mirror.sourceTypeId).toBe("t-department");
    expect(mirror.sourceTableName).toBe("department");
    expect(mirror.sourceChildTableName).toBe("department_employees");
    expect(mirror.sourceColumnName).toBeUndefined();
  });

  it("degrades gracefully (resolved: false) when sourceTypeId doesn't exist", () => {
    const orphan: ContentTypeDefinition = {
      id: "t-orphan",
      kind: "collection",
      name: "orphan",
      label: "Orphan",
      fields: [relationMirrorField({ config: { sourceTypeId: "does-not-exist", sourceFieldId: "nope" } })],
      version: 0,
    };
    const mirror = byName(buildEntryFieldTree(orphan, [orphan]), "mirror") as EntryRelationMirrorNode;
    expect(mirror.resolved).toBe(false);
  });

  it("degrades gracefully (resolved: false) when sourceFieldId doesn't exist on sourceTypeId", () => {
    const source: ContentTypeDefinition = {
      id: "t-source",
      kind: "collection",
      name: "source",
      label: "Source",
      fields: [],
      version: 0,
    };
    const mirroring: ContentTypeDefinition = {
      id: "t-mirroring",
      kind: "collection",
      name: "mirroring",
      label: "Mirroring",
      fields: [relationMirrorField({ config: { sourceTypeId: "t-source", sourceFieldId: "no-such-field" } })],
      version: 0,
    };
    const mirror = byName(buildEntryFieldTree(mirroring, [source, mirroring]), "mirror") as EntryRelationMirrorNode;
    expect(mirror.resolved).toBe(false);
  });

  it("degrades gracefully (resolved: false) when sourceFieldId points at a field that isn't type 'relation'", () => {
    const source: ContentTypeDefinition = {
      id: "t-scalar-source",
      kind: "collection",
      name: "scalarSource",
      label: "Scalar Source",
      fields: [{ id: "f-name", name: "name", label: "Name", type: "text", config: {}, validation: {}, order: 0 }],
      version: 0,
    };
    const mirroring: ContentTypeDefinition = {
      id: "t-mirroring-scalar",
      kind: "collection",
      name: "mirroringScalar",
      label: "Mirroring Scalar",
      fields: [relationMirrorField({ config: { sourceTypeId: "t-scalar-source", sourceFieldId: "f-name" } })],
      version: 0,
    };
    const mirror = byName(buildEntryFieldTree(mirroring, [source, mirroring]), "mirror") as EntryRelationMirrorNode;
    expect(mirror.resolved).toBe(false);
  });
});

describe("flattenQueryableColumns", () => {
  it("lists only plain-column fields, excluding relation/component-repeat", () => {
    const user = allTypes.find((t) => t.name === "user")!;
    const nodes = buildEntryFieldTree(user, allTypes);
    const columns = flattenQueryableColumns(nodes);

    expect(columns.map((c) => c.fieldName)).toEqual(["name", "avatar", "email", "createdAt", "updatedAt"]);
    expect(columns.find((c) => c.fieldName === "name")?.columnName).toBe("name");
  });

  it("excludes password/secretkey columns - masked values aren't a usable List column, sort key, or search target", () => {
    const user = allTypes.find((t) => t.name === "user")!;
    const userColumns = flattenQueryableColumns(buildEntryFieldTree(user, allTypes));
    expect(userColumns.find((c) => c.fieldName === "password")).toBeUndefined();

    const aiKey = allTypes.find((t) => t.name === "aiKey")!;
    const aiKeyColumns = flattenQueryableColumns(buildEntryFieldTree(aiKey, allTypes));
    expect(aiKeyColumns.find((c) => c.fieldName === "key")).toBeUndefined();
  });

  it("also excludes secretkey from flattenDisplayColumns - the List page never shows it, not even masked", () => {
    const aiKey = allTypes.find((t) => t.name === "aiKey")!;
    const aiKeyColumns = flattenDisplayColumns(buildEntryFieldTree(aiKey, allTypes));
    expect(aiKeyColumns.find((c) => c.fieldName === "key")).toBeUndefined();
  });
});

describe("flattenWhereColumns", () => {
  const category: ContentTypeDefinition = { id: "t-category", kind: "collection", name: "category", label: "Category", fields: [], version: 0 };
  const post: ContentTypeDefinition = {
    id: "t-post",
    kind: "collection",
    name: "post",
    label: "Post",
    fields: [
      { id: "f-title", name: "title", label: "Title", type: "text", config: {}, validation: {}, order: 0 },
      { id: "f-category", name: "category", label: "Category", type: "relation", config: { target: "t-category", cardinality: "manyToOne" }, validation: {}, order: 1 },
      { id: "f-tags", name: "tags", label: "Tags", type: "relation", config: { target: "t-category", cardinality: "manyToMany" }, validation: {}, order: 2 },
    ],
    version: 0,
  };
  const postTypes = [category, post];

  it("includes a manyToOne relation field's own id column, unlike flattenQueryableColumns", () => {
    const nodes = buildEntryFieldTree(post, postTypes);
    expect(flattenQueryableColumns(nodes).map((c) => c.fieldName)).not.toContain("category");

    const whereColumns = flattenWhereColumns(nodes);
    const categoryColumn = whereColumns.find((c) => c.fieldName === "category");
    expect(categoryColumn).toBeDefined();
    expect(categoryColumn?.columnName).toBe("category");
    expect(categoryColumn?.fieldType).toBe("number");
  });

  it("still excludes a manyToMany relation field - no single column to compare against", () => {
    const nodes = buildEntryFieldTree(post, postTypes);
    expect(flattenWhereColumns(nodes).map((c) => c.fieldName)).not.toContain("tags");
  });

  it("still includes every plain column flattenQueryableColumns already returns", () => {
    const nodes = buildEntryFieldTree(post, postTypes);
    expect(flattenWhereColumns(nodes).map((c) => c.fieldName)).toEqual(expect.arrayContaining(["title"]));
  });
});

describe("ID_WHERE_COLUMN", () => {
  it("is a synthetic queryable column for the row's own primary key", () => {
    expect(ID_WHERE_COLUMN.fieldName).toBe("id");
    expect(ID_WHERE_COLUMN.columnName).toBe("id");
    expect(ID_WHERE_COLUMN.fieldType).toBe("number");
  });
});
