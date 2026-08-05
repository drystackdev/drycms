import { describe, expect, it } from "vitest";
import type { FileEntry } from "../storage/entry-types.js";
import { createMemoryFileSource } from "./file-manager.js";

const seed: FileEntry[] = [
  { id: "Docs", name: "Docs", parentId: null, kind: "folder", size: 0, modifiedAt: "2026-01-01T00:00:00.000Z" },
  { id: "Docs/a.txt", name: "a.txt", parentId: "Docs", kind: "file", ext: "txt", size: 5, modifiedAt: "2026-01-01T00:00:00.000Z" },
  { id: "notes.txt", name: "notes.txt", parentId: null, kind: "file", ext: "txt", size: 3, modifiedAt: "2026-01-01T00:00:00.000Z" },
];

function makeFile(name: string, content = "x", type = "text/plain"): File {
  return new File([content], name, { type });
}

describe("createMemoryFileSource", () => {
  it("list() returns a folder's immediate children, excluding .dir markers", async () => {
    const source = createMemoryFileSource(seed);
    expect(await source.list(null)).toEqual([
      expect.objectContaining({ id: "Docs" }),
      expect.objectContaining({ id: "notes.txt" }),
    ]);
    expect(await source.list("Docs")).toEqual([expect.objectContaining({ id: "Docs/a.txt" })]);
  });

  it("listAll() flattens every entry at every depth, excluding .dir markers", async () => {
    const source = createMemoryFileSource(seed);
    const all = await source.listAll!();
    expect(all.map((e) => e.id).sort()).toEqual(["Docs", "Docs/a.txt", "notes.txt"]);
  });

  it("each source instance is independent - mutating one never touches another", async () => {
    const a = createMemoryFileSource(seed);
    const b = createMemoryFileSource(seed);
    await a.createFolder!(null, "New");
    expect(await a.list(null)).toHaveLength(3);
    expect(await b.list(null)).toHaveLength(2);
  });

  it("upload() adds files under the target folder and auto-suffixes a collision", async () => {
    const source = createMemoryFileSource(seed);
    const [added] = await source.upload!("Docs", [makeFile("a.txt")]);
    expect(added).toMatchObject({ id: "Docs/a copy.txt", name: "a copy.txt" });
    expect(await source.list("Docs")).toHaveLength(2);
  });

  it("createFolder() is hidden-marker-backed but shows up empty via list()", async () => {
    const source = createMemoryFileSource(seed);
    const created = await source.createFolder!(null, "Archive");
    expect(created).toMatchObject({ id: "Archive", kind: "folder" });
    expect(await source.list("Archive")).toEqual([]);
  });

  it("move() keeps the same name and rejects a colliding destination", async () => {
    const source = createMemoryFileSource(seed);
    const [moved] = await source.move!(["notes.txt"], "Docs");
    expect(moved).toMatchObject({ id: "Docs/notes.txt", name: "notes.txt", parentId: "Docs" });

    // "Docs" already has an "a.txt" - moving the root-level file there should collide.
    await source.upload!(null, [makeFile("a.txt")]);
    await expect(source.move!(["a.txt"], "Docs")).rejects.toThrow();
  });

  it("move() rewrites every descendant's id/parentId when moving a folder", async () => {
    const source = createMemoryFileSource([
      { id: "A", name: "A", parentId: null, kind: "folder", size: 0, modifiedAt: "2026-01-01T00:00:00.000Z" },
      { id: "B", name: "B", parentId: null, kind: "folder", size: 0, modifiedAt: "2026-01-01T00:00:00.000Z" },
      { id: "A/Sub", name: "Sub", parentId: "A", kind: "folder", size: 0, modifiedAt: "2026-01-01T00:00:00.000Z" },
      { id: "A/Sub/deep.txt", name: "deep.txt", parentId: "A/Sub", kind: "file", ext: "txt", size: 1, modifiedAt: "2026-01-01T00:00:00.000Z" },
    ]);

    await source.move!(["A/Sub"], "B");

    expect(await source.list("B")).toEqual([expect.objectContaining({ id: "B/Sub" })]);
    expect(await source.list("B/Sub")).toEqual([expect.objectContaining({ id: "B/Sub/deep.txt" })]);
    expect(await source.list("A")).toEqual([]);
  });

  it("copy() duplicates recursively, leaving the source untouched, auto-suffixing same-folder copies", async () => {
    const source = createMemoryFileSource(seed);
    const [copied] = await source.copy!(["Docs"], null);
    expect(copied).toMatchObject({ id: "Docs copy", kind: "folder" });
    expect(await source.list("Docs copy")).toEqual([expect.objectContaining({ id: "Docs copy/a.txt" })]);
    expect(await source.list("Docs")).toEqual([expect.objectContaining({ id: "Docs/a.txt" })]);
  });

  it("remove() deletes recursively", async () => {
    const source = createMemoryFileSource(seed);
    await source.remove!(["Docs"]);
    expect(await source.list(null)).toEqual([expect.objectContaining({ id: "notes.txt" })]);
  });

  it("rename() changes the name/id and rejects a colliding sibling name", async () => {
    const source = createMemoryFileSource(seed);
    const renamed = await source.rename!("notes.txt", "todo.txt");
    expect(renamed).toMatchObject({ id: "todo.txt", name: "todo.txt", parentId: null });

    await source.upload!(null, [makeFile("dup.txt")]);
    await expect(source.rename!("todo.txt", "dup.txt")).rejects.toThrow();
  });

  it("replace() overwrites size/modifiedAt in place, keeping the same id", async () => {
    const source = createMemoryFileSource(seed);
    const updated = await source.replace!("notes.txt", makeFile("notes.txt", "much longer content"));
    expect(updated.id).toBe("notes.txt");
    expect(updated.size).toBe("much longer content".length);
  });
});
