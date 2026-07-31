import { describe, expect, it } from "vitest";
import { validateContentTypeDefinition } from "./naming.js";
import {
  defaultContentTypeDefinitions,
  pendingSeedStatements,
} from "./seed.js";
import { resolveTableTree } from "./tree.js";
import type { ContentTypeDefinition } from "./types.js";

describe("defaultContentTypeDefinitions", () => {
  const defs = defaultContentTypeDefinitions();
  const byName = (name: string) => defs.find((t) => t.name === name)!;

  it("declares menuItem+seo (components), user, menu, aiKey, role, and permission (collections), none marked system", () => {
    expect(defs.map((t) => t.name).sort()).toEqual([
      "aiKey",
      "menu",
      "menuItem",
      "permission",
      "role",
      "seo",
      "user",
    ]);
    for (const def of defs) {
      expect(def.system).toBeFalsy();
    }
    expect(byName("menuItem").kind).toBe("component");
    expect(byName("seo").kind).toBe("component");
    expect(byName("user").kind).toBe("collection");
    expect(byName("menu").kind).toBe("collection");
    expect(byName("aiKey").kind).toBe("collection");
    expect(byName("role").kind).toBe("collection");
    expect(byName("permission").kind).toBe("collection");
  });

  it("gives every type and field a stable, unique id", () => {
    const typeIds = defs.map((t) => t.id);
    expect(new Set(typeIds).size).toBe(typeIds.length);
    const fieldIds = defs.flatMap((t) => t.fields.map((f) => f.id));
    expect(new Set(fieldIds).size).toBe(fieldIds.length);
  });

  it("passes validateContentTypeDefinition against the rest of the default set", () => {
    for (const def of defs) {
      expect(() =>
        validateContentTypeDefinition(
          def,
          defs.filter((t) => t.id !== def.id),
        ),
      ).not.toThrow();
    }
  });

  it("user: name, unique+required email, required password, timestamps on, a manyToMany roles relation", () => {
    const user = byName("user");
    const role = byName("role");
    expect(user.features?.timestamps).toBe(true);
    const email = user.fields.find((f) => f.name === "email")!;
    expect(email.validation).toMatchObject({
      required: true,
      unique: true,
      format: "email",
    });
    const password = user.fields.find((f) => f.name === "password")!;
    expect(password.type).toBe("password");
    expect(password.validation.required).toBe(true);
    const roles = user.fields.find((f) => f.name === "roles")!;
    expect(roles.type).toBe("relation");
    expect(roles.config).toMatchObject({
      target: role.id,
      cardinality: "manyToMany",
    });
  });

  it("role: unique+required name, isSuperAdmin boolean, a manyToMany permissions relation", () => {
    const role = byName("role");
    const permission = byName("permission");
    const name = role.fields.find((f) => f.name === "name")!;
    expect(name.validation).toMatchObject({ required: true, unique: true });
    const isSuperAdmin = role.fields.find((f) => f.name === "isSuperAdmin")!;
    expect(isSuperAdmin.type).toBe("boolean");
    expect(isSuperAdmin.default).toBe(false);
    const permissions = role.fields.find((f) => f.name === "permissions")!;
    expect(permissions.type).toBe("relation");
    expect(permissions.config).toMatchObject({
      target: permission.id,
      cardinality: "manyToMany",
    });
  });

  it("permission: required (non-unique) name and idTable, a required action select", () => {
    const permission = byName("permission");
    const name = permission.fields.find((f) => f.name === "name")!;
    expect(name.validation).toMatchObject({ required: true });
    expect(name.validation.unique).toBeFalsy();
    const idTable = permission.fields.find((f) => f.name === "idTable")!;
    expect(idTable.type).toBe("text");
    expect(idTable.validation).toMatchObject({ required: true });
    expect(idTable.validation.unique).toBeFalsy();
    const action = permission.fields.find((f) => f.name === "action")!;
    expect(action.type).toBe("select");
    expect(action.config).toMatchObject({
      options: ["create", "read", "edit", "delete"],
      multiple: false,
    });
    expect(action.validation).toMatchObject({ required: true });
  });

  it("resolves role's permissions relation to a 'role_permissions' child table, and user's roles relation to a 'user_roles' child table", () => {
    const role = byName("role");
    const user = byName("user");
    const roleTree = resolveTableTree(role, defs);
    expect(
      roleTree.children.find((c) => c.tableName === "role_permissions"),
    ).toBeDefined();
    const userTree = resolveTableTree(user, defs);
    expect(
      userTree.children.find((c) => c.tableName === "user_roles"),
    ).toBeDefined();
  });

  it("menu: unique+required name, a repeatable menuItem 'refs' field, timestamps on", () => {
    const menu = byName("menu");
    const menuItem = byName("menuItem");
    expect(menu.features?.timestamps).toBe(true);
    const name = menu.fields.find((f) => f.name === "name")!;
    expect(name.validation).toMatchObject({ required: true, unique: true });
    const refs = menu.fields.find((f) => f.name === "refs")!;
    expect(refs.type).toBe("component");
    expect(refs.config).toMatchObject({
      componentId: menuItem.id,
      repeatable: true,
      sortable: true,
    });
  });

  it("aiKey: required name/provider/key, optional description/url", () => {
    const aiKey = byName("aiKey");
    const provider = aiKey.fields.find((f) => f.name === "provider")!;
    expect(provider.type).toBe("select");
    expect(provider.config).toMatchObject({
      options: ["Google", "Anthropic", "ChatGPT", "Custom"],
    });
    expect(provider.validation.required).toBe(true);
    const key = aiKey.fields.find((f) => f.name === "key")!;
    expect(key.type).toBe("secretkey");
    expect(key.validation.required).toBe(true);
    const description = aiKey.fields.find((f) => f.name === "description")!;
    expect(description.validation.required).toBeFalsy();
    const url = aiKey.fields.find((f) => f.name === "url")!;
    expect(url.validation).toMatchObject({ format: "url" });
    expect(url.validation.required).toBeFalsy();
  });

  it("resolves to a 'menu_refs' child table carrying menuItem's fields", () => {
    const menu = byName("menu");
    const tree = resolveTableTree(menu, defs);
    expect(tree.tableName).toBe("menu");
    expect(tree.columns.map((c) => c.name)).toContain("name");

    const child = tree.children.find((c) => c.tableName === "menu_refs");
    expect(child).toBeDefined();
    expect(child!.kind).toBe("component-repeat");
    expect(child!.node.columns.map((c) => c.name)).toEqual(
      expect.arrayContaining(["label", "description", "href"]),
    );
  });

  it("seo: Title/Description/Image, none required (a page can opt out of any of them)", () => {
    const seo = byName("seo");
    expect(seo.fields.map((f) => f.name).sort()).toEqual([
      "description",
      "image",
      "metaTitle",
    ]);
    const image = seo.fields.find((f) => f.name === "image")!;
    expect(image.type).toBe("image");
  });

  it("a collection with features.seo on flattens seo's fields as seo_*", () => {
    const withSeo: ContentTypeDefinition = {
      id: "t1",
      kind: "collection",
      name: "posts",
      label: "Posts",
      features: { seo: true },
      fields: [],
      version: 0,
    };
    const tree = resolveTableTree(withSeo, [withSeo, ...defs]);
    expect(tree.columns.map((c) => c.name)).toEqual(
      expect.arrayContaining(["seo_metaTitle", "seo_description", "seo_image"]),
    );
  });
});

describe("pendingSeedStatements", () => {
  it("creates the user/menu/menu_refs/aiKey/role/permission/role_permissions/user_roles tables plus 7 metadata rows when nothing exists yet", () => {
    const statements = pendingSeedStatements(new Set());
    const sql = statements.map((s) => s.sql).join("\n");
    expect(sql).toContain('CREATE TABLE "user"');
    expect(sql).toContain('CREATE TABLE "menu"');
    expect(sql).toContain('CREATE TABLE "menu_refs"');
    expect(sql).toContain('CREATE TABLE "aiKey"');
    expect(sql).toContain('CREATE TABLE "role"');
    expect(sql).toContain('CREATE TABLE "permission"');
    expect(sql).toContain('CREATE TABLE "role_permissions"');
    expect(sql).toContain('CREATE TABLE "user_roles"');
    // `seo`, like `menuItem`, is a component - no table of its own.
    expect(sql).not.toContain('CREATE TABLE "seo"');

    const metadataInserts = statements.filter((s) =>
      s.sql.startsWith('INSERT INTO "metadata"'),
    );
    expect(metadataInserts).toHaveLength(7);
  });

  it("seeds nothing once every default name is already present", () => {
    const statements = pendingSeedStatements(
      new Set([
        "user",
        "menu",
        "menuitem",
        "seo",
        "aiKey",
        "role",
        "permission",
      ]),
    );
    expect(statements).toEqual([]);
  });

  it("only seeds the missing ones, but still resolves menu's embedded menuItem component", () => {
    const statements = pendingSeedStatements(new Set(["user"]));
    const sql = statements.map((s) => s.sql).join("\n");
    expect(sql).not.toContain('CREATE TABLE "user"');
    expect(sql).toContain('CREATE TABLE "menu"');
    expect(sql).toContain('CREATE TABLE "menu_refs"');
    expect(sql).toContain('CREATE TABLE "aiKey"');
    expect(sql).toContain('CREATE TABLE "role"');
    expect(sql).toContain('CREATE TABLE "permission"');

    const metadataInserts = statements.filter((s) =>
      s.sql.startsWith('INSERT INTO "metadata"'),
    );
    expect(metadataInserts).toHaveLength(6);
  });
});
