import { describe, expect, it } from "vitest";
import type { EntryValue } from "./engine/entry-codec.js";
import type { ContentEntryEngineAdapter, EntryRow } from "./engine/entries-types.js";
import { validateContentTypeDefinition } from "./naming.js";
import {
  applyPackagedSingletonData,
  defaultContentTypeDefinitions,
  pendingSeedStatements,
  resolveDefaultContentTypeDefinitions,
} from "./seed.js";
import { SEO_DEFAULTS_TYPE_ID } from "./system-fields.js";
import { resolveTableTree } from "./tree.js";
import type { ContentTypeDefinition } from "./types.js";

describe("defaultContentTypeDefinitions", () => {
  const defs = defaultContentTypeDefinitions();
  const byName = (name: string) => defs.find((t) => t.name === name)!;

  it("declares menuItem+seo (components), user, menu, aiKey, role, redirect, memory (collections), and seoDefaults, systemSettings (singletons)", () => {
    expect(defs.map((t) => t.name).sort()).toEqual([
      "aiKey",
      "memory",
      "menu",
      "menuItem",
      "redirect",
      "role",
      "seo",
      "seoDefaults",
      "systemSettings",
      "user",
    ]);
    expect(byName("menuItem").kind).toBe("component");
    expect(byName("seo").kind).toBe("component");
    expect(byName("user").kind).toBe("collection");
    expect(byName("menu").kind).toBe("collection");
    expect(byName("aiKey").kind).toBe("collection");
    expect(byName("role").kind).toBe("collection");
    expect(byName("redirect").kind).toBe("collection");
    expect(byName("memory").kind).toBe("collection");
    expect(byName("seoDefaults").kind).toBe("singleton");
    expect(byName("systemSettings").kind).toBe("singleton");
  });

  it("hides role/aiKey/redirect/seo/user/seoDefaults/memory/systemSettings from the generic content-type UI, but leaves menu/menuItem visible", () => {
    expect(byName("role").hidden).toBe(true);
    expect(byName("aiKey").hidden).toBe(true);
    expect(byName("redirect").hidden).toBe(true);
    expect(byName("seo").hidden).toBe(true);
    // `user`/`seoDefaults` moved to their own pinned System nav entry
    // instead of the generic Collection/Singleton group - still ordinary,
    // freely editable content otherwise (see the `frozen` test below).
    expect(byName("user").hidden).toBe(true);
    expect(byName("seoDefaults").hidden).toBe(true);
    // `memory`/`systemSettings` have no nav entry at all (see their own
    // `frozen`/`locked` test) - `hidden` here is necessary but not
    // sufficient for that; the route layer is what actually keeps them
    // inaccessible.
    expect(byName("memory").hidden).toBe(true);
    expect(byName("systemSettings").hidden).toBe(true);
    expect(byName("menu").hidden).toBeFalsy();
    expect(byName("menuItem").hidden).toBeFalsy();
  });

  it("freezes role/aiKey/redirect/memory/systemSettings' schema entirely, but leaves seo's, user's, and seoDefaults' editable", () => {
    expect(byName("role").frozen).toBe(true);
    expect(byName("aiKey").frozen).toBe(true);
    expect(byName("redirect").frozen).toBe(true);
    expect(byName("memory").frozen).toBe(true);
    expect(byName("systemSettings").frozen).toBe(true);
    expect(byName("seo").frozen).toBeFalsy();
    expect(byName("user").frozen).toBeFalsy();
    expect(byName("seoDefaults").frozen).toBeFalsy();
  });

  it("locks user/seo/role/aiKey/redirect/memory/seoDefaults/systemSettings' tables against deletion, but leaves menu/menuItem deletable", () => {
    expect(byName("user").locked).toBe(true);
    expect(byName("seo").locked).toBe(true);
    expect(byName("role").locked).toBe(true);
    expect(byName("aiKey").locked).toBe(true);
    expect(byName("redirect").locked).toBe(true);
    expect(byName("memory").locked).toBe(true);
    expect(byName("seoDefaults").locked).toBe(true);
    expect(byName("systemSettings").locked).toBe(true);
    expect(byName("menu").locked).toBeFalsy();
    expect(byName("menuItem").locked).toBeFalsy();
  });

  it("memory: required manyToOne user relation, a text data blob, a required numeric version", () => {
    const memory = byName("memory");
    const user = byName("user");
    const relation = memory.fields.find((f) => f.name === "user")!;
    expect(relation.type).toBe("relation");
    expect(relation.config).toMatchObject({ target: user.id, cardinality: "manyToOne" });
    expect(relation.validation.required).toBe(true);
    const data = memory.fields.find((f) => f.name === "data")!;
    expect(data.type).toBe("text");
    const version = memory.fields.find((f) => f.name === "version")!;
    expect(version.type).toBe("number");
    expect(version.validation.required).toBe(true);
    expect(version.default).toBe(0);
  });

  it("systemSettings: one JSON blob field, not per-setting columns (nothing here is ever queried/filtered - same reasoning memory.data uses)", () => {
    const systemSettings = byName("systemSettings");
    expect(systemSettings.fields).toHaveLength(1);
    const data = systemSettings.fields[0]!;
    expect(data.name).toBe("data");
    expect(data.type).toBe("text");
  });

  it("seoDefaults is recognized by its fixed id, has features.seo on, and only the built-in Google site-verification file field", () => {
    const seoDefaults = byName("seoDefaults");
    expect(seoDefaults.id).toBe(SEO_DEFAULTS_TYPE_ID);
    expect(seoDefaults.features?.seo).toBe(true);
    expect(seoDefaults.fields.map((f) => f.name)).toEqual(["googleSiteVerificationFile"]);
  });

  it("protects user's email/password/roles fields specifically, and nothing else", () => {
    const user = byName("user");
    const protectedNames = (user.protectedFieldIds ?? [])
      .map((id) => user.fields.find((f) => f.id === id)?.name)
      .sort();
    expect(protectedNames).toEqual(["email", "password", "roles"]);
    expect(user.fields.find((f) => f.name === "name")).toBeDefined();
    expect(user.protectedFieldIds).not.toContain(
      user.fields.find((f) => f.name === "name")!.id,
    );
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

  it("role: unique+required name, a description, isSuperAdmin boolean, and metadata permission keys", () => {
    const role = byName("role");
    const name = role.fields.find((f) => f.name === "name")!;
    expect(name.validation).toMatchObject({ required: true, unique: true });
    const description = role.fields.find((f) => f.name === "description")!;
    expect(description.type).toBe("text");
    const isSuperAdmin = role.fields.find((f) => f.name === "isSuperAdmin")!;
    expect(isSuperAdmin.type).toBe("boolean");
    expect(isSuperAdmin.default).toBe(false);
    const permissions = role.fields.find((f) => f.name === "permissions")!;
    expect(permissions.type).toBe("select");
    expect(permissions.config).toMatchObject({
      options: [],
      multiple: true,
    });
  });

  it("resolves only user's roles relation to a child table", () => {
    const role = byName("role");
    const user = byName("user");
    const roleTree = resolveTableTree(role, defs);
    expect(roleTree.children).toHaveLength(0);
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

  it("redirect: unique+required from, required to", () => {
    const redirect = byName("redirect");
    const from = redirect.fields.find((f) => f.name === "from")!;
    expect(from.type).toBe("text");
    expect(from.validation).toMatchObject({ required: true, unique: true });
    const to = redirect.fields.find((f) => f.name === "to")!;
    expect(to.type).toBe("text");
    expect(to.validation).toMatchObject({ required: true });
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

  it("seo: Title/Description/Image/noIndex, none required (a page can opt out of any of them)", () => {
    const seo = byName("seo");
    expect(seo.fields.map((f) => f.name).sort()).toEqual([
      "description",
      "image",
      "metaTitle",
      "noIndex",
    ]);
    const image = seo.fields.find((f) => f.name === "image")!;
    expect(image.type).toBe("image");
    const noIndex = seo.fields.find((f) => f.name === "noIndex")!;
    expect(noIndex.type).toBe("boolean");
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

describe("resolveDefaultContentTypeDefinitions", () => {
  it("falls back to the built-in defaults when no packaged seed is given", () => {
    const resolved = resolveDefaultContentTypeDefinitions(undefined);
    expect(resolved.map((t) => t.name).sort()).toEqual(
      defaultContentTypeDefinitions().map((t) => t.name).sort(),
    );
  });

  it("uses the packaged app seed instead of the built-in defaults when present", () => {
    const appType: ContentTypeDefinition = {
      id: "app-post",
      kind: "collection",
      name: "post",
      label: "Post",
      fields: [],
      version: 0,
    };
    const resolved = resolveDefaultContentTypeDefinitions({ contentTypes: [appType] });
    expect(resolved).toEqual([appType]);
    // Completely replaces the built-in list - `user`/`role`/etc. are NOT
    // silently unioned in, matching decision #4 in plans/content-type-seed.md.
    expect(resolved.find((t) => t.name === "user")).toBeUndefined();
  });
});

describe("pendingSeedStatements", () => {
  it("creates the user/menu/menu_refs/aiKey/role/redirect/user_roles/memory/seoDefaults/systemSettings tables plus 10 metadata rows when nothing exists yet", () => {
    const statements = pendingSeedStatements(new Set());
    const sql = statements.map((s) => s.sql).join("\n");
    expect(sql).toContain('CREATE TABLE "user"');
    expect(sql).toContain('CREATE TABLE "menu"');
    expect(sql).toContain('CREATE TABLE "menu_refs"');
    expect(sql).toContain('CREATE TABLE "aiKey"');
    expect(sql).toContain('CREATE TABLE "role"');
    expect(sql).toContain('CREATE TABLE "redirect"');
    expect(sql).toContain('CREATE TABLE "user_roles"');
    expect(sql).toContain('CREATE TABLE "memory"');
    expect(sql).toContain('CREATE TABLE "seoDefaults"');
    expect(sql).toContain('CREATE TABLE "systemSettings"');
    // `seo`, like `menuItem`, is a component - no table of its own.
    expect(sql).not.toContain('CREATE TABLE "seo"');

    const metadataInserts = statements.filter((s) =>
      s.sql.startsWith('INSERT INTO "metadata"'),
    );
    expect(metadataInserts).toHaveLength(10);
  });

  it("seeds nothing once every default name is already present", () => {
    const statements = pendingSeedStatements(
      new Set([
        "user",
        "menu",
        "menuitem",
        "seo",
        "aikey",
        "role",
        "redirect",
        "memory",
        "seodefaults",
        "systemsettings",
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
    expect(sql).toContain('CREATE TABLE "redirect"');
    expect(sql).toContain('CREATE TABLE "memory"');
    expect(sql).toContain('CREATE TABLE "seoDefaults"');
    expect(sql).toContain('CREATE TABLE "systemSettings"');

    const metadataInserts = statements.filter((s) =>
      s.sql.startsWith('INSERT INTO "metadata"'),
    );
    expect(metadataInserts).toHaveLength(9);
  });
});

describe("applyPackagedSingletonData", () => {
  const singleton: ContentTypeDefinition = {
    id: "app-settings",
    kind: "singleton",
    name: "settings",
    label: "Settings",
    fields: [],
    version: 0,
  };
  const collection: ContentTypeDefinition = {
    id: "app-post",
    kind: "collection",
    name: "post",
    label: "Post",
    fields: [],
    version: 0,
  };
  const allTypes = [singleton, collection];

  function fakeAdapter(overrides: Partial<ContentEntryEngineAdapter>): ContentEntryEngineAdapter {
    const notImplemented = () => {
      throw new Error("not implemented in this fake");
    };
    return {
      listEntries: notImplemented,
      getEntry: notImplemented,
      findEntry: notImplemented,
      getRawEntry: notImplemented,
      createEntry: notImplemented,
      updateEntry: notImplemented,
      deleteEntry: notImplemented,
      reorderEntries: notImplemented,
      getSingletonEntry: notImplemented,
      saveSingletonEntry: notImplemented,
      ensureSingletonEntry: notImplemented,
      getResourceVersion: notImplemented,
      ...overrides,
    } as ContentEntryEngineAdapter;
  }

  it("no-ops when the packaged seed has no singletonData", async () => {
    const adapter = fakeAdapter({});
    await expect(
      applyPackagedSingletonData(adapter, allTypes, { contentTypes: allTypes }),
    ).resolves.toBeUndefined();
  });

  it("saves a singleton's packaged value when it has no row yet", async () => {
    const saved: { type: ContentTypeDefinition; value: EntryValue }[] = [];
    const adapter = fakeAdapter({
      getSingletonEntry: async () => null,
      saveSingletonEntry: async (type, _allTypes, value) => {
        saved.push({ type, value });
        return { id: 1, value } satisfies EntryRow;
      },
    });

    await applyPackagedSingletonData(adapter, allTypes, {
      contentTypes: allTypes,
      singletonData: { "app-settings": { siteName: "Acme" } },
    });

    expect(saved).toEqual([{ type: singleton, value: { siteName: "Acme" } }]);
  });

  it("skips a singleton that already has a row, even though it's in singletonData", async () => {
    let saveCalled = false;
    const adapter = fakeAdapter({
      getSingletonEntry: async () => ({ id: 1, value: { siteName: "Existing" } }),
      saveSingletonEntry: async () => {
        saveCalled = true;
        throw new Error("should not be called");
      },
    });

    await applyPackagedSingletonData(adapter, allTypes, {
      contentTypes: allTypes,
      singletonData: { "app-settings": { siteName: "Acme" } },
    });

    expect(saveCalled).toBe(false);
  });

  it("ignores collection/component types even if singletonData somehow carries their id", async () => {
    let saveCalled = false;
    const adapter = fakeAdapter({
      getSingletonEntry: async () => null,
      saveSingletonEntry: async () => {
        saveCalled = true;
        throw new Error("should not be called for a collection");
      },
    });

    await applyPackagedSingletonData(adapter, allTypes, {
      contentTypes: allTypes,
      singletonData: { "app-post": { title: "Hello" } },
    });

    expect(saveCalled).toBe(false);
  });
});
