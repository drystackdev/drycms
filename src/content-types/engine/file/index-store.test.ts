import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFileDriver } from "./file-driver.js";
import { nextId, patchReverseIndex, readReverseTargets, releaseUnique, reserveUnique, RelationTargetClaimedError, UniqueConflictError } from "./index-store.js";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function freshDriver() {
  const dir = mkdtempSync(join(tmpdir(), "drycms-index-store-test-"));
  dirs.push(dir);
  return createFileDriver({ engine: "file" as const, kind: "local" as const, root: dir });
}

describe("nextId", () => {
  it("assigns 1, 2, 3, ... for a fresh collection", async () => {
    const driver = freshDriver();
    expect(await nextId(driver, "posts")).toBe(1);
    expect(await nextId(driver, "posts")).toBe(2);
    expect(await nextId(driver, "posts")).toBe(3);
  });

  it("rebuilds the counter from existing record filenames when the counter file is missing", async () => {
    const driver = freshDriver();
    await driver.writeJson("data/posts/5.json", { id: 5 });
    await driver.writeJson("data/posts/2.json", { id: 2 });
    expect(await nextId(driver, "posts")).toBe(6);
  });

  it("assigns independent sequences per collection", async () => {
    const driver = freshDriver();
    expect(await nextId(driver, "posts")).toBe(1);
    expect(await nextId(driver, "tags")).toBe(1);
    expect(await nextId(driver, "posts")).toBe(2);
  });
});

describe("reserveUnique / releaseUnique", () => {
  it("reserves a new value, rejects a conflicting one, and allows it again after release", async () => {
    const driver = freshDriver();
    await reserveUnique(driver, "user", "f-email", 1, "ada@example.com", undefined);
    await expect(reserveUnique(driver, "user", "f-email", 2, "ada@example.com", undefined)).rejects.toBeInstanceOf(UniqueConflictError);

    await releaseUnique(driver, "user", "f-email", 1, "ada@example.com");
    await expect(reserveUnique(driver, "user", "f-email", 2, "ada@example.com", undefined)).resolves.toBeUndefined();
  });

  it("lets the SAME id re-reserve its own current value (no self-conflict)", async () => {
    const driver = freshDriver();
    await reserveUnique(driver, "user", "f-email", 1, "ada@example.com", undefined);
    await expect(reserveUnique(driver, "user", "f-email", 1, "ada@example.com", "ada@example.com")).resolves.toBeUndefined();
  });

  it("releases the old value and reserves the new one on an update", async () => {
    const driver = freshDriver();
    await reserveUnique(driver, "user", "f-email", 1, "old@example.com", undefined);
    await reserveUnique(driver, "user", "f-email", 1, "new@example.com", "old@example.com");
    await expect(reserveUnique(driver, "user", "f-email", 2, "old@example.com", undefined)).resolves.toBeUndefined();
  });
});

describe("patchReverseIndex", () => {
  it("adds and removes source ids from a target's reverse list", async () => {
    const driver = freshDriver();
    await patchReverseIndex(driver, "post", "f-tags", 10, [], [1, 2]);
    expect(await readReverseTargets(driver, "post", "f-tags", 1)).toEqual([10]);
    expect(await readReverseTargets(driver, "post", "f-tags", 2)).toEqual([10]);

    await patchReverseIndex(driver, "post", "f-tags", 10, [1, 2], [2]);
    expect(await readReverseTargets(driver, "post", "f-tags", 1)).toEqual([]);
    expect(await readReverseTargets(driver, "post", "f-tags", 2)).toEqual([10]);
  });

  it("allows multiple sources to share one target when not exclusive", async () => {
    const driver = freshDriver();
    await patchReverseIndex(driver, "post", "f-tags", 10, [], [5]);
    await patchReverseIndex(driver, "post", "f-tags", 11, [], [5]);
    expect(await readReverseTargets(driver, "post", "f-tags", 5)).toEqual([10, 11]);
  });

  it("rejects a second source claiming an already-claimed target when exclusive, without writing anything", async () => {
    const driver = freshDriver();
    await patchReverseIndex(driver, "cart", "f-items", 100, [], [5], true);
    await expect(patchReverseIndex(driver, "cart", "f-items", 200, [], [5], true)).rejects.toBeInstanceOf(RelationTargetClaimedError);
    expect(await readReverseTargets(driver, "cart", "f-items", 5)).toEqual([100]);
  });

  it("allows the SAME source to keep its own exclusive claim across an update", async () => {
    const driver = freshDriver();
    await patchReverseIndex(driver, "cart", "f-items", 100, [], [5], true);
    await expect(patchReverseIndex(driver, "cart", "f-items", 100, [5], [5], true)).resolves.toBeUndefined();
  });
});
