import { describe, expect, it } from "vitest";
import { defaultContentTypeDefinitions } from "../seed.js";
import { buildEntryFieldTree, flattenQueryableColumns, type EntryColumnNode, type EntryRelationNode } from "./entry-tree.js";

const allTypes = defaultContentTypeDefinitions();

function byName(nodes: ReturnType<typeof buildEntryFieldTree>, name: string) {
  const found = nodes.find((n) => n.fieldName === name);
  if (!found) throw new Error(`node "${name}" not found among [${nodes.map((n) => n.fieldName).join(", ")}]`);
  return found;
}

describe("buildEntryFieldTree", () => {
  it("maps the user collection's scalar fields to columns, in field order plus system fields first", () => {
    const user = allTypes.find((t) => t.name === "user")!;
    const nodes = buildEntryFieldTree(user, allTypes);

    // `timestamps` is user's only feature - createdAt/updatedAt lead, then
    // the declared fields in their own order.
    expect(nodes.map((n) => n.fieldName)).toEqual(["createdAt", "updatedAt", "name", "email", "password", "roles"]);

    const name = byName(nodes, "name") as EntryColumnNode;
    expect(name.kind).toBe("column");
    expect(name.columnName).toBe("name");
    expect(name.fieldType).toBe("text");

    const password = byName(nodes, "password") as EntryColumnNode;
    expect(password.kind).toBe("column");
    expect(password.fieldType).toBe("password");
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
});

describe("flattenQueryableColumns", () => {
  it("lists only plain-column fields, excluding relation/component-repeat", () => {
    const user = allTypes.find((t) => t.name === "user")!;
    const nodes = buildEntryFieldTree(user, allTypes);
    const columns = flattenQueryableColumns(nodes);

    expect(columns.map((c) => c.fieldName)).toEqual(["createdAt", "updatedAt", "name", "email", "password"]);
    expect(columns.find((c) => c.fieldName === "name")?.columnName).toBe("name");
  });
});
