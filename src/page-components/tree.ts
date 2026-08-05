import type { FileEntry } from "../storage/entry-types.js";

export interface ComponentTreeNode {
  entry: FileEntry;
  children: ComponentTreeNode[];
}

/** Nests the flat `listAll()`-shaped entries `FileEntry.parentId` already
 * carries (see `storage/entry.ts`'s `toFileEntry`) into a real tree -
 * folders first, then alphabetical, at every level. */
export function buildComponentTree(entries: FileEntry[]): ComponentTreeNode[] {
  const byId = new Map<string, ComponentTreeNode>();
  for (const entry of entries) byId.set(entry.id, { entry, children: [] });

  const roots: ComponentTreeNode[] = [];
  for (const node of byId.values()) {
    const parent = node.entry.parentId ? byId.get(node.entry.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  function sort(nodes: ComponentTreeNode[]): void {
    nodes.sort((a, b) => {
      if (a.entry.kind !== b.entry.kind) return a.entry.kind === "folder" ? -1 : 1;
      return a.entry.name.localeCompare(b.entry.name);
    });
    for (const node of nodes) sort(node.children);
  }
  sort(roots);
  return roots;
}

export interface FilteredComponentTree {
  nodes: ComponentTreeNode[];
  /** Folder ids that must be force-expanded to reveal a match - both a
   * name-matched folder and every ancestor of a deeper match. */
  matchedFolderIds: Set<string>;
}

/** A file passes if its name matches; a folder passes (and keeps its WHOLE
 * subtree unfiltered) if its own name matches, otherwise only if some
 * descendant does (in which case only the matching descendants are kept) -
 * same "found it, show what's inside" vs. "still searching" split most
 * file-tree search UIs use. */
export function filterComponentTree(nodes: ComponentTreeNode[], query: string): FilteredComponentTree {
  const q = query.trim().toLowerCase();
  const matchedFolderIds = new Set<string>();
  if (!q) return { nodes, matchedFolderIds };

  function filterList(list: ComponentTreeNode[]): ComponentTreeNode[] {
    const result: ComponentTreeNode[] = [];
    for (const node of list) {
      const selfMatch = node.entry.name.toLowerCase().includes(q);
      if (node.entry.kind === "file") {
        if (selfMatch) result.push(node);
        continue;
      }
      if (selfMatch) {
        matchedFolderIds.add(node.entry.id);
        result.push(node);
        continue;
      }
      const filteredChildren = filterList(node.children);
      if (filteredChildren.length > 0) {
        matchedFolderIds.add(node.entry.id);
        result.push({ entry: node.entry, children: filteredChildren });
      }
    }
    return result;
  }

  return { nodes: filterList(nodes), matchedFolderIds };
}
