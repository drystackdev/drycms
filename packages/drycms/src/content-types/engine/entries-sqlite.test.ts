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
      password: "hunter2",
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

  it("rejects a duplicate unique field with a field-scoped error", async () => {
    const { schema, entries, dir } = freshAdapters();
    dirs.push(dir);
    const allTypes = await schema.listContentTypes();
    const user = allTypes.find((t) => t.name === "user")!;

    await entries.createEntry(user, allTypes, { name: "Ada", email: "dup@example.com", password: "hunter2" });
    await expect(
      entries.createEntry(user, allTypes, { name: "Grace", email: "dup@example.com", password: "hunter2" }),
    ).rejects.toMatchObject({ name: "ContentEntryError", code: "validation_failed", fieldErrors: { email: expect.any(String) } });
  });

  it("rejects a missing required field with a field-scoped error", async () => {
    const { schema, entries, dir } = freshAdapters();
    dirs.push(dir);
    const allTypes = await schema.listContentTypes();
    const user = allTypes.find((t) => t.name === "user")!;

    await expect(entries.createEntry(user, allTypes, { name: "", email: "a@b.com", password: "x" })).rejects.toMatchObject({
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

    await entries.createEntry(user, allTypes, { name: "Ada", email: "ada@example.com", password: "x" });
    await entries.createEntry(user, allTypes, { name: "Grace", email: "grace@example.com", password: "x" });
    await entries.createEntry(user, allTypes, { name: "Alan", email: "alan@example.com", password: "x" });

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
