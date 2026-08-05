import { describe, expect, it } from "vitest";
import { buildComponentTree, filterComponentTree } from "./tree.js";
import type { FileEntry } from "../storage/entry-types.js";

function file(id: string, parentId: string | null): FileEntry {
  const name = id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
  return { id, name, parentId, kind: "file" };
}

function folder(id: string, parentId: string | null): FileEntry {
  const name = id.includes("/") ? id.slice(id.lastIndexOf("/") + 1) : id;
  return { id, name, parentId, kind: "folder" };
}

describe("buildComponentTree", () => {
  it("nests entries by parentId, folders before files, alphabetical within each kind", () => {
    const entries: FileEntry[] = [
      file("Zebra.tsx", null),
      file("Apple.tsx", null),
      folder("widgets", null),
      file("widgets/Button.tsx", "widgets"),
    ];
    const tree = buildComponentTree(entries);
    expect(tree.map((n) => n.entry.id)).toEqual(["widgets", "Apple.tsx", "Zebra.tsx"]);
    expect(tree[0]!.children.map((n) => n.entry.id)).toEqual(["widgets/Button.tsx"]);
  });
});

describe("filterComponentTree", () => {
  const entries: FileEntry[] = [
    folder("layout", null),
    file("layout/Header.tsx", "layout"),
    file("layout/Footer.tsx", "layout"),
    file("Button.tsx", null),
    folder("widgets", null),
    file("widgets/Card.tsx", "widgets"),
  ];
  const tree = buildComponentTree(entries);

  it("returns the tree unchanged for an empty query", () => {
    expect(filterComponentTree(tree, "")).toEqual({ nodes: tree, matchedFolderIds: new Set() });
  });

  it("keeps a matching file and drops non-matching siblings", () => {
    const { nodes } = filterComponentTree(tree, "button");
    expect(nodes.map((n) => n.entry.id)).toEqual(["Button.tsx"]);
  });

  it("keeps only matching descendants under a non-matching ancestor folder, and marks it as matched", () => {
    const { nodes, matchedFolderIds } = filterComponentTree(tree, "header");
    const layoutNode = nodes.find((n) => n.entry.id === "layout");
    expect(layoutNode?.children.map((n) => n.entry.id)).toEqual(["layout/Header.tsx"]);
    expect(matchedFolderIds.has("layout")).toBe(true);
  });

  it("keeps a whole subtree unfiltered when the folder itself matches", () => {
    const { nodes } = filterComponentTree(tree, "layout");
    const layoutNode = nodes.find((n) => n.entry.id === "layout");
    expect(layoutNode?.children.map((n) => n.entry.id)).toEqual(["layout/Footer.tsx", "layout/Header.tsx"]);
  });
});
