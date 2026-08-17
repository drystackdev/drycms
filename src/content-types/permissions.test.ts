import { describe, expect, it } from "vitest";
import { permissionActionsFor, permissionKeyFor, supportsMagic } from "./permissions.js";
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

const named = (kind: ContentTypeDefinition["kind"], name: string): ContentTypeDefinition => ({
  ...type(kind),
  id: `system-${name}`,
  name,
  label: name,
});

describe("permission metadata", () => {
  it("derives collection and singleton actions from metadata", () => {
    expect(permissionActionsFor(type("collection"))).toEqual(["view", "create", "update", "delete", "magic"]);
    expect(permissionActionsFor(type("collection", { draft: true }))).toEqual([
      "view",
      "create",
      "update",
      "delete",
      "magic",
    ]);
    expect(permissionActionsFor(type("singleton"))).toEqual(["setting", "magic"]);
    expect(permissionActionsFor(type("component"))).toEqual([]);
  });

  it("drops the magic action for configuration resources", () => {
    for (const name of ["aiKey", "role", "user", "redirect", "menu"]) {
      expect(supportsMagic(named("collection", name))).toBe(false);
      expect(permissionActionsFor(named("collection", name))).toEqual(["view", "create", "update", "delete"]);
    }
    for (const name of ["systemSettings", "siteSettings", "githubSync"]) {
      expect(supportsMagic(named("singleton", name))).toBe(false);
      expect(permissionActionsFor(named("singleton", name))).toEqual(["setting"]);
    }
    // Editorial types keep it, `seoDefaults` included - it holds real
    // meta title/description copy.
    expect(supportsMagic(named("singleton", "seoDefaults"))).toBe(true);
    expect(supportsMagic(named("collection", "blog"))).toBe(true);
    expect(supportsMagic(named("component", "hero"))).toBe(false);
  });

  it("grants nothing at all on the server-managed memory collection", () => {
    expect(permissionActionsFor(named("collection", "memory"))).toEqual([]);
    expect(supportsMagic(named("collection", "memory"))).toBe(false);
  });

  it("uses a stable content-type/action key instead of a permission row id", () => {
    expect(permissionKeyFor("posts", "view")).toBe("posts:view");
    expect(permissionKeyFor("site-settings", "setting")).toBe("site-settings:setting");
  });
});
