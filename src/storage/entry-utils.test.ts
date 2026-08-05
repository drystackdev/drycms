import { describe, expect, it } from "vitest";
import type { FileEntry } from "./entry-types.js";
import { formatDate, retargetSubtree } from "./entry-utils.js";

const folder = (id: string, parentId: string | null): FileEntry => ({
  id,
  name: id.split("/").pop()!,
  parentId,
  kind: "folder",
  size: 0,
  fileCount: 0,
  modifiedAt: "2026-01-01T00:00:00.000Z",
});

const file = (id: string, parentId: string | null): FileEntry => ({
  id,
  name: id.split("/").pop()!,
  parentId,
  kind: "file",
  ext: "txt",
  size: 1,
  modifiedAt: "2026-01-01T00:00:00.000Z",
});

describe("retargetSubtree", () => {
  it("rewrites a single file's id/parentId/name", () => {
    const entries = [file("docs/a.txt", "docs")];
    const result = retargetSubtree(entries, "docs/a.txt", "archive", "b.txt");
    expect(result).toEqual([{ ...entries[0], id: "archive/b.txt", parentId: "archive", name: "b.txt" }]);
  });

  it("rewrites a moved folder and every nested descendant's id/parentId", () => {
    const entries = [
      folder("docs", null),
      file("docs/a.txt", "docs"),
      folder("docs/nested", "docs"),
      file("docs/nested/deep.txt", "docs/nested"),
      file("unrelated.txt", null),
    ];
    const result = retargetSubtree(entries, "docs", "archive", "docs");

    expect(result.find((e) => e.name === "docs" && e.kind === "folder")).toMatchObject({
      id: "archive/docs",
      parentId: "archive",
    });
    expect(result.find((e) => e.id === "archive/docs/a.txt")).toMatchObject({ parentId: "archive/docs" });
    expect(result.find((e) => e.id === "archive/docs/nested")).toMatchObject({ parentId: "archive/docs" });
    expect(result.find((e) => e.id === "archive/docs/nested/deep.txt")).toMatchObject({
      parentId: "archive/docs/nested",
    });
    // Untouched sibling.
    expect(result.find((e) => e.id === "unrelated.txt")).toEqual(entries[4]);
  });

  it("renaming in place (same parent, new name) only rewrites the one entry and its descendants' prefix", () => {
    const entries = [folder("docs", null), file("docs/a.txt", "docs")];
    const result = retargetSubtree(entries, "docs", null, "documents");
    expect(result.find((e) => e.kind === "folder")).toMatchObject({ id: "documents", name: "documents" });
    expect(result.find((e) => e.kind === "file")).toMatchObject({ id: "documents/a.txt", parentId: "documents" });
  });

  it("moving to the root (newParentId null) produces a bare-name id", () => {
    const entries = [folder("docs/nested", "docs")];
    const result = retargetSubtree(entries, "docs/nested", null, "nested");
    expect(result[0]).toMatchObject({ id: "nested", parentId: null });
  });

  it("is a no-op when the id doesn't exist, or when the destination equals the source", () => {
    const entries = [file("a.txt", null)];
    expect(retargetSubtree(entries, "missing", null, "x")).toBe(entries);
    expect(retargetSubtree(entries, "a.txt", null, "a.txt")).toBe(entries);
  });
});

describe("formatDate", () => {
  it("formats a real ISO timestamp into locale date/time strings", () => {
    const result = formatDate("2026-01-01T00:00:00.000Z");
    expect(result.date).not.toBe("");
    expect(result.time).not.toBe("");
  });

  it("renders blank, not 'Invalid Date', when a backend doesn't resolve modifiedAt", () => {
    expect(formatDate(undefined)).toEqual({ date: "", time: "" });
  });
});
