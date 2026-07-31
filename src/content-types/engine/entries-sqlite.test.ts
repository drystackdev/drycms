import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ContentTypeDefinition } from "../types.js";
import type { MaskedValue } from "./entry-codec.js";
import { createSqliteContentEntryEngineAdapter } from "./entries-sqlite.js";
import { createSqliteContentEngineAdapter } from "./sqlite.js";

function freshAdapters() {
  const dir = mkdtempSync(join(tmpdir(), "drycms-entries-sqlite-test-"));
  const file = join(dir, "content.sqlite");
  const schema = createSqliteContentEngineAdapter({ engine: "sqlite", file });
  const entries = createSqliteContentEntryEngineAdapter({ engine: "sqlite", file });
  return { schema, entries, dir };
}

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("createSqliteContentEntryEngineAdapter", () => {
  it("creates, reads back, updates, and deletes a scalar+relation entry (user/role)", async () => {
    const { schema, entries, dir } = freshAdapters();
    dirs.push(dir);
    const allTypes = await schema.listContentTypes();
    const user = allTypes.find((t) => t.name === "user")!;
    const role = allTypes.find((t) => t.name === "role")!;

    const editorRole = await entries.createEntry(role, allTypes, { name: "Editor", isSuperAdmin: false, permissions: [] });

    const created = await entries.createEntry(user, allTypes, {
      name: "Ada",
      email: "ada@example.com",
      password: { hasExisting: false, new: "hunter2" } satisfies MaskedValue,
      roles: [editorRole.id],
    });
    expect(created.value.name).toBe("Ada");
    expect(created.value.password).toEqual({ hasExisting: true } satisfies MaskedValue);
    expect(created.value.roles).toEqual([editorRole.id]);

    const fetched = await entries.getEntry(user, allTypes, created.id);
    expect(fetched?.value.email).toBe("ada@example.com");
    expect(fetched?.value.roles).toEqual([editorRole.id]);

    const updated = await entries.updateEntry(user, allTypes, created.id, {
      name: "Ada Lovelace",
      email: "ada@example.com",
      password: { hasExisting: true } satisfies MaskedValue,
      roles: [],
    });
    expect(updated.value.name).toBe("Ada Lovelace");
    expect(updated.value.roles).toEqual([]);

    await entries.deleteEntry(user, allTypes, created.id);
    expect(await entries.getEntry(user, allTypes, created.id)).toBeNull();
  });

  it("getRawEntry returns the real password hash, unmasked - unlike getEntry", async () => {
    const { schema, entries, dir } = freshAdapters();
    dirs.push(dir);
    const allTypes = await schema.listContentTypes();
    const user = allTypes.find((t) => t.name === "user")!;

    const created = await entries.createEntry(user, allTypes, {
      name: "Ada",
      email: "ada@example.com",
      password: { hasExisting: false, new: "hunter2" } satisfies MaskedValue,
      roles: [],
    });

    const raw = await entries.getRawEntry(user, created.id);
    expect(typeof raw?.password).toBe("string");
    expect(raw?.password).not.toBe("hunter2"); // hashed, not plaintext
    expect(raw?.email).toBe("ada@example.com");

    expect(await entries.getRawEntry(user, -1)).toBeNull();
  });

  it("changes a password on update without requiring the current one (admin reset)", async () => {
    const { schema, entries, dir } = freshAdapters();
    dirs.push(dir);
    const allTypes = await schema.listContentTypes();
    const user = allTypes.find((t) => t.name === "user")!;

    const created = await entries.createEntry(user, allTypes, {
      name: "Ada",
      email: "ada@example.com",
      password: { hasExisting: false, new: "hunter2" } satisfies MaskedValue,
    });
    const originalHash = (await rawQuery<{ password: string }>(dir, `SELECT "password" FROM "user" WHERE "id" = ${created.id};`))[0]!.password;

    await entries.updateEntry(user, allTypes, created.id, {
      name: "Ada",
      email: "ada@example.com",
      password: { hasExisting: true, new: "new-password" } satisfies MaskedValue,
    });

    const newHash = (await rawQuery<{ password: string }>(dir, `SELECT "password" FROM "user" WHERE "id" = ${created.id};`))[0]!.password;
    expect(newHash).not.toBe(originalHash);
  });

  it("leaves the stored hash untouched when a password update leaves `new` blank", async () => {
    const { schema, entries, dir } = freshAdapters();
    dirs.push(dir);
    const allTypes = await schema.listContentTypes();
    const user = allTypes.find((t) => t.name === "user")!;

    const created = await entries.createEntry(user, allTypes, {
      name: "Ada",
      email: "ada@example.com",
      password: { hasExisting: false, new: "hunter2" } satisfies MaskedValue,
    });
    const originalHash = (await rawQuery<{ password: string }>(dir, `SELECT "password" FROM "user" WHERE "id" = ${created.id};`))[0]!.password;

    await entries.updateEntry(user, allTypes, created.id, {
      name: "Ada Lovelace",
      email: "ada@example.com",
      password: { hasExisting: true } satisfies MaskedValue,
    });

    const sameHash = (await rawQuery<{ password: string }>(dir, `SELECT "password" FROM "user" WHERE "id" = ${created.id};`))[0]!.password;
    expect(sameHash).toBe(originalHash);
  });

  it("rejects a duplicate unique field with a field-scoped error", async () => {
    const { schema, entries, dir } = freshAdapters();
    dirs.push(dir);
    const allTypes = await schema.listContentTypes();
    const user = allTypes.find((t) => t.name === "user")!;

    await entries.createEntry(user, allTypes, { name: "Ada", email: "dup@example.com", password: { hasExisting: false, new: "hunter2" } satisfies MaskedValue });
    await expect(
      entries.createEntry(user, allTypes, { name: "Grace", email: "dup@example.com", password: { hasExisting: false, new: "hunter2" } satisfies MaskedValue }),
    ).rejects.toMatchObject({ name: "ContentEntryError", code: "validation_failed", fieldErrors: { email: expect.any(String) } });
  });

  it("rejects a missing required field with a field-scoped error", async () => {
    const { schema, entries, dir } = freshAdapters();
    dirs.push(dir);
    const allTypes = await schema.listContentTypes();
    const user = allTypes.find((t) => t.name === "user")!;

    await expect(entries.createEntry(user, allTypes, { name: "", email: "a@b.com", password: { hasExisting: false, new: "x" } satisfies MaskedValue })).rejects.toMatchObject({
      name: "ContentEntryError",
      code: "validation_failed",
      fieldErrors: { name: expect.any(String) },
    });
  });

  it("stores and orders a repeatable component field's items, and deletes them with the parent", async () => {
    const { schema, entries, dir } = freshAdapters();
    dirs.push(dir);
    const allTypes = await schema.listContentTypes();
    const menu = allTypes.find((t) => t.name === "menu")!;

    const created = await entries.createEntry(menu, allTypes, {
      name: "Main nav",
      refs: [
        { label: "Home", description: "", href: "https://example.com/" },
        { label: "About", description: "", href: "https://example.com/about" },
      ],
    });
    expect(created.value.refs).toEqual([
      { label: "Home", description: null, href: "https://example.com/" },
      { label: "About", description: null, href: "https://example.com/about" },
    ]);

    const updated = await entries.updateEntry(menu, allTypes, created.id, {
      name: "Main nav",
      refs: [{ label: "Only", description: "", href: "https://example.com/only" }],
    });
    expect(updated.value.refs).toEqual([{ label: "Only", description: null, href: "https://example.com/only" }]);

    await entries.deleteEntry(menu, allTypes, created.id);
    const childRows = await rawQuery(dir, `SELECT * FROM "menu_refs" WHERE "parent_id" = ${created.id};`);
    expect(childRows).toEqual([]);
  });

  it("lists entries with search, sort, and pagination", async () => {
    const { schema, entries, dir } = freshAdapters();
    dirs.push(dir);
    const allTypes = await schema.listContentTypes();
    const user = allTypes.find((t) => t.name === "user")!;

    await entries.createEntry(user, allTypes, { name: "Ada", email: "ada@example.com", password: { hasExisting: false, new: "x" } satisfies MaskedValue });
    await entries.createEntry(user, allTypes, { name: "Grace", email: "grace@example.com", password: { hasExisting: false, new: "x" } satisfies MaskedValue });
    await entries.createEntry(user, allTypes, { name: "Alan", email: "alan@example.com", password: { hasExisting: false, new: "x" } satisfies MaskedValue });

    const all = await entries.listEntries(user, allTypes, { page: 0, pageSize: 10 });
    expect(all.total).toBe(3);

    const searched = await entries.listEntries(user, allTypes, {
      page: 0,
      pageSize: 10,
      search: "ada",
      searchableFields: ["name", "email"],
    });
    expect(searched.total).toBe(1);
    expect(searched.rows[0]?.value.name).toBe("Ada");

    const sorted = await entries.listEntries(user, allTypes, {
      page: 0,
      pageSize: 10,
      sortField: "name",
      sortDir: "asc",
    });
    expect(sorted.rows.map((r) => r.value.name)).toEqual(["Ada", "Alan", "Grace"]);

    const paged = await entries.listEntries(user, allTypes, {
      page: 1,
      pageSize: 2,
      sortField: "name",
      sortDir: "asc",
    });
    expect(paged.rows.map((r) => r.value.name)).toEqual(["Grace"]);
  });

  it("reads and writes back an auto-generated relationmirror field reflecting a manyToMany relation (role.user mirrors user.roles)", async () => {
    const { schema, entries, dir } = freshAdapters();
    dirs.push(dir);
    const allTypes = await schema.listContentTypes();
    const user = allTypes.find((t) => t.name === "user")!;
    // No manual schema edit needed - `role` automatically gets a `user`
    // relationmirror field the moment `user.roles` (a real relation
    // targeting `role`) exists, which the seed already provides. See
    // `system-fields.ts`'s `relationMirrorFieldsFor`.
    const roleType = allTypes.find((t) => t.name === "role")!;

    const editor = await entries.createEntry(roleType, allTypes, { name: "Editor", isSuperAdmin: false, permissions: [] });
    const ada = await entries.createEntry(user, allTypes, { name: "Ada", email: "ada@example.com", password: { hasExisting: false, new: "x" } satisfies MaskedValue, roles: [editor.id] });
    const grace = await entries.createEntry(user, allTypes, { name: "Grace", email: "grace@example.com", password: { hasExisting: false, new: "x" } satisfies MaskedValue, roles: [editor.id] });

    // Isolation fixture: an unrelated role/user pair that must survive
    // editor's mirror write untouched.
    const unrelatedRole = await entries.createEntry(roleType, allTypes, { name: "Unrelated", isSuperAdmin: false, permissions: [] });
    const unrelatedUser = await entries.createEntry(user, allTypes, {
      name: "Zoe",
      email: "zoe@example.com",
      password: { hasExisting: false, new: "x" } satisfies MaskedValue,
      roles: [unrelatedRole.id],
    });

    const editorEntry = await entries.getEntry(roleType, allTypes, editor.id);
    expect(editorEntry?.value.user).toEqual([ada.id, grace.id]);

    // Editing the mirror field (dropping grace) must write back through to
    // user_roles: grace's link to editor is removed, ada's survives.
    await entries.updateEntry(roleType, allTypes, editor.id, {
      name: "Editor",
      isSuperAdmin: false,
      permissions: [],
      user: [ada.id],
    });

    expect((await entries.getEntry(roleType, allTypes, editor.id))?.value.user).toEqual([ada.id]);
    expect((await entries.getEntry(user, allTypes, ada.id))?.value.roles).toEqual([editor.id]);
    expect((await entries.getEntry(user, allTypes, grace.id))?.value.roles).toEqual([]);
    // Isolation: unrelated role/user pair untouched by editor's mirror write.
    expect((await entries.getEntry(roleType, allTypes, unrelatedRole.id))?.value.user).toEqual([unrelatedUser.id]);
    expect((await entries.getEntry(user, allTypes, unrelatedUser.id))?.value.roles).toEqual([unrelatedRole.id]);
  });

  it("reads and writes back an auto-generated relationmirror field reflecting a manyToOne relation (project.team mirrors team.project)", async () => {
    const { schema, entries, dir } = freshAdapters();
    dirs.push(dir);

    const project: ContentTypeDefinition = {
      id: "custom-project",
      kind: "collection",
      name: "project",
      label: "Project",
      fields: [],
      version: 0,
    };
    await schema.applySave(project, await schema.planSave(project));

    let allTypes = await schema.listContentTypes();
    const projectType = allTypes.find((t) => t.name === "project")!;
    const team: ContentTypeDefinition = {
      id: "custom-team",
      kind: "collection",
      name: "team",
      label: "Team",
      fields: [
        {
          id: "f-team-project",
          name: "project",
          label: "Project",
          type: "relation",
          config: { target: projectType.id, cardinality: "manyToOne" },
          validation: {},
          order: 0,
        },
      ],
      version: 0,
    };
    // No manual mirror field needed on `project` - saving `team.project`
    // (a real relation targeting it) is enough for `project` to auto-gain a
    // `team` relationmirror field, per `system-fields.ts`'s
    // `relationMirrorFieldsFor`.
    await schema.applySave(team, await schema.planSave(team));

    allTypes = await schema.listContentTypes();
    const finalProjectType = allTypes.find((t) => t.name === "project")!;
    const finalTeamType = allTypes.find((t) => t.name === "team")!;

    const alpha = await entries.createEntry(finalProjectType, allTypes, { team: [] });
    const beta = await entries.createEntry(finalProjectType, allTypes, { team: [] });
    const frontend = await entries.createEntry(finalTeamType, allTypes, { project: alpha.id });
    const backend = await entries.createEntry(finalTeamType, allTypes, { project: alpha.id });
    // Isolation fixture: a team already on the OTHER project.
    const platform = await entries.createEntry(finalTeamType, allTypes, { project: beta.id });

    expect((await entries.getEntry(finalProjectType, allTypes, alpha.id))?.value.team).toEqual([frontend.id, backend.id]);

    // Drop backend, keep frontend - backend.project must be nulled out,
    // frontend.project left alone, and beta/platform (unrelated) untouched.
    await entries.updateEntry(finalProjectType, allTypes, alpha.id, { team: [frontend.id] });

    expect((await entries.getEntry(finalProjectType, allTypes, alpha.id))?.value.team).toEqual([frontend.id]);
    expect((await entries.getEntry(finalTeamType, allTypes, frontend.id))?.value.project).toBe(alpha.id);
    expect((await entries.getEntry(finalTeamType, allTypes, backend.id))?.value.project).toBeNull();
    expect((await entries.getEntry(finalProjectType, allTypes, beta.id))?.value.team).toEqual([platform.id]);
    expect((await entries.getEntry(finalTeamType, allTypes, platform.id))?.value.project).toBe(beta.id);
  });

  it("reads and writes back an auto-generated relationmirror field reflecting a oneToMany relation (product.cart mirrors cart.items)", async () => {
    const { schema, entries, dir } = freshAdapters();
    dirs.push(dir);

    const product: ContentTypeDefinition = {
      id: "custom-product",
      kind: "collection",
      name: "product",
      label: "Product",
      fields: [],
      version: 0,
    };
    await schema.applySave(product, await schema.planSave(product));

    let allTypes = await schema.listContentTypes();
    const productType = allTypes.find((t) => t.name === "product")!;
    const cart: ContentTypeDefinition = {
      id: "custom-cart",
      kind: "collection",
      name: "cart",
      label: "Cart",
      fields: [
        {
          id: "f-cart-items",
          name: "items",
          label: "Items",
          type: "relation",
          config: { target: productType.id, cardinality: "oneToMany" },
          validation: {},
          order: 0,
        },
      ],
      version: 0,
    };
    // No manual mirror field needed on `product` - saving `cart.items` (a
    // real relation targeting it) is enough for `product` to auto-gain a
    // `cart` relationmirror field, per `system-fields.ts`'s
    // `relationMirrorFieldsFor`.
    await schema.applySave(cart, await schema.planSave(cart));

    allTypes = await schema.listContentTypes();
    const finalProductType = allTypes.find((t) => t.name === "product")!;
    const finalCartType = allTypes.find((t) => t.name === "cart")!;

    const cartA = await entries.createEntry(finalCartType, allTypes, { items: [] });
    const cartB = await entries.createEntry(finalCartType, allTypes, { items: [] });
    const widget = await entries.createEntry(finalProductType, allTypes, { cart: null });
    // Isolation fixture: a product already claimed by the OTHER cart.
    const gadget = await entries.createEntry(finalProductType, allTypes, { cart: cartB.id });

    expect((await entries.getEntry(finalCartType, allTypes, cartB.id))?.value.items).toEqual([gadget.id]);

    // Claim widget for cartA through its mirror field.
    await entries.updateEntry(finalProductType, allTypes, widget.id, { cart: cartA.id });
    expect((await entries.getEntry(finalCartType, allTypes, cartA.id))?.value.items).toEqual([widget.id]);
    expect((await entries.getEntry(finalProductType, allTypes, widget.id))?.value.cart).toBe(cartA.id);
    // Isolation: cartB/gadget's link untouched.
    expect((await entries.getEntry(finalCartType, allTypes, cartB.id))?.value.items).toEqual([gadget.id]);
    expect((await entries.getEntry(finalProductType, allTypes, gadget.id))?.value.cart).toBe(cartB.id);

    // Release widget's claim entirely.
    await entries.updateEntry(finalProductType, allTypes, widget.id, { cart: null });
    expect((await entries.getEntry(finalCartType, allTypes, cartA.id))?.value.items).toEqual([]);
    expect((await entries.getEntry(finalProductType, allTypes, widget.id))?.value.cart).toBeNull();
  });

  it("getSingletonEntry/saveSingletonEntry upsert the one row a singleton has", async () => {
    const { schema, entries, dir } = freshAdapters();
    dirs.push(dir);

    const siteSettings: ContentTypeDefinition = {
      id: "custom-site-settings",
      kind: "singleton",
      name: "siteSettings",
      label: "Site Settings",
      fields: [
        { id: "f-tagline", name: "tagline", label: "Tagline", type: "text", config: {}, validation: {}, order: 0 },
      ],
      version: 0,
    };
    const plan = await schema.planSave(siteSettings);
    await schema.applySave(siteSettings, plan);
    const allTypes = await schema.listContentTypes();
    const type = allTypes.find((t) => t.name === "siteSettings")!;

    expect(await entries.getSingletonEntry(type, allTypes)).toBeNull();

    const created = await entries.saveSingletonEntry(type, allTypes, { tagline: "Hello" });
    expect(created.value.tagline).toBe("Hello");

    const updated = await entries.saveSingletonEntry(type, allTypes, { tagline: "Updated" });
    expect(updated.id).toBe(created.id);
    expect(updated.value.tagline).toBe("Updated");

    const rows = await rawQuery(dir, `SELECT COUNT(*) as count FROM "siteSettings";`);
    expect((rows[0] as { count: number }).count).toBe(1);
  });

  it("bumps the resource's data version on create/update/delete, starting at 0", async () => {
    const { schema, entries, dir } = freshAdapters();
    dirs.push(dir);
    const allTypes = await schema.listContentTypes();
    const role = allTypes.find((t) => t.name === "role")!;

    expect(await entries.getResourceVersion(role)).toBe(0);

    const created = await entries.createEntry(role, allTypes, { name: "Editor", isSuperAdmin: false, permissions: [] });
    expect(await entries.getResourceVersion(role)).toBe(1);

    await entries.updateEntry(role, allTypes, created.id, { name: "Editor 2", isSuperAdmin: false, permissions: [] });
    expect(await entries.getResourceVersion(role)).toBe(2);

    await entries.deleteEntry(role, allTypes, created.id);
    expect(await entries.getResourceVersion(role)).toBe(3);
  });

  it("does not bump the data version when create fails validation (rolled back in the same transaction)", async () => {
    const { schema, entries, dir } = freshAdapters();
    dirs.push(dir);
    const allTypes = await schema.listContentTypes();
    const user = allTypes.find((t) => t.name === "user")!;

    expect(await entries.getResourceVersion(user)).toBe(0);

    await entries.createEntry(user, allTypes, { name: "Ada", email: "dup@example.com", password: { hasExisting: false, new: "hunter2" } satisfies MaskedValue });
    expect(await entries.getResourceVersion(user)).toBe(1);

    await expect(
      entries.createEntry(user, allTypes, { name: "Grace", email: "dup@example.com", password: { hasExisting: false, new: "hunter2" } satisfies MaskedValue }),
    ).rejects.toMatchObject({ code: "validation_failed" });
    expect(await entries.getResourceVersion(user)).toBe(1);
  });

  it("reorderEntries bulk-writes sortIndex for every listed row and bumps the resource version once", async () => {
    const { schema, entries, dir } = freshAdapters();
    dirs.push(dir);

    const item: ContentTypeDefinition = {
      id: "custom-item",
      kind: "collection",
      name: "item",
      label: "Item",
      features: { sortable: true },
      fields: [{ id: "f-name", name: "name", label: "Name", type: "text", config: {}, validation: {}, order: 0 }],
      version: 0,
    };
    await schema.applySave(item, await schema.planSave(item));
    const allTypes = await schema.listContentTypes();
    const itemType = allTypes.find((t) => t.name === "item")!;

    const a = await entries.createEntry(itemType, allTypes, { name: "A" });
    const b = await entries.createEntry(itemType, allTypes, { name: "B" });
    const c = await entries.createEntry(itemType, allTypes, { name: "C" });
    const versionBefore = await entries.getResourceVersion(itemType);

    await entries.reorderEntries(itemType, allTypes, [
      { id: c.id, sortIndex: 0 },
      { id: a.id, sortIndex: 1 },
      { id: b.id, sortIndex: 2 },
    ]);

    const ordered = await entries.listEntries(itemType, allTypes, { page: 0, pageSize: 10, sortField: "sortIndex", sortDir: "asc" });
    expect(ordered.rows.map((r) => r.value.name)).toEqual(["C", "A", "B"]);
    expect(await entries.getResourceVersion(itemType)).toBe(versionBefore + 1);
  });

  it("tracks each resource's data version independently", async () => {
    const { schema, entries, dir } = freshAdapters();
    dirs.push(dir);
    const allTypes = await schema.listContentTypes();
    const role = allTypes.find((t) => t.name === "role")!;
    const user = allTypes.find((t) => t.name === "user")!;

    await entries.createEntry(role, allTypes, { name: "Editor", isSuperAdmin: false, permissions: [] });
    expect(await entries.getResourceVersion(role)).toBe(1);
    expect(await entries.getResourceVersion(user)).toBe(0);
  });
});

async function rawQuery<T = unknown>(dir: string, sql: string): Promise<T[]> {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(join(dir, "content.sqlite"));
  try {
    return db.prepare(sql).all() as T[];
  } finally {
    db.close();
  }
}
