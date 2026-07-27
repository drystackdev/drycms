import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ContentTypeDefinition } from "../types.js";
import { createSqliteContentEngineAdapter } from "./sqlite.js";

/** Exercises the real adapter against a throwaway sqlite file (not a mock) -
 * the only way to actually prove deletion of a built-in content type is
 * refused server-side, not just hidden by the editor UI. */
function freshAdapter() {
  const dir = mkdtempSync(join(tmpdir(), "drycms-sqlite-test-"));
  const adapter = createSqliteContentEngineAdapter({ engine: "sqlite", file: join(dir, "content.sqlite") });
  return { adapter, dir };
}

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("createSqliteContentEngineAdapter", () => {
  it("seeds the built-in user/menu/menuItem defaults on first boot", async () => {
    const { adapter, dir } = freshAdapter();
    dirs.push(dir);

    const types = await adapter.listContentTypes();
    expect(types.map((t) => t.name).sort()).toEqual([
      "aiKeyManagement",
      "menu",
      "menuItem",
      "seo",
      "user",
    ]);
    expect(types.every((t) => t.system)).toBe(true);
  });

  it("refuses to delete a built-in content type", async () => {
    const { adapter, dir } = freshAdapter();
    dirs.push(dir);

    const user = (await adapter.listContentTypes()).find((t) => t.name === "user")!;
    await expect(adapter.deleteContentType(user.id)).rejects.toMatchObject({
      name: "ContentEngineError",
      code: "system_protected",
    });

    // Not just a rejected promise - nothing was actually dropped either.
    const stillThere = await adapter.getContentType(user.id);
    expect(stillThere).not.toBeNull();
  });

  it("still allows deleting an ordinary, non-system content type", async () => {
    const { adapter, dir } = freshAdapter();
    dirs.push(dir);

    const custom: ContentTypeDefinition = {
      id: "custom-note",
      kind: "collection",
      name: "note",
      label: "Note",
      fields: [],
      version: 0,
    };
    const plan = await adapter.planSave(custom);
    await adapter.applySave(custom, plan);

    await expect(adapter.deleteContentType("custom-note")).resolves.toBeUndefined();
    expect(await adapter.getContentType("custom-note")).toBeNull();
  });
});
