import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ContentTypeDefinition } from "../../types.js";
import { createFileContentEntryEngineAdapter } from "./entries-file.js";
import { createFileContentEngineAdapter } from "./file.js";

function freshAdapter() {
  const dir = mkdtempSync(join(tmpdir(), "drycms-file-schema-test-"));
  const option = { engine: "file" as const, kind: "local" as const, root: dir };
  const adapter = createFileContentEngineAdapter(option);
  const entries = createFileContentEntryEngineAdapter(option);
  return { adapter, entries, dir };
}

/** Reads back every `permission` row via the entry adapter - the file
 * engine's counterpart to `sqlite.test.ts`'s raw `SELECT ... FROM
 * "permission"` (there's no separate "table" to query directly here; the
 * entry adapter IS the row-level read path, same as it is at runtime). */
async function permissionRows(entries: ReturnType<typeof createFileContentEntryEngineAdapter>, allTypes: ContentTypeDefinition[]) {
  const permissionType = allTypes.find((t) => t.name === "permission")!;
  const { rows } = await entries.listEntries(permissionType, allTypes, { page: 0, pageSize: 1000 });
  return rows.map((r) => r.value as { name: string; idTable: string; action: string });
}

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("createFileContentEngineAdapter", () => {
  it("seeds the built-in user/menu/menuItem/aiKey/role/permission defaults on first boot", async () => {
    const { adapter, dir } = freshAdapter();
    dirs.push(dir);

    const types = await adapter.listContentTypes();
    expect(types.map((t) => t.name).sort()).toEqual(["aiKey", "menu", "menuItem", "permission", "role", "seo", "user"]);
    expect(types.every((t) => !t.system)).toBe(true);
  });

  it("seeds the permanent Super Admin role at boot", async () => {
    const { adapter, entries, dir } = freshAdapter();
    dirs.push(dir);
    const allTypes = await adapter.listContentTypes();
    const roleType = allTypes.find((t) => t.name === "role")!;
    const { rows } = await entries.listEntries(roleType, allTypes, { page: 0, pageSize: 10 });
    // `role` auto-gains a `user` relationmirror field the moment `user.roles`
    // (a real relation targeting it) exists, which the seed already provides.
    expect(rows.map((r) => r.value)).toEqual([{ name: "Super Admin", isSuperAdmin: true, permissions: [], user: [] }]);
  });

  it("creates 4 permission rows (create/read/edit/delete) for every built-in collection/singleton at boot", async () => {
    const { adapter, entries, dir } = freshAdapter();
    dirs.push(dir);
    const allTypes = await adapter.listContentTypes();

    const rows = (await permissionRows(entries, allTypes)).map(({ name, action }) => ({ name, action })).sort((a, b) => a.name.localeCompare(b.name) || a.action.localeCompare(b.action));
    expect(rows).toEqual([
      { name: "aiKey", action: "create" },
      { name: "aiKey", action: "delete" },
      { name: "aiKey", action: "edit" },
      { name: "aiKey", action: "read" },
      { name: "menu", action: "create" },
      { name: "menu", action: "delete" },
      { name: "menu", action: "edit" },
      { name: "menu", action: "read" },
      { name: "permission", action: "create" },
      { name: "permission", action: "delete" },
      { name: "permission", action: "edit" },
      { name: "permission", action: "read" },
      { name: "role", action: "create" },
      { name: "role", action: "delete" },
      { name: "role", action: "edit" },
      { name: "role", action: "read" },
      { name: "user", action: "create" },
      { name: "user", action: "delete" },
      { name: "user", action: "edit" },
      { name: "user", action: "read" },
    ]);
  });

  it("still allows deleting an ordinary, non-system content type", async () => {
    const { adapter, dir } = freshAdapter();
    dirs.push(dir);

    const custom: ContentTypeDefinition = { id: "custom-note", kind: "collection", name: "note", label: "Note", fields: [], version: 0 };
    await adapter.applySave(custom, await adapter.planSave(custom));

    await expect(adapter.deleteContentType("custom-note")).resolves.toBeUndefined();
    expect(await adapter.getContentType("custom-note")).toBeNull();
  });

  it("creates 4 matching permission rows when a new collection is saved, updates them on rename, and removes them on delete", async () => {
    const { adapter, entries, dir } = freshAdapter();
    dirs.push(dir);

    const custom: ContentTypeDefinition = { id: "custom-note", kind: "collection", name: "note", label: "Note", fields: [], version: 0 };
    const saved = await adapter.applySave(custom, await adapter.planSave(custom));

    let allTypes = await adapter.listContentTypes();
    let rows = (await permissionRows(entries, allTypes)).filter((r) => r.idTable === "custom-note");
    expect(rows.map((r) => r.name)).toEqual(["note", "note", "note", "note"]);

    const renamed = { ...saved, name: "memo", label: "Memo" };
    await adapter.applySave(renamed, await adapter.planSave(renamed));

    allTypes = await adapter.listContentTypes();
    rows = (await permissionRows(entries, allTypes)).filter((r) => r.idTable === "custom-note");
    expect(rows.map((r) => r.name)).toEqual(["memo", "memo", "memo", "memo"]);

    await adapter.deleteContentType("custom-note");
    allTypes = await adapter.listContentTypes();
    rows = (await permissionRows(entries, allTypes)).filter((r) => r.idTable === "custom-note");
    expect(rows).toEqual([]);
  });

  it("rejects applySave when the plan is stale (version conflict)", async () => {
    const { adapter, dir } = freshAdapter();
    dirs.push(dir);

    const custom: ContentTypeDefinition = { id: "custom-note", kind: "collection", name: "note", label: "Note", fields: [], version: 0 };
    const plan = await adapter.planSave(custom);
    const saved = await adapter.applySave(custom, plan);
    expect(saved.version).toBe(1);

    // A second, concurrent edit based on the SAME originally-loaded version.
    await expect(adapter.planSave({ ...custom, label: "Note (again)" })).rejects.toMatchObject({ name: "ContentEngineError", code: "version_conflict" });
  });

  it("rewrites every stored entry's key when a field is renamed", async () => {
    const { adapter, entries, dir } = freshAdapter();
    dirs.push(dir);

    const note: ContentTypeDefinition = {
      id: "custom-note",
      kind: "collection",
      name: "note",
      label: "Note",
      fields: [{ id: "f-body", name: "body", label: "Body", type: "text", config: {}, validation: {}, order: 0 }],
      version: 0,
    };
    const saved = await adapter.applySave(note, await adapter.planSave(note));
    let allTypes = await adapter.listContentTypes();
    const noteType = allTypes.find((t) => t.name === "note")!;
    const entry = await entries.createEntry(noteType, allTypes, { body: "Hello" });

    const renamed: ContentTypeDefinition = { ...saved, fields: [{ ...saved.fields[0]!, name: "content" }] };
    const plan = await adapter.planSave(renamed);
    expect(plan.destructiveSummary).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "field-renamed" })]));
    await adapter.applySave(renamed, plan);

    allTypes = await adapter.listContentTypes();
    const finalNoteType = allTypes.find((t) => t.name === "note")!;
    const reread = await entries.getEntry(finalNoteType, allTypes, entry.id);
    expect(reread?.value.content).toBe("Hello");
    expect(reread?.value.body).toBeUndefined();
  });

  it("refuses to delete a component still embedded by another content type", async () => {
    const { adapter, dir } = freshAdapter();
    dirs.push(dir);

    const badge: ContentTypeDefinition = {
      id: "custom-badge",
      kind: "component",
      name: "badge",
      label: "Badge",
      fields: [{ id: "f-badge-label", name: "label", label: "Label", type: "text", config: {}, validation: {}, order: 0 }],
      version: 0,
    };
    await adapter.applySave(badge, await adapter.planSave(badge));

    const note: ContentTypeDefinition = {
      id: "custom-note",
      kind: "collection",
      name: "note",
      label: "Note",
      fields: [{ id: "f-note-badge", name: "badge", label: "Badge", type: "component", config: { componentId: "custom-badge", repeatable: false }, validation: {}, order: 0 }],
      version: 0,
    };
    await adapter.applySave(note, await adapter.planSave(note));

    await expect(adapter.deleteContentType("custom-badge")).rejects.toMatchObject({ name: "ContentEngineError", code: "in_use" });
  });
});
