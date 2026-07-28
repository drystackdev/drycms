import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createFileDriver, safePathSegment } from "./file-driver.js";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function freshDriver() {
  const dir = mkdtempSync(join(tmpdir(), "drycms-file-driver-test-"));
  dirs.push(dir);
  return { driver: createFileDriver({ engine: "file" as const, kind: "local" as const, root: dir }), dir };
}

describe("safePathSegment", () => {
  it("accepts a plain identifier", () => {
    expect(safePathSegment("posts")).toBe("posts");
  });

  it.each(["../escape", "a/b", "a\\b", ".", ".."])("rejects %j", (bad) => {
    expect(() => safePathSegment(bad)).toThrow();
  });
});

describe("createFileDriver", () => {
  it("round-trips a JSON value and reports missing paths as null", async () => {
    const { driver } = freshDriver();
    expect(await driver.readJson("data/posts/1.json")).toBeNull();

    await driver.writeJson("data/posts/1.json", { id: 1, title: "Hello" });
    expect(await driver.readJson("data/posts/1.json")).toEqual({ id: 1, title: "Hello" });

    await driver.writeJson("data/posts/1.json", { id: 1, title: "Updated" });
    expect(await driver.readJson("data/posts/1.json")).toEqual({ id: 1, title: "Updated" });
  });

  it("never leaves a stray .tmp file behind after a local atomic write", async () => {
    const { driver, dir } = freshDriver();
    await driver.writeJson("data/posts/1.json", { id: 1 });
    const names = readdirSync(join(dir, "data", "posts"));
    expect(names).toEqual(["1.json"]);
  });

  it("lists JSON file basenames, sorted, and returns [] for a folder that doesn't exist yet", async () => {
    const { driver } = freshDriver();
    expect(await driver.listJsonFiles("data/posts")).toEqual([]);

    await driver.writeJson("data/posts/2.json", {});
    await driver.writeJson("data/posts/1.json", {});
    expect(await driver.listJsonFiles("data/posts")).toEqual(["1", "2"]);
  });

  it("removeJson/removeDir are no-ops (not errors) when the path doesn't exist", async () => {
    const { driver } = freshDriver();
    await expect(driver.removeJson("data/posts/1.json")).resolves.toBeUndefined();
    await expect(driver.removeDir("data/posts")).resolves.toBeUndefined();
  });

  it("withLock serializes concurrent callers sharing the same key, in submission order", async () => {
    const { driver } = freshDriver();
    const order: number[] = [];
    const tasks = [1, 2, 3].map((n) =>
      driver.withLock("k", async () => {
        order.push(n);
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push(-n);
      }),
    );
    await Promise.all(tasks);
    // Fully serialized: each task's start/end pair must be contiguous, never
    // interleaved with another task's.
    expect(order).toEqual([1, -1, 2, -2, 3, -3]);
  });

  it("withLock keyed differently runs concurrently, not serialized", async () => {
    const { driver } = freshDriver();
    const order: string[] = [];
    await Promise.all([
      driver.withLock("a", async () => {
        order.push("a-start");
        await new Promise((resolve) => setTimeout(resolve, 10));
        order.push("a-end");
      }),
      driver.withLock("b", async () => {
        order.push("b-start");
        order.push("b-end");
      }),
    ]);
    // "b" (no delay) finishes entirely before "a"'s delayed end, proving they
    // ran concurrently rather than queued behind one shared lock.
    expect(order.indexOf("b-end")).toBeLessThan(order.indexOf("a-end"));
  });

  it("a failed withLock callback doesn't wedge the queue for later callers", async () => {
    const { driver } = freshDriver();
    await expect(
      driver.withLock("k", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    let ran = false;
    await driver.withLock("k", async () => {
      ran = true;
    });
    expect(ran).toBe(true);
  });
});
