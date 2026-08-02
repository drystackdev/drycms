import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ContentTypeDefinition } from "../../types.js";
import { SUPER_ADMIN_DESCRIPTION } from "../../permissions.js";
import { createFileContentEntryEngineAdapter } from "./entries-file.js";
import { createFileContentEngineAdapter } from "./file.js";

function freshAdapter() {
  const dir = mkdtempSync(join(tmpdir(), "drycms-file-schema-test-"));
  const option = { engine: "file" as const, kind: "local" as const, root: dir };
  const adapter = createFileContentEngineAdapter(option);
  const entries = createFileContentEntryEngineAdapter(option);
  return { adapter, entries, dir };
}

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("createFileContentEngineAdapter", () => {
  it("seeds the built-in user/menu/menuItem/aiKey/role defaults on first boot", async () => {
    const { adapter, dir } = freshAdapter();
    dirs.push(dir);

    const types = await adapter.listContentTypes();
    expect(types.map((t) => t.name).sort()).toEqual(["aiKey", "menu", "menuItem", "role", "seo", "user"]);
    const byName = (name: string) => types.find((t) => t.name === name)!;
    expect(byName("role").hidden).toBe(true);
    expect(byName("aiKey").hidden).toBe(true);
    expect(byName("user").hidden).toBeFalsy();
  });

  it("seeds the permanent Super Admin role at boot", async () => {
    const { adapter, entries, dir } = freshAdapter();
    dirs.push(dir);
    const allTypes = await adapter.listContentTypes();
    const roleType = allTypes.find((t) => t.name === "role")!;
    const { rows } = await entries.listEntries(roleType, allTypes, { page: 0, pageSize: 10 });
    // `role` auto-gains a `user` relationmirror field the moment `user.roles`
    // (a real relation targeting it) exists, which the seed already provides.
    expect(rows.map((r) => r.value)).toEqual([
      { name: "Super Admin", description: SUPER_ADMIN_DESCRIPTION, isSuperAdmin: true, permissions: [], user: [] },
    ]);
  });

  it("still allows deleting an ordinary content type", async () => {
    const { adapter, dir } = freshAdapter();
    dirs.push(dir);

    const custom: ContentTypeDefinition = { id: "custom-note", kind: "collection", name: "note", label: "Note", fields: [], version: 0 };
    await adapter.applySave(custom, await adapter.planSave(custom));

    await expect(adapter.deleteContentType("custom-note")).resolves.toBeUndefined();
    expect(await adapter.getContentType("custom-note")).toBeNull();
  });

  it("bumps the content-types collection's data version on boot seed, save, and delete", async () => {
    const { adapter, dir } = freshAdapter();
    dirs.push(dir);

    await adapter.listContentTypes(); // triggers the boot seed
    const afterBoot = await adapter.getResourceVersion();
    expect(afterBoot).toBeGreaterThan(0);

    const custom: ContentTypeDefinition = { id: "custom-note", kind: "collection", name: "note", label: "Note", fields: [], version: 0 };
    await adapter.applySave(custom, await adapter.planSave(custom));
    const afterSave = await adapter.getResourceVersion();
    expect(afterSave).toBe(afterBoot + 1);

    await adapter.deleteContentType("custom-note");
    const afterDelete = await adapter.getResourceVersion();
    expect(afterDelete).toBe(afterSave + 1);
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

  describe("content-types index cache", () => {
    function cachePath(dir: string) {
      return join(dir, ".index", "content-types.json");
    }

    it("warms a single aggregate cache file on first boot, instead of leaving reads to re-scan every type file", async () => {
      const { adapter, dir } = freshAdapter();
      dirs.push(dir);

      const listed = await adapter.listContentTypes();
      expect(existsSync(cachePath(dir))).toBe(true);

      const cached = JSON.parse(readFileSync(cachePath(dir), "utf8")) as ContentTypeDefinition[];
      expect(cached.map((t) => t.name).sort()).toEqual(listed.map((t) => t.name).sort());
    });

    it("applySave keeps the cache in sync with the saved type", async () => {
      const { adapter, dir } = freshAdapter();
      dirs.push(dir);

      const note: ContentTypeDefinition = { id: "custom-note", kind: "collection", name: "note", label: "Note", fields: [], version: 0 };
      const saved = await adapter.applySave(note, await adapter.planSave(note));

      const cached = JSON.parse(readFileSync(cachePath(dir), "utf8")) as ContentTypeDefinition[];
      expect(cached.find((t) => t.id === "custom-note")).toEqual(saved);

      // getContentType/listContentTypes read the cache, not a fresh scan -
      // both must agree with what's actually on disk.
      expect(await adapter.getContentType("custom-note")).toEqual(saved);
    });

    it("deleteContentType removes the type from the cache too", async () => {
      const { adapter, dir } = freshAdapter();
      dirs.push(dir);

      const note: ContentTypeDefinition = { id: "custom-note", kind: "collection", name: "note", label: "Note", fields: [], version: 0 };
      await adapter.applySave(note, await adapter.planSave(note));
      await adapter.deleteContentType("custom-note");

      const cached = JSON.parse(readFileSync(cachePath(dir), "utf8")) as ContentTypeDefinition[];
      expect(cached.some((t) => t.id === "custom-note")).toBe(false);
      expect(await adapter.getContentType("custom-note")).toBeNull();
    });

    it("self-heals - a missing/corrupt cache file is rebuilt from the real content-types/*.json files", async () => {
      const { adapter, dir } = freshAdapter();
      dirs.push(dir);
      await adapter.listContentTypes(); // warm it once

      unlinkSync(cachePath(dir));
      const reread = await adapter.listContentTypes();
      expect(reread.map((t) => t.name).sort()).toEqual(["aiKey", "menu", "menuItem", "role", "seo", "user"]);
      // The repair write put the cache back.
      expect(existsSync(cachePath(dir))).toBe(true);

      writeFileSync(cachePath(dir), "not json");
      await expect(adapter.listContentTypes()).rejects.toThrow();
    });
  });
});
