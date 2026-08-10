import { describe, expect, it } from "vitest";
import {
  buildComponentTree,
  copyDestinationPath,
  entriesForSourceRoot,
  filterComponentTree,
  flattenVisibleFilePaths,
  withSourceRoot,
} from "./tree.js";
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

describe("flattenVisibleFilePaths", () => {
  const tree = buildComponentTree([
    folder("layout", null),
    file("layout/Header.tsx", "layout"),
    file("layout/Footer.tsx", "layout"),
    file("Button.tsx", null),
    file("Alert.tsx", null),
  ]);

  it("lists files in render order - folders first, then alphabetical, folder rows themselves excluded", () => {
    expect(flattenVisibleFilePaths(tree, () => true)).toEqual([
      "layout/Footer.tsx",
      "layout/Header.tsx",
      "Alert.tsx",
      "Button.tsx",
    ]);
  });

  it("skips a collapsed folder's children - they aren't on screen, so a range can't cross them", () => {
    expect(flattenVisibleFilePaths(tree, (id) => id !== "layout")).toEqual(["Alert.tsx", "Button.tsx"]);
  });
});

describe("copyDestinationPath", () => {
  const existing = new Set(["component/Button.tsx", "component/Button copy.tsx", "component/ui/Card.test.tsx"]);

  it("keeps the original name when pasting into a folder that doesn't have it", () => {
    expect(copyDestinationPath(existing, "component/ui", "component/Button.tsx")).toBe("component/ui/Button.tsx");
  });

  it("suffixes past every taken copy on a collision", () => {
    expect(copyDestinationPath(existing, "component", "component/Button.tsx")).toBe("component/Button copy 2.tsx");
  });

  it("splits on the first dot so a multi-part extension survives", () => {
    expect(copyDestinationPath(existing, "component/ui", "component/ui/Card.test.tsx")).toBe(
      "component/ui/Card copy.test.tsx",
    );
  });

  it("pastes at the storage root without a leading slash", () => {
    expect(copyDestinationPath(new Set(["Button.tsx"]), "", "component/Button.tsx")).toBe("Button copy.tsx");
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
