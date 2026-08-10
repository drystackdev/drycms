import { describe, expect, it } from "vitest";
import { buildComponentTree, entriesForSourceRoot, filterComponentTree, withSourceRoot } from "./tree.js";
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

describe("entriesForSourceRoot", () => {
  const entries: FileEntry[] = [
    { id: "pages", name: "pages", parentId: null, kind: "folder" },
    { id: "pages/page.tsx", name: "page.tsx", parentId: "pages", kind: "file" },
    { id: "pages/blogs", name: "blogs", parentId: "pages", kind: "folder" },
    { id: "pages/blogs/page.tsx", name: "page.tsx", parentId: "pages/blogs", kind: "file" },
    { id: "component", name: "component", parentId: null, kind: "folder" },
    { id: "component/Card.tsx", name: "Card.tsx", parentId: "component", kind: "file" },
    // Predates the root split - belongs to no root at all.
    { id: "stray.tsx", name: "stray.tsx", parentId: null, kind: "file" },
  ];

  it("keeps full paths as ids but re-parents the root's direct children to the tree root", () => {
    const pages = entriesForSourceRoot(entries, "pages");
    expect(pages.map((entry) => entry.id)).toEqual(["pages/page.tsx", "pages/blogs", "pages/blogs/page.tsx", "stray.tsx"]);
    expect(pages.find((entry) => entry.id === "pages/page.tsx")!.parentId).toBeNull();
    // A deeper file keeps its real parent, so the tree still nests.
    expect(pages.find((entry) => entry.id === "pages/blogs/page.tsx")!.parentId).toBe("pages/blogs");
  });

  it("shows only that root's own files in another tab", () => {
    expect(entriesForSourceRoot(entries, "component").map((entry) => entry.id)).toEqual(["component/Card.tsx"]);
  });
});

describe("withSourceRoot", () => {
  it("prefixes a path typed at the tab's own tree root", () => {
    expect(withSourceRoot("component", "Card.tsx")).toBe("component/Card.tsx");
  });

  it("leaves a path that already names the root alone", () => {
    expect(withSourceRoot("pages", "pages/blogs/page.tsx")).toBe("pages/blogs/page.tsx");
  });
});
