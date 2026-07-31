import { describe, expect, it } from "vitest";
import { applyRecursiveFolderTotals } from "./aggregate.js";
import type { StorageStatEntry } from "./types.js";

const file = (path: string, size: number): StorageStatEntry => ({
  path,
  name: path.split("/").pop()!,
  kind: "file",
  size,
  modifiedAt: "2026-01-01T00:00:00.000Z",
});

const folder = (path: string): StorageStatEntry => ({
  path,
  name: path.split("/").pop()!,
  kind: "folder",
  size: 0,
  fileCount: 0,
  modifiedAt: "2026-01-01T00:00:00.000Z",
});

describe("applyRecursiveFolderTotals", () => {
  it("sums every descendant file at every depth into each ancestor folder, counting files only", () => {
    const entries = [
      folder("docs"),
      file("docs/a.txt", 5),
      folder("docs/nested"),
      file("docs/nested/deep.txt", 4),
      folder("docs/nested/deeper"),
      file("docs/nested/deeper/x.txt", 1),
      file("top.txt", 100),
    ];

    const result = applyRecursiveFolderTotals(entries);

    expect(result.find((e) => e.path === "docs")).toMatchObject({ size: 10, fileCount: 3 });
    expect(result.find((e) => e.path === "docs/nested")).toMatchObject({ size: 5, fileCount: 2 });
    expect(result.find((e) => e.path === "docs/nested/deeper")).toMatchObject({ size: 1, fileCount: 1 });
  });

  it("an empty folder totals to zero", () => {
    const result = applyRecursiveFolderTotals([folder("empty")]);
    expect(result[0]).toMatchObject({ size: 0, fileCount: 0 });
  });

  it("sibling subtrees don't leak into each other's totals", () => {
    const entries = [
      folder("a"),
      file("a/x.txt", 3),
      folder("b"),
      file("b/y.txt", 7),
    ];
    const result = applyRecursiveFolderTotals(entries);
    expect(result.find((e) => e.path === "a")).toMatchObject({ size: 3, fileCount: 1 });
    expect(result.find((e) => e.path === "b")).toMatchObject({ size: 7, fileCount: 1 });
  });

  it("mutates and returns the same array", () => {
    const entries = [folder("docs"), file("docs/a.txt", 5)];
    expect(applyRecursiveFolderTotals(entries)).toBe(entries);
  });

  it("a file with no known size (GitLab's list()/listAll(), which never resolve it) contributes 0, not NaN", () => {
    const noSize: StorageStatEntry = { path: "docs/a.txt", name: "a.txt", kind: "file" };
    const entries = [folder("docs"), noSize, file("docs/b.txt", 5)];

    const result = applyRecursiveFolderTotals(entries);

    expect(result.find((e) => e.path === "docs")).toMatchObject({ size: 5, fileCount: 2 });
  });
});
