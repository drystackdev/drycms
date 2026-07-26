import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLocalStorageAdapter } from "./local.js";
import { StorageError, type StorageAdapter } from "./types.js";

let dir: string;
let adapter: StorageAdapter;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "drycms-storage-"));
  adapter = createLocalStorageAdapter(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("createLocalStorageAdapter", () => {
  it("lists an empty root as an empty array", async () => {
    expect(await adapter.list("")).toEqual([]);
  });

  it("mkdir creates a folder with a hidden .dir marker, excluded from list()", async () => {
    const entry = await adapter.mkdir("docs");
    expect(entry).toMatchObject({ path: "docs", name: "docs", kind: "folder", fileCount: 0 });

    const listed = await adapter.list("");
    expect(listed).toEqual([expect.objectContaining({ path: "docs", kind: "folder" })]);
    expect(await readFile(join(dir, "docs", ".dir"), "utf8")).toBe("");
  });

  it("mkdir rejects a collision", async () => {
    await adapter.mkdir("docs");
    await expect(adapter.mkdir("docs")).rejects.toMatchObject({ code: "already_exists" });
  });

  it("write creates a file and reports its size", async () => {
    const entry = await adapter.write("notes.txt", new TextEncoder().encode("hello"));
    expect(entry).toMatchObject({ path: "notes.txt", kind: "file", size: 5 });
  });

  it("write accepts a readable stream", async () => {
    const stream = Readable.from([Buffer.from("streamed")]);
    const entry = await adapter.write("stream.txt", stream);
    expect(entry.size).toBe(8);
  });

  it("write creates missing parent folders", async () => {
    await adapter.write("a/b/c.txt", new TextEncoder().encode("x"));
    const listed = await adapter.list("a/b");
    expect(listed).toEqual([expect.objectContaining({ path: "a/b/c.txt" })]);
  });

  it("write refuses to overwrite a folder", async () => {
    await adapter.mkdir("docs");
    await expect(adapter.write("docs", new Uint8Array())).rejects.toMatchObject({ code: "invalid_path" });
  });

  it("stat returns null for a missing path", async () => {
    expect(await adapter.stat("missing.txt")).toBeNull();
  });

  it("read streams a file's bytes", async () => {
    await adapter.write("notes.txt", new TextEncoder().encode("hello"));
    const result = await adapter.read("notes.txt");
    expect(result.size).toBe(5);
    const chunks: Buffer[] = [];
    for await (const chunk of result.stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString("utf8")).toBe("hello");
  });

  it("read rejects a missing file", async () => {
    await expect(adapter.read("missing.txt")).rejects.toMatchObject({ code: "not_found" });
  });

  it("read rejects a folder", async () => {
    await adapter.mkdir("docs");
    await expect(adapter.read("docs")).rejects.toMatchObject({ code: "invalid_path" });
  });

  it("folder size/fileCount reflect immediate children only", async () => {
    await adapter.mkdir("docs");
    await adapter.write("docs/a.txt", new TextEncoder().encode("12345"));
    await adapter.mkdir("docs/nested");
    await adapter.write("docs/nested/deep.txt", new TextEncoder().encode("ignored, not counted"));

    const stat = await adapter.stat("docs");
    expect(stat).toMatchObject({ size: 5, fileCount: 2 });
  });

  it("move renames atomically and rejects a colliding destination", async () => {
    await adapter.write("a.txt", new TextEncoder().encode("hi"));
    const moved = await adapter.move("a.txt", "b.txt");
    expect(moved.path).toBe("b.txt");
    expect(await adapter.stat("a.txt")).toBeNull();

    await adapter.write("c.txt", new TextEncoder().encode("hi"));
    await expect(adapter.move("b.txt", "c.txt")).rejects.toMatchObject({ code: "already_exists" });
  });

  it("move is recursive for folders", async () => {
    await adapter.mkdir("docs");
    await adapter.write("docs/a.txt", new TextEncoder().encode("hi"));
    await adapter.move("docs", "archive");
    expect(await adapter.stat("docs")).toBeNull();
    const listed = await adapter.list("archive");
    expect(listed).toEqual([expect.objectContaining({ path: "archive/a.txt" })]);
  });

  it("copy duplicates recursively, leaving the source untouched", async () => {
    await adapter.mkdir("docs");
    await adapter.write("docs/a.txt", new TextEncoder().encode("hi"));
    await adapter.copy("docs", "docs-copy");

    expect(await adapter.stat("docs/a.txt")).not.toBeNull();
    const listed = await adapter.list("docs-copy");
    expect(listed).toEqual([expect.objectContaining({ path: "docs-copy/a.txt" })]);
  });

  it("copy rejects a colliding destination", async () => {
    await adapter.write("a.txt", new TextEncoder().encode("hi"));
    await adapter.write("b.txt", new TextEncoder().encode("hi"));
    await expect(adapter.copy("a.txt", "b.txt")).rejects.toMatchObject({ code: "already_exists" });
  });

  it("remove deletes a file, and is recursive for folders", async () => {
    await adapter.write("a.txt", new TextEncoder().encode("hi"));
    await adapter.remove("a.txt");
    expect(await adapter.stat("a.txt")).toBeNull();

    await adapter.mkdir("docs");
    await adapter.write("docs/a.txt", new TextEncoder().encode("hi"));
    await adapter.remove("docs");
    expect(await adapter.stat("docs")).toBeNull();
  });

  it("remove rejects a missing path", async () => {
    await expect(adapter.remove("missing.txt")).rejects.toMatchObject({ code: "not_found" });
  });

  it("root-level operations are rejected", async () => {
    await expect(adapter.mkdir("")).rejects.toThrow(StorageError);
    await expect(adapter.remove("")).rejects.toThrow(StorageError);
    await expect(adapter.move("", "x")).rejects.toThrow(StorageError);
    await expect(adapter.copy("", "x")).rejects.toThrow(StorageError);
  });

  it("listAll flattens every file/folder at every depth, with recursive folder size/fileCount", async () => {
    await adapter.mkdir("docs");
    await adapter.write("docs/a.txt", new TextEncoder().encode("12345"));
    await adapter.mkdir("docs/nested");
    await adapter.write("docs/nested/deep.txt", new TextEncoder().encode("deep"));
    await adapter.write("top.txt", new TextEncoder().encode("x"));

    const all = await adapter.listAll!();
    const paths = all.map((entry) => entry.path).sort();
    expect(paths).toEqual(["docs", "docs/a.txt", "docs/nested", "docs/nested/deep.txt", "top.txt"]);
    // Unlike list()/stat() (immediate children only), listAll's "docs" totals
    // both its own a.txt (5) *and* nested/deep.txt (4) - a true recursive sum.
    expect(all.find((entry) => entry.path === "docs")).toMatchObject({ kind: "folder", size: 9, fileCount: 2 });
    expect(all.find((entry) => entry.path === "docs/nested")).toMatchObject({
      kind: "folder",
      size: 4,
      fileCount: 1,
    });
  });

  it("listAll on an empty root is an empty array", async () => {
    expect(await adapter.listAll!()).toEqual([]);
  });
});
