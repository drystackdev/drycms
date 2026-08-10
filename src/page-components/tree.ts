import type { FileEntry } from "../storage/entry-types.js";
import { PAGES_ROOT, PAGES_SOURCE_ROOTS } from "../server/app-router/source-roots.js";

/**
 * The entries one Page Editor sidebar tab shows (`plans/component.md` mục 3).
 *
 * `id` is deliberately left as the FULL storage path (`pages/blogs/page.tsx`)
 * - only the tree's SHAPE is rebased: the root folder's own entry is dropped
 * and its direct children re-parented to the tree root, so the tab starts
 * inside `pages/`/`component/` without an extra folder level. Rewriting ids
 * instead would mean re-prefixing them again in every save/move/delete
 * handler and in the `?file=` URL param, for a purely cosmetic gain.
 *
 * The `pages` tab also absorbs anything that belongs to NO known root - a
 * store predating the root split can have files sitting at the storage root,
 * and hiding them from the only UI that can edit them would be worse than
 * showing them one level up.
 */
export function entriesForSourceRoot(entries: FileEntry[], rootId: string): FileEntry[] {
  const otherRootIds = PAGES_SOURCE_ROOTS.map((root) => root.id).filter((id) => id !== rootId);
  const isOtherRoot = (path: string) => otherRootIds.some((id) => path === id || path.startsWith(`${id}/`));
  const inThisRoot = (path: string) => path === rootId || path.startsWith(`${rootId}/`);

  return entries
    .filter((entry) => {
      if (entry.id === rootId) return false;
      if (isOtherRoot(entry.id)) return false;
      // Only the `pages` tab keeps unrooted leftovers (see doc comment).
      return inThisRoot(entry.id) || rootId === PAGES_ROOT;
    })
    .map((entry) => (entry.parentId === rootId ? { ...entry, parentId: null } : entry));
}

/** Prefixes a path typed at a tab's tree ROOT with that tab's source root -
 * `ComponentTreePanel` builds a create/move target out of the (rebased) tree
 * position, which is empty at the root, so the root folder has to be put
 * back before the path reaches storage. A path already inside the root (from
 * a nested folder) is returned unchanged. */
export function withSourceRoot(rootId: string, path: string): string {
  if (path === rootId || path.startsWith(`${rootId}/`)) return path;
  return `${rootId}/${path}`;
}

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

/** Every FILE id in the exact top-to-bottom order the tree renders them,
 * skipping the contents of a collapsed folder. This is the order a
 * Shift+click range is measured in (`ComponentTreePanel`) - "everything
 * between these two rows" has to mean what's on screen between them, not
 * what's between them in the underlying entry list, which is neither sorted
 * nor aware of which folders are open. Folder rows are excluded: they aren't
 * part of a selection (only files are copyable/openable), so including them
 * would make a range look like it skipped rows the user did see. */
export function flattenVisibleFilePaths(
  nodes: ComponentTreeNode[],
  isOpen: (id: string) => boolean,
): string[] {
  const paths: string[] = [];
  function walk(list: ComponentTreeNode[]): void {
    for (const node of list) {
      if (node.entry.kind === "file") {
        paths.push(node.entry.id);
      } else if (isOpen(node.entry.id)) {
        walk(node.children);
      }
    }
  }
  walk(nodes);
  return paths;
}

/** Where a copied file lands when pasted into `destFolder` (both `sourcePath`
 * and `destFolder` are FULL storage paths, `""` = storage root): its own name
 * if that's free, else `Button copy.tsx`, `Button copy 2.tsx`, ... Pasting
 * into a different folder therefore keeps the original name, which is the
 * whole point of the gesture ("the same component, over there"); only a real
 * collision renames.
 *
 * Splits on the FIRST dot, not the last - `Card.test.tsx` has to become
 * `Card copy.test.tsx`, not `Card.test copy.tsx`, and a leading-dot name
 * (`.keep`) has no base to suffix, so it's treated as all-extension. */
export function copyDestinationPath(
  existingPaths: ReadonlySet<string>,
  destFolder: string,
  sourcePath: string,
): string {
  const name = sourcePath.slice(sourcePath.lastIndexOf("/") + 1);
  const join = (candidate: string) => (destFolder ? `${destFolder}/${candidate}` : candidate);
  if (!existingPaths.has(join(name))) return join(name);

  const dot = name.indexOf(".", 1);
  const base = dot === -1 ? name : name.slice(0, dot);
  const extension = dot === -1 ? "" : name.slice(dot);
  for (let n = 1; ; n += 1) {
    const candidate = join(n === 1 ? `${base} copy${extension}` : `${base} copy ${n}${extension}`);
    if (!existingPaths.has(candidate)) return candidate;
  }
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
