import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ContentTypeDefinition } from "../../types.js";
import type { MaskedValue } from "../entry-codec.js";
import { createFileContentEntryEngineAdapter } from "./entries-file.js";
import { createFileContentEngineAdapter } from "./file.js";

function freshAdapters() {
  const dir = mkdtempSync(join(tmpdir(), "drycms-entries-file-test-"));
  const option = { engine: "file" as const, kind: "local" as const, root: dir };
  const schema = createFileContentEngineAdapter(option);
  const entries = createFileContentEntryEngineAdapter(option);
  return { schema, entries, dir };
}

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function readRecord(dir: string, typeName: string, id: number | string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(dir, "data", typeName, `${id}.json`), "utf8"));
}

describe("createFileContentEntryEngineAdapter", () => {
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
    const originalHash = readRecord(dir, "user", created.id).password as string;

    await entries.updateEntry(user, allTypes, created.id, {
      name: "Ada",
      email: "ada@example.com",
      password: { hasExisting: true, new: "new-password" } satisfies MaskedValue,
    });

    const newHash = readRecord(dir, "user", created.id).password as string;
    expect(newHash).not.toBe(originalHash);
  });

  it("rejects a duplicate unique field with a field-scoped error, and does not reserve it", async () => {
    const { schema, entries, dir } = freshAdapters();
    dirs.push(dir);
    const allTypes = await schema.listContentTypes();
    const user = allTypes.find((t) => t.name === "user")!;

    await entries.createEntry(user, allTypes, { name: "Ada", email: "dup@example.com", password: { hasExisting: false, new: "x" } satisfies MaskedValue });
    await expect(
      entries.createEntry(user, allTypes, { name: "Grace", email: "dup@example.com", password: { hasExisting: false, new: "x" } satisfies MaskedValue }),
    ).rejects.toMatchObject({ name: "ContentEntryError", code: "validation_failed", fieldErrors: { email: expect.any(String) } });

    // A THIRD user can still use a completely different email - the failed
    // attempt above must not have left a stray reservation behind.
    const third = await entries.createEntry(user, allTypes, { name: "Zoe", email: "zoe@example.com", password: { hasExisting: false, new: "x" } satisfies MaskedValue });
    expect(third.value.email).toBe("zoe@example.com");
  });

  it("rejects a missing required field with a field-scoped error", async () => {
    const { schema, entries, dir } = freshAdapters();
    dirs.push(dir);
    const allTypes = await schema.listContentTypes();
    const user = allTypes.find((t) => t.name === "user")!;

    await expect(
      entries.createEntry(user, allTypes, { name: "", email: "", password: { hasExisting: false } satisfies MaskedValue }),
    ).rejects.toMatchObject({ name: "ContentEntryError", code: "validation_failed" });
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
    expect(await entries.getEntry(menu, allTypes, created.id)).toBeNull();
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

    const searched = await entries.listEntries(user, allTypes, { page: 0, pageSize: 10, search: "ada", searchableFields: ["name", "email"] });
    expect(searched.total).toBe(1);
    expect(searched.rows[0]?.value.name).toBe("Ada");

    const sorted = await entries.listEntries(user, allTypes, { page: 0, pageSize: 10, sortField: "name", sortDir: "asc" });
    expect(sorted.rows.map((r) => r.value.name)).toEqual(["Ada", "Alan", "Grace"]);

    const paged = await entries.listEntries(user, allTypes, { page: 1, pageSize: 2, sortField: "name", sortDir: "asc" });
    expect(paged.rows.map((r) => r.value.name)).toEqual(["Grace"]);
  });

  it("reads and writes back an auto-generated relationmirror field reflecting a manyToMany relation (role.user mirrors user.roles)", async () => {
    const { schema, entries, dir } = freshAdapters();
    dirs.push(dir);
    const allTypes = await schema.listContentTypes();
    const user = allTypes.find((t) => t.name === "user")!;
    const roleType = allTypes.find((t) => t.name === "role")!;

    const editor = await entries.createEntry(roleType, allTypes, { name: "Editor", isSuperAdmin: false, permissions: [] });
    const ada = await entries.createEntry(user, allTypes, { name: "Ada", email: "ada@example.com", password: { hasExisting: false, new: "x" } satisfies MaskedValue, roles: [editor.id] });
    const grace = await entries.createEntry(user, allTypes, { name: "Grace", email: "grace@example.com", password: { hasExisting: false, new: "x" } satisfies MaskedValue, roles: [editor.id] });

    const unrelatedRole = await entries.createEntry(roleType, allTypes, { name: "Unrelated", isSuperAdmin: false, permissions: [] });
    const unrelatedUser = await entries.createEntry(user, allTypes, {
      name: "Zoe",
      email: "zoe@example.com",
      password: { hasExisting: false, new: "x" } satisfies MaskedValue,
      roles: [unrelatedRole.id],
    });

    const editorEntry = await entries.getEntry(roleType, allTypes, editor.id);
    expect(editorEntry?.value.user).toEqual([ada.id, grace.id]);

    await entries.updateEntry(roleType, allTypes, editor.id, { name: "Editor", isSuperAdmin: false, permissions: [], user: [ada.id] });

    expect((await entries.getEntry(roleType, allTypes, editor.id))?.value.user).toEqual([ada.id]);
    expect((await entries.getEntry(user, allTypes, ada.id))?.value.roles).toEqual([editor.id]);
    expect((await entries.getEntry(user, allTypes, grace.id))?.value.roles).toEqual([]);
    expect((await entries.getEntry(roleType, allTypes, unrelatedRole.id))?.value.user).toEqual([unrelatedUser.id]);
    expect((await entries.getEntry(user, allTypes, unrelatedUser.id))?.value.roles).toEqual([unrelatedRole.id]);
  });

  it("listEntries resolves a relationmirror field per-record, not the same value for every row sharing the reverse-index file", async () => {
    const { schema, entries, dir } = freshAdapters();
    dirs.push(dir);
    const allTypes = await schema.listContentTypes();
    const user = allTypes.find((t) => t.name === "user")!;
    const roleType = allTypes.find((t) => t.name === "role")!;

    const editor = await entries.createEntry(roleType, allTypes, { name: "Editor", isSuperAdmin: false, permissions: [] });
    const viewer = await entries.createEntry(roleType, allTypes, { name: "Viewer", isSuperAdmin: false, permissions: [] });
    const empty = await entries.createEntry(roleType, allTypes, { name: "Empty", isSuperAdmin: false, permissions: [] });

    const ada = await entries.createEntry(user, allTypes, { name: "Ada", email: "ada@example.com", password: { hasExisting: false, new: "x" } satisfies MaskedValue, roles: [editor.id] });
    const grace = await entries.createEntry(user, allTypes, { name: "Grace", email: "grace@example.com", password: { hasExisting: false, new: "x" } satisfies MaskedValue, roles: [editor.id, viewer.id] });

    const { rows } = await entries.listEntries(roleType, allTypes, { page: 0, pageSize: 10, sortField: "name", sortDir: "asc" });
    const byId = new Map(rows.map((row) => [row.id, row.value.user]));
    expect(byId.get(editor.id)).toEqual([ada.id, grace.id]);
    expect(byId.get(viewer.id)).toEqual([grace.id]);
    expect(byId.get(empty.id)).toEqual([]);
  });

  it("reads and writes back an auto-generated relationmirror field reflecting a manyToOne relation (project.team mirrors team.project)", async () => {
    const { schema, entries, dir } = freshAdapters();
    dirs.push(dir);

    const project: ContentTypeDefinition = { id: "custom-project", kind: "collection", name: "project", label: "Project", fields: [], version: 0 };
    await schema.applySave(project, await schema.planSave(project));

    let allTypes = await schema.listContentTypes();
    const projectType = allTypes.find((t) => t.name === "project")!;
    const team: ContentTypeDefinition = {
      id: "custom-team",
      kind: "collection",
      name: "team",
      label: "Team",
      fields: [{ id: "f-team-project", name: "project", label: "Project", type: "relation", config: { target: projectType.id, cardinality: "manyToOne" }, validation: {}, order: 0 }],
      version: 0,
    };
    await schema.applySave(team, await schema.planSave(team));

    allTypes = await schema.listContentTypes();
    const finalProjectType = allTypes.find((t) => t.name === "project")!;
    const finalTeamType = allTypes.find((t) => t.name === "team")!;

    const alpha = await entries.createEntry(finalProjectType, allTypes, { team: [] });
    const beta = await entries.createEntry(finalProjectType, allTypes, { team: [] });
    const frontend = await entries.createEntry(finalTeamType, allTypes, { project: alpha.id });
    const backend = await entries.createEntry(finalTeamType, allTypes, { project: alpha.id });
    const platform = await entries.createEntry(finalTeamType, allTypes, { project: beta.id });

    expect((await entries.getEntry(finalProjectType, allTypes, alpha.id))?.value.team).toEqual([frontend.id, backend.id]);

    await entries.updateEntry(finalProjectType, allTypes, alpha.id, { team: [frontend.id] });

    expect((await entries.getEntry(finalProjectType, allTypes, alpha.id))?.value.team).toEqual([frontend.id]);
    expect((await entries.getEntry(finalTeamType, allTypes, frontend.id))?.value.project).toBe(alpha.id);
    expect((await entries.getEntry(finalTeamType, allTypes, backend.id))?.value.project).toBeNull();
    expect((await entries.getEntry(finalProjectType, allTypes, beta.id))?.value.team).toEqual([platform.id]);
    expect((await entries.getEntry(finalTeamType, allTypes, platform.id))?.value.project).toBe(beta.id);
  });

  it("reads and writes back an auto-generated relationmirror field reflecting a oneToMany relation (product.cart mirrors cart.items), and rejects claiming an already-claimed target", async () => {
    const { schema, entries, dir } = freshAdapters();
    dirs.push(dir);

    const product: ContentTypeDefinition = { id: "custom-product", kind: "collection", name: "product", label: "Product", fields: [], version: 0 };
    await schema.applySave(product, await schema.planSave(product));

    let allTypes = await schema.listContentTypes();
    const productType = allTypes.find((t) => t.name === "product")!;
    const cart: ContentTypeDefinition = {
      id: "custom-cart",
      kind: "collection",
      name: "cart",
      label: "Cart",
      fields: [{ id: "f-cart-items", name: "items", label: "Items", type: "relation", config: { target: productType.id, cardinality: "oneToMany" }, validation: {}, order: 0 }],
      version: 0,
    };
    await schema.applySave(cart, await schema.planSave(cart));

    allTypes = await schema.listContentTypes();
    const finalProductType = allTypes.find((t) => t.name === "product")!;
    const finalCartType = allTypes.find((t) => t.name === "cart")!;

    const cartA = await entries.createEntry(finalCartType, allTypes, { items: [] });
    const cartB = await entries.createEntry(finalCartType, allTypes, { items: [] });
    const widget = await entries.createEntry(finalProductType, allTypes, { cart: null });
    const gadget = await entries.createEntry(finalProductType, allTypes, { cart: cartB.id });

    expect((await entries.getEntry(finalCartType, allTypes, cartB.id))?.value.items).toEqual([gadget.id]);

    await entries.updateEntry(finalProductType, allTypes, widget.id, { cart: cartA.id });
    expect((await entries.getEntry(finalCartType, allTypes, cartA.id))?.value.items).toEqual([widget.id]);
    expect((await entries.getEntry(finalProductType, allTypes, widget.id))?.value.cart).toBe(cartA.id);
    expect((await entries.getEntry(finalCartType, allTypes, cartB.id))?.value.items).toEqual([gadget.id]);
    expect((await entries.getEntry(finalProductType, allTypes, gadget.id))?.value.cart).toBe(cartB.id);

    await entries.updateEntry(finalProductType, allTypes, widget.id, { cart: null });
    expect((await entries.getEntry(finalCartType, allTypes, cartA.id))?.value.items).toEqual([]);
    expect((await entries.getEntry(finalProductType, allTypes, widget.id))?.value.cart).toBeNull();

    // File-engine-specific: `oneToMany`'s exclusivity ("each target claimed
    // by at most one row") is enforced explicitly here (no SQL UNIQUE
    // constraint to fall back on) - claiming gadget (already cartB's) from
    // cartA directly through `cart.items` must be rejected, and cartA's own
    // items list must be untouched by the failed attempt.
    await expect(entries.updateEntry(finalCartType, allTypes, cartA.id, { items: [gadget.id] })).rejects.toMatchObject({ name: "ContentEntryError", code: "validation_failed" });
    expect((await entries.getEntry(finalCartType, allTypes, cartA.id))?.value.items).toEqual([]);
    expect((await entries.getEntry(finalProductType, allTypes, gadget.id))?.value.cart).toBe(cartB.id);
  });

  it("getSingletonEntry/saveSingletonEntry upsert the one row a singleton has", async () => {
    const { schema, entries, dir } = freshAdapters();
    dirs.push(dir);

    const siteSettings: ContentTypeDefinition = {
      id: "custom-site-settings",
      kind: "singleton",
      name: "siteSettings",
      label: "Site Settings",
      fields: [{ id: "f-tagline", name: "tagline", label: "Tagline", type: "text", config: {}, validation: {}, order: 0 }],
      version: 0,
    };
    await schema.applySave(siteSettings, await schema.planSave(siteSettings));
    const allTypes = await schema.listContentTypes();
    const type = allTypes.find((t) => t.name === "siteSettings")!;

    expect(await entries.getSingletonEntry(type, allTypes)).toBeNull();

    const created = await entries.saveSingletonEntry(type, allTypes, { tagline: "Hello" });
    expect(created.value.tagline).toBe("Hello");

    const updated = await entries.saveSingletonEntry(type, allTypes, { tagline: "Updated" });
    expect(updated.id).toBe(created.id);
    expect(updated.value.tagline).toBe("Updated");
  });
});
