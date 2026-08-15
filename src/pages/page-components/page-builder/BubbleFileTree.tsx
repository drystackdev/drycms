import { useMemo, useState } from "preact/hooks";
import type { FileEntry } from "../../../storage/entry-types.js";
import { buildComponentTree, type ComponentTreeNode } from "../../../page-components/tree.js";
import { FolderBaseIcon, FolderBaseOpenIcon, fileIconForName } from "../file-type-icons.js";

export interface BubbleFileTreeProps {
  sourceByPath: Record<string, string>;
  activeRoot: string;
  onSelectFile: (path: string) => void;
}

/** Synthesizes `FileEntry[]` (id/name/kind/parentId) purely from a flat path
 * list, rebased the same way `tree.ts`'s `entriesForSourceRoot` rebases
 * Page Editor's real storage listing (the root's own entry dropped, its
 * direct children re-parented to the tree root) - Page Builder has no
 * storage listing of its own to rebase, only `use-page-builder-source.ts`'s
 * flat path->content map, so folders here are inferred purely from `/`
 * splits in the paths themselves. */
function buildEntries(paths: string[], rootId: string): FileEntry[] {
  const folderIds = new Set<string>();
  const entries: FileEntry[] = [];
  for (const path of paths) {
    const rel = path === rootId ? "" : path.slice(rootId.length + 1);
    if (!rel) continue;
    const parts = rel.split("/");
    let parentId: string | null = null;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const folderId = parts.slice(0, i + 1).join("/");
      if (!folderIds.has(folderId)) {
        folderIds.add(folderId);
        entries.push({ id: folderId, name: folderId.slice(folderId.lastIndexOf("/") + 1), kind: "folder", parentId });
      }
      parentId = folderId;
    }
    entries.push({ id: path, name: path.slice(path.lastIndexOf("/") + 1), kind: "file", parentId });
  }
  return entries;
}

/**
 * Read-only expandable folder tree for `BubbleMenu.tsx` - the same shape and
 * CSS Page Editor's own `ComponentTreePanel` sidebar uses
 * (`page-components-tree*`, `buildComponentTree`), minus every write
 * operation (create/rename/delete/move/paste) that popup doesn't need - Page
 * Builder edits one file at a time (`PageBuilder.tsx`'s mục 10 cut), it never
 * creates/deletes/reorganizes files from here.
 *
 * Deliberately does NOT attach `useOverlayScrollbars`, unlike most scrollable
 * panels in this app: `ComponentTreePanel` itself doesn't either (plain
 * native `.scroll`), and every OTHER `useOverlayScrollbars` call site keys its
 * `deps` on a boolean that flips once when a modal/dropdown first mounts its
 * scrollable content (see that hook's own doc comment) - never on a value
 * that keeps changing while the container stays mounted. `BubbleMenu.tsx`
 * used to key it on `activeRoot` (tab switch) instead, which reruns the
 * hook's destroy+reinit effect against a container Preact is SIMULTANEOUSLY
 * re-rendering different children into - the real cause of a live
 * `insertBefore ... not a child of this node` crash the first time anyone
 * switched tabs (reproduced switching to the "md" tab, but not specific to
 * it - any tab switch hit it).
 */
export default function BubbleFileTree(props: BubbleFileTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const tree = useMemo(() => {
    const paths = Object.keys(props.sourceByPath).filter(
      (path) => path === props.activeRoot || path.startsWith(`${props.activeRoot}/`),
    );
    return buildComponentTree(buildEntries(paths, props.activeRoot));
  }, [props.sourceByPath, props.activeRoot]);

  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (tree.length === 0) return <p class="hint">No files here yet.</p>;

  return (
    <div class="page-components-tree scroll">
      <BubbleFileTreeList nodes={tree} collapsed={collapsed} onToggle={toggle} onSelectFile={props.onSelectFile} />
    </div>
  );
}

function BubbleFileTreeList(props: {
  nodes: ComponentTreeNode[];
  collapsed: Set<string>;
  onToggle: (id: string) => void;
  onSelectFile: (path: string) => void;
}) {
  return (
    <>
      {props.nodes.map((node) => {
        const entry = node.entry;
        const open = entry.kind === "folder" && !props.collapsed.has(entry.id);
        return (
          <div key={entry.id}>
            <div class="page-components-tree-row">
              {entry.kind === "folder" ? (
                <button
                  type="button"
                  class="page-components-tree-chevron"
                  aria-expanded={open}
                  aria-label={open ? `Collapse ${entry.name}` : `Expand ${entry.name}`}
                  onClick={() => props.onToggle(entry.id)}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                    <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.343 6.343L15 12l-5.657 5.657" />
                  </svg>
                </button>
              ) : (
                <span class="page-components-tree-chevron-spacer" />
              )}
              {entry.kind === "folder" ? open ? <FolderBaseOpenIcon /> : <FolderBaseIcon /> : fileIconForName(entry.name)}
              <button
                type="button"
                class="page-components-tree-item"
                onClick={() => (entry.kind === "folder" ? props.onToggle(entry.id) : props.onSelectFile(entry.id))}
              >
                <span>{entry.name}</span>
              </button>
            </div>
            {entry.kind === "folder" && open && node.children.length > 0 && (
              <div class="page-components-tree-children">
                <BubbleFileTreeList nodes={node.children} collapsed={props.collapsed} onToggle={props.onToggle} onSelectFile={props.onSelectFile} />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
