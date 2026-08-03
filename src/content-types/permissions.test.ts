import { describe, expect, it } from "vitest";
import { permissionActionsFor, permissionKeyFor } from "./permissions.js";
import type { ContentTypeDefinition } from "./types.js";

const type = (kind: ContentTypeDefinition["kind"], features?: ContentTypeDefinition["features"]): ContentTypeDefinition => ({
  id: "type-1",
  kind,
  name: "posts",
  label: "Posts",
  fields: [],
  features,
  version: 0,
});

describe("permission metadata", () => {
  it("derives collection and singleton actions from metadata", () => {
    expect(permissionActionsFor(type("collection"))).toEqual(["view", "create", "update", "delete"]);
    expect(permissionActionsFor(type("collection", { draft: true }))).toEqual([
      "view",
      "create",
      "update",
      "delete",
    ]);
    expect(permissionActionsFor(type("singleton"))).toEqual(["setting"]);
    expect(permissionActionsFor(type("component"))).toEqual([]);
  });

  it("uses a stable content-type/action key instead of a permission row id", () => {
    expect(permissionKeyFor("posts", "view")).toBe("posts:view");
    expect(permissionKeyFor("site-settings", "setting")).toBe("site-settings:setting");
  });
});
