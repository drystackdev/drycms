import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ContentTypeDefinition } from "../types.js";
import type { MaskedValue } from "./entry-codec.js";
import { decryptSecret } from "../../lib/secret-crypto.js";
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

  it("encrypts an AI key in SQLite and preserves it when an edit leaves the key blank", async () => {
    const { schema, entries, dir } = freshAdapters();
    dirs.push(dir);
    const allTypes = await schema.listContentTypes();
    const aiKey = allTypes.find((type) => type.name === "aiKey")!;

    const created = await entries.createEntry(aiKey, allTypes, {
      name: "Google",
      description: "",
      provider: "Google",
      key: "AIza-test-value",
      model: "gemini-test",
      url: "",
    });
    const rawBefore = await entries.getRawEntry(aiKey, created.id);
    expect(rawBefore?.key).toMatch(/^v1:/);
    expect(await decryptSecret(String(rawBefore?.key))).toBe("AIza-test-value");

    await entries.updateEntry(aiKey, allTypes, created.id, {
      name: "Google updated",
      description: "",
      provider: "Google",
      key: { hasExisting: true } satisfies MaskedValue,
      model: "gemini-test-2",
      url: "",
    });
    const rawAfter = await entries.getRawEntry(aiKey, created.id);
    expect(rawAfter?.key).toBe(rawBefore?.key);
    expect(await decryptSecret(String(rawAfter?.key))).toBe("AIza-test-value");
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

  it("filters `where` on a manyToOne relation field's own id column and on the row's own id (flattenWhereColumns/ID_WHERE_COLUMN)", async () => {
    const { schema, entries, dir } = freshAdapters();
    dirs.push(dir);

    const category: ContentTypeDefinition = { id: "t-category", kind: "collection", name: "category", label: "Category", fields: [], version: 0 };
    await schema.applySave(category, await schema.planSave(category));
    const post: ContentTypeDefinition = {
      id: "t-post",
      kind: "collection",
      name: "post",
      label: "Post",
      fields: [
        { id: "f-title", name: "title", label: "Title", type: "text", config: {}, validation: {}, order: 0 },
        { id: "f-category", name: "category", label: "Category", type: "relation", config: { target: "t-category", cardinality: "manyToOne" }, validation: {}, order: 1 },
      ],
      version: 0,
    };
    await schema.applySave(post, await schema.planSave(post));

    const allTypes = await schema.listContentTypes();
    const categoryType = allTypes.find((t) => t.name === "category")!;
    const postType = allTypes.find((t) => t.name === "post")!;

    const catA = await entries.createEntry(categoryType, allTypes, {});
    const catB = await entries.createEntry(categoryType, allTypes, {});
    const p1 = await entries.createEntry(postType, allTypes, { title: "One", category: catA.id });
    const p2 = await entries.createEntry(postType, allTypes, { title: "Two", category: catA.id });
    await entries.createEntry(postType, allTypes, { title: "Three", category: catB.id });

    const byCategory = await entries.listEntries(postType, allTypes, {
      page: 0,
      pageSize: 10,
      where: [{ field: "category", op: "eq", value: catA.id }],
    });
    expect(byCategory.rows.map((r) => r.value.title).sort()).toEqual(["One", "Two"]);

    const excludingSelf = await entries.listEntries(postType, allTypes, {
      page: 0,
      pageSize: 10,
      where: [
        { field: "category", op: "eq", value: catA.id },
        { field: "id", op: "ne", value: p1.id },
      ],
    });
    expect(excludingSelf.rows.map((r) => r.id)).toEqual([p2.id]);
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

  it("findEntry looks a row up by slug (features.slug) and returns null on no match", async () => {
    const { schema, entries, dir } = freshAdapters();
    dirs.push(dir);
    const custom: ContentTypeDefinition = {
      id: "custom-post",
      kind: "collection",
      name: "post",
      label: "Post",
      features: { slug: true },
      fields: [],
      version: 0,
    };
    await schema.applySave(custom, await schema.planSave(custom));
    const allTypes = await schema.listContentTypes();
    const post = allTypes.find((t) => t.id === "custom-post")!;

    const created = await entries.createEntry(post, allTypes, { title: "Hello", slug: "hello" });
    await entries.createEntry(post, allTypes, { title: "Other", slug: "other" });

    const found = await entries.findEntry(post, allTypes, [{ field: "slug", op: "eq", value: "hello" }]);
    expect(found?.id).toBe(created.id);
    expect(found?.value.title).toBe("Hello");

    expect(await entries.findEntry(post, allTypes, [{ field: "slug", op: "eq", value: "nope" }])).toBeNull();
  });

  it("listEntries/findEntry apply a `where` filter, resolved against queryable field names", async () => {
    const { schema, entries, dir } = freshAdapters();
    dirs.push(dir);
    const custom: ContentTypeDefinition = {
      id: "custom-article",
      kind: "collection",
      name: "article",
      label: "Article",
      fields: [
        { id: "f-views", name: "views", label: "Views", type: "number", config: {}, validation: {}, order: 0 },
        { id: "f-category", name: "category", label: "Category", type: "text", config: {}, validation: {}, order: 1 },
      ],
      version: 0,
    };
    await schema.applySave(custom, await schema.planSave(custom));
    const allTypes = await schema.listContentTypes();
    const article = allTypes.find((t) => t.id === "custom-article")!;

    await entries.createEntry(article, allTypes, { views: 5, category: "news" });
    await entries.createEntry(article, allTypes, { views: 15, category: "news" });
    await entries.createEntry(article, allTypes, { views: 25, category: "sports" });

    const highViews = await entries.listEntries(article, allTypes, {
      page: 0,
      pageSize: 10,
      where: [{ field: "views", op: "gte", value: 10 }],
    });
    expect(highViews.total).toBe(2);
    expect(highViews.rows.map((r) => r.value.views).sort()).toEqual([15, 25]);

    const newsOrSports = await entries.listEntries(article, allTypes, {
      page: 0,
      pageSize: 10,
      where: [{ field: "category", op: "in", value: ["sports"] }],
    });
    expect(newsOrSports.total).toBe(1);
    expect(newsOrSports.rows[0]?.value.views).toBe(25);

    const combined = await entries.listEntries(article, allTypes, {
      page: 0,
      pageSize: 10,
      where: [
        { field: "category", op: "eq", value: "news" },
        { field: "views", op: "gt", value: 10 },
      ],
    });
    expect(combined.total).toBe(1);
    expect(combined.rows[0]?.value.views).toBe(15);

    await expect(
      entries.listEntries(article, allTypes, { page: 0, pageSize: 10, where: [{ field: "not-a-field", op: "eq", value: 1 }] }),
    ).rejects.toThrow(/not a queryable field/);
  });

  it("publishedOnly excludes draft rows and future-scheduled rows, treating an untouched draft/schedule as published", async () => {
    const { schema, entries, dir } = freshAdapters();
    dirs.push(dir);
    const custom: ContentTypeDefinition = {
      id: "custom-story",
      kind: "collection",
      name: "story",
      label: "Story",
      features: { slug: true, draft: true, schedule: true },
      fields: [],
      version: 0,
    };
    await schema.applySave(custom, await schema.planSave(custom));
    const allTypes = await schema.listContentTypes();
    const story = allTypes.find((t) => t.id === "custom-story")!;

    const untouched = await entries.createEntry(story, allTypes, { title: "Untouched", slug: "untouched" });
    await entries.createEntry(story, allTypes, { title: "Draft", slug: "draft-story", draft: true });
    const past = await entries.createEntry(story, allTypes, {
      title: "Past",
      slug: "past",
      draft: false,
      schedule: new Date(Date.now() - 86_400_000),
    });
    await entries.createEntry(story, allTypes, {
      title: "Future",
      slug: "future",
      draft: false,
      schedule: new Date(Date.now() + 86_400_000),
    });

    const published = await entries.listEntries(story, allTypes, { page: 0, pageSize: 10, publishedOnly: true });
    expect(published.total).toBe(2);
    expect(published.rows.map((r) => r.id).sort()).toEqual([untouched.id, past.id].sort());

    const all = await entries.listEntries(story, allTypes, { page: 0, pageSize: 10 });
    expect(all.total).toBe(4);

    expect(await entries.findEntry(story, allTypes, [{ field: "slug", op: "eq", value: "draft-story" }], { publishedOnly: true })).toBeNull();
    expect(await entries.findEntry(story, allTypes, [{ field: "slug", op: "eq", value: "future" }], { publishedOnly: true })).toBeNull();
    const foundPast = await entries.findEntry(story, allTypes, [{ field: "slug", op: "eq", value: "past" }], { publishedOnly: true });
    expect(foundPast?.id).toBe(past.id);
  });

  it("listEntries omits a non-inline richtext field by default, includes it when asked, and getEntry always includes it", async () => {
    const { schema, entries, dir } = freshAdapters();
    dirs.push(dir);
    const article: ContentTypeDefinition = {
      id: "custom-article",
      kind: "collection",
      name: "article",
      label: "Article",
      features: {},
      fields: [
        { id: "f-title", name: "title", label: "Title", type: "text", config: {}, validation: {}, order: 0 },
        { id: "f-body", name: "body", label: "Body", type: "richtext", config: { inline: false }, validation: {}, order: 1 },
      ],
      version: 0,
    };
    await schema.applySave(article, await schema.planSave(article));
    const allTypes = await schema.listContentTypes();
    const articleType = allTypes.find((t) => t.id === "custom-article")!;

    const created = await entries.createEntry(articleType, allTypes, { title: "Hello", body: "<p>Full body</p>" });

    const listed = await entries.listEntries(articleType, allTypes, { page: 0, pageSize: 10 });
    expect(listed.rows[0]?.value.title).toBe("Hello");
    expect(listed.rows[0]?.value.body).toBeNull();

    const listedWithBody = await entries.listEntries(articleType, allTypes, { page: 0, pageSize: 10, include: ["body"] });
    expect(listedWithBody.rows[0]?.value.body).toBe("<p>Full body</p>");

    const fetched = await entries.getEntry(articleType, allTypes, created.id);
    expect(fetched?.value.body).toBe("<p>Full body</p>");
  });

  it("listEntries' select narrows the row to the named fields, fetches an otherwise-excluded richtext when named, and still sorts/filters on unselected columns", async () => {
    const { schema, entries, dir } = freshAdapters();
    dirs.push(dir);
    const article: ContentTypeDefinition = {
      id: "custom-article",
      kind: "collection",
      name: "article",
      label: "Article",
      features: {},
      fields: [
        { id: "f-title", name: "title", label: "Title", type: "text", config: {}, validation: {}, order: 0 },
        { id: "f-views", name: "views", label: "Views", type: "number", config: {}, validation: {}, order: 1 },
        { id: "f-body", name: "body", label: "Body", type: "richtext", config: { inline: false }, validation: {}, order: 2 },
      ],
      version: 0,
    };
    await schema.applySave(article, await schema.planSave(article));
    const allTypes = await schema.listContentTypes();
    const articleType = allTypes.find((t) => t.id === "custom-article")!;

    await entries.createEntry(articleType, allTypes, { title: "Low", views: 1, body: "<p>a</p>" });
    await entries.createEntry(articleType, allTypes, { title: "High", views: 9, body: "<p>b</p>" });

    // An unselected field is ABSENT, not null - unlike the `include` case above.
    const titles = await entries.listEntries(articleType, allTypes, { page: 0, pageSize: 10, select: ["title"] });
    expect(titles.rows.map((r) => r.value)).toEqual([{ title: "High" }, { title: "Low" }]);
    expect(titles.rows[0]!.id).toBeGreaterThan(0);

    // `where`/`sort` still resolve against columns that aren't selected.
    const filtered = await entries.listEntries(articleType, allTypes, {
      page: 0,
      pageSize: 10,
      select: ["title"],
      where: [{ field: "views", op: "gte", value: 5 }],
      sortField: "views",
      sortDir: "asc",
    });
    expect(filtered.total).toBe(1);
    expect(filtered.rows[0]?.value).toEqual({ title: "High" });

    // Naming the non-inline richtext explicitly beats the default exclusion.
    const withBody = await entries.listEntries(articleType, allTypes, { page: 0, pageSize: 10, select: ["body"] });
    expect(withBody.rows.map((r) => r.value.body)).toEqual(["<p>b</p>", "<p>a</p>"]);
  });

  it("listEntries' select skips the child-table queries a repeatable component/multi-relation row would otherwise cost", async () => {
    const { schema, entries, dir } = freshAdapters();
    dirs.push(dir);
    const allTypes0 = await schema.listContentTypes();
    const role = allTypes0.find((t) => t.name === "role")!;
    const user = allTypes0.find((t) => t.name === "user")!;
    const editorRole = await entries.createEntry(role, allTypes0, { name: "Editor", isSuperAdmin: false, permissions: [] });
    await entries.createEntry(user, allTypes0, {
      name: "Ada",
      email: "ada@example.com",
      password: { hasExisting: false, new: "hunter2" } satisfies MaskedValue,
      roles: [editorRole.id],
    });

    const full = await entries.listEntries(user, allTypes0, { page: 0, pageSize: 10 });
    expect(full.rows[0]?.value.roles).toEqual([editorRole.id]);

    const narrowed = await entries.listEntries(user, allTypes0, { page: 0, pageSize: 10, select: ["name"] });
    expect(narrowed.rows[0]?.value).toEqual({ name: "Ada" });
    expect(narrowed.rows[0]?.value).not.toHaveProperty("roles");
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
