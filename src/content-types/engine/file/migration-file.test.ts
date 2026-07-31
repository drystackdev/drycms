import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ContentTypeDefinition, FieldDefinition } from "../../types.js";
import { createFileDriver } from "./file-driver.js";
import { applyFileRewrite, diffFileType } from "./migration-file.js";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function freshDriver() {
  const dir = mkdtempSync(join(tmpdir(), "drycms-migration-file-test-"));
  dirs.push(dir);
  return createFileDriver({ engine: "file" as const, kind: "local" as const, root: dir });
}

function type(fields: FieldDefinition[], version = 0): ContentTypeDefinition {
  return { id: "t-note", kind: "collection", name: "note", label: "Note", fields, version };
}

const bodyField: FieldDefinition = { id: "f-body", name: "body", label: "Body", type: "text", config: {}, validation: {}, order: 0 };

describe("diffFileType", () => {
  it("flags no destructive changes and no rewrite for an unrelated field addition", () => {
    const oldType = type([]);
    const newType = type([bodyField]);
    const plan = diffFileType(oldType, [oldType], newType, [newType]);
    expect(plan.needsRewrite).toBe(false);
    expect(plan.destructive).toEqual([]);
  });

  it("flags field-removed and a matching removeKeys rewrite op", () => {
    const oldType = type([bodyField]);
    const newType = type([]);
    const plan = diffFileType(oldType, [oldType], newType, [newType]);
    expect(plan.needsRewrite).toBe(true);
    expect(plan.rewrite.removeKeys).toEqual(["body"]);
    expect(plan.destructive).toEqual([{ kind: "field-removed", typeName: "note", fieldName: "body" }]);
  });

  it("flags field-renamed (same id, new name) and a matching renameKeys rewrite op", () => {
    const oldType = type([bodyField]);
    const newType = type([{ ...bodyField, name: "content" }]);
    const plan = diffFileType(oldType, [oldType], newType, [newType]);
    expect(plan.needsRewrite).toBe(true);
    expect(plan.rewrite.renameKeys).toEqual([{ from: "body", to: "content" }]);
    expect(plan.destructive).toEqual([{ kind: "field-renamed", typeName: "note", fieldName: "content", detail: "body -> content" }]);
  });

  it("flags retyped (same name, new field type) and a matching transform", () => {
    const oldType = type([bodyField]);
    const newType = type([{ ...bodyField, type: "number" }]);
    const plan = diffFileType(oldType, [oldType], newType, [newType]);
    expect(plan.needsRewrite).toBe(true);
    expect(plan.rewrite.transforms).toEqual([{ key: "body", toKey: "body", kind: "retype-scalar", fieldType: "number" }]);
    expect(plan.destructive).toEqual([{ kind: "retyped", typeName: "note", fieldName: "body", detail: "text -> number" }]);
  });

  it("expectedVersion/nextVersion mirror the old type's version", () => {
    const oldType = type([bodyField], 3);
    const newType = type([bodyField], 3);
    const plan = diffFileType(oldType, [oldType], newType, [newType]);
    expect(plan.expectedVersion).toBe(3);
    expect(plan.nextVersion).toBe(4);
  });
});

describe("applyFileRewrite", () => {
  it("renames, removes, and retypes keys across every stored record", async () => {
    const driver = freshDriver();
    await driver.writeJson("data/note/1.json", { id: 1, body: "5", extra: "gone" });
    await driver.writeJson("data/note/2.json", { id: 2, body: "7", extra: "gone" });

    await applyFileRewrite(driver, "note", {
      removeKeys: ["extra"],
      renameKeys: [{ from: "body", to: "content" }],
      transforms: [],
    });

    expect(await driver.readJson("data/note/1.json")).toEqual({ id: 1, content: "5" });
    expect(await driver.readJson("data/note/2.json")).toEqual({ id: 2, content: "7" });
  });

  it("coerces a scalar retype best-effort, falling back to null when not coercible", async () => {
    const driver = freshDriver();
    await driver.writeJson("data/note/1.json", { id: 1, body: "42" });
    await driver.writeJson("data/note/2.json", { id: 2, body: "not-a-number" });

    await applyFileRewrite(driver, "note", { removeKeys: [], renameKeys: [], transforms: [{ key: "body", toKey: "body", kind: "retype-scalar", fieldType: "number" }] });

    expect(await driver.readJson("data/note/1.json")).toEqual({ id: 1, body: 42 });
    expect(await driver.readJson("data/note/2.json")).toEqual({ id: 2, body: null });
  });

  it("is a no-op when the op is empty", async () => {
    const driver = freshDriver();
    await driver.writeJson("data/note/1.json", { id: 1, body: "unchanged" });
    await applyFileRewrite(driver, "note", { removeKeys: [], renameKeys: [], transforms: [] });
    expect(await driver.readJson("data/note/1.json")).toEqual({ id: 1, body: "unchanged" });
  });
});
