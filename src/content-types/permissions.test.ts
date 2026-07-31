import { describe, expect, it } from "vitest";
import { permissionActionsFor, permissionDeleteStatements, permissionSyncStatements } from "./permissions.js";
import type { ContentTypeDefinition } from "./types.js";

function collection(overrides: Partial<ContentTypeDefinition> = {}): ContentTypeDefinition {
  return { id: "c1", kind: "collection", name: "posts", label: "Posts", fields: [], version: 0, ...overrides };
}

function singleton(overrides: Partial<ContentTypeDefinition> = {}): ContentTypeDefinition {
  return { id: "s1", kind: "singleton", name: "site", label: "Site", fields: [], version: 0, ...overrides };
}

function component(overrides: Partial<ContentTypeDefinition> = {}): ContentTypeDefinition {
  return { id: "comp1", kind: "component", name: "seo", label: "SEO", fields: [], version: 0, ...overrides };
}

describe("permissionActionsFor", () => {
  it("gives a plain collection 4 actions, no publish", () => {
    expect(permissionActionsFor(collection())).toEqual(["view", "create", "update", "delete"]);
  });

  it("adds publish only when the collection has features.draft on", () => {
    expect(permissionActionsFor(collection({ features: { draft: true } }))).toEqual([
      "view",
      "create",
      "update",
      "delete",
      "publish",
    ]);
    expect(permissionActionsFor(collection({ features: { draft: false } }))).toEqual([
      "view",
      "create",
      "update",
      "delete",
    ]);
  });

  it("gives a singleton exactly one action: setting", () => {
    expect(permissionActionsFor(singleton())).toEqual(["setting"]);
  });

  it("gives a component no actions at all", () => {
    expect(permissionActionsFor(component())).toEqual([]);
  });
});

describe("permissionSyncStatements", () => {
  it("returns nothing for a component", () => {
    expect(permissionSyncStatements(component())).toEqual([]);
  });

  it("deletes stale actions then upserts the expected set, for a plain collection", () => {
    const statements = permissionSyncStatements(collection());
    expect(statements[0]!.sql).toContain("DELETE FROM");
    expect(statements[0]!.sql).toContain("NOT IN");
    expect(statements[0]!.params).toEqual(["c1", "view", "create", "update", "delete"]);
    expect(statements).toHaveLength(1 + 4);
    expect(statements.slice(1).map((s) => s.params![2])).toEqual(["view", "create", "update", "delete"]);
  });

  it("upserts a single 'setting' row for a singleton", () => {
    const statements = permissionSyncStatements(singleton());
    expect(statements).toHaveLength(2);
    expect(statements[1]!.params).toEqual(["site", "s1", "setting"]);
  });
});

describe("permissionDeleteStatements", () => {
  it("returns nothing for a component", () => {
    expect(permissionDeleteStatements(component())).toEqual([]);
  });

  it("clears every row for the deleted resource's idTable", () => {
    const statements = permissionDeleteStatements(collection());
    expect(statements).toHaveLength(1);
    expect(statements[0]!.params).toEqual(["c1"]);
  });
});
