import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { FileEntry } from "../../../storage/entry-types.js";
import { buildComponentTree, type ComponentTreeNode } from "../../../page-components/tree.js";
import { FolderBaseIcon, FolderBaseOpenIcon, fileIconForName } from "../file-type-icons.js";
import { RenameIcon, TrashIcon } from "../../../components/icons/index.js";
import ContextMenu from "../../../components/ContextMenu.js";
import type { PopoverMenuEntry } from "../../../components/Popover.js";
import { PAGES_ROOT, STYLES_ROOT, MD_ROOT } from "../../../server/app-router/source-roots.js";
import { useOverlayScrollbars } from "../../../hooks/overlayscrollbars.js";
import { toast } from "../../../components/Toast.js";

export interface BubbleFileTreeProps {
  sourceByPath: Record<string, string>;
  activeRoot: string;
  activePath: string | null;
  onSelectFile: (path: string) => void;
  onCreateFile: (path: string, code: string) => Promise<void>;
  /** Move/rename one FILE - also the primitive drag & drop lands a file on. */
  onRenameFile: (from: string, to: string) => Promise<void>;
  onDeleteFile: (path: string) => void;
  /** `false` hides "Delete" entirely for that path (built-in style files,
   * which storage refuses to delete anyway). */
  canDelete: (path: string) => boolean;
  /** Bumped by `BubbleMenu.tsx`'s header "+" button - a plain counter rather
   * than a callback prop, since the actual create UI (which folder it lands
   * in, the inline text box) is this component's own business, not
   * something the header button can drive directly. */
  createSignal: number;
}

/** The extension `routes/pages-source.ts`'s `requirePageSourceFileName`
 * accepts for each root - offered as the default so the common case is one
 * word typed, not a path with an extension the server would reject. */
function defaultExtension(rootId: string): string {
  if (rootId === STYLES_ROOT) return ".css";
  if (rootId === MD_ROOT) return ".md";
  return ".tsx";
}

/** Starter content for a brand new file, so a just-created page/component
 * renders something instead of failing the build on an empty module. */
function fileTemplate(rootId: string, path: string): string {
  if (rootId === STYLES_ROOT || rootId === MD_ROOT) return "";
  const leaf = path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
  if (rootId === PAGES_ROOT) {
    if (leaf === "layout") return `export default function Layout({ children }: { children?: unknown }) {\n  return <div>{children}</div>;\n}\n`;
    return `export default function Page() {\n  return <main>New page</main>;\n}\n`;
  }
  const componentName = /^[A-Za-z_][\w]*$/.test(leaf) ? leaf : "Component";
  return `export default function ${componentName}() {\n  return <div>${componentName}</div>;\n}\n`;
}

function parentOfFullPath(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** Synthesizes `FileEntry[]` (id/name/kind/parentId) purely from a flat path
 * list, rebased the same way `tree.ts`'s `entriesForSourceRoot` rebases
 * Page Editor's real storage listing (the root's own entry dropped, its
 * direct children re-parented to the tree root) - Page Builder has no
 * storage listing of its own to rebase, only `use-page-builder-source.ts`'s
 * flat path->content map, so folders here are inferred purely from `/`
 * splits in the paths themselves. A FOLDER's `id` is therefore only the
 * path relative to `rootId` (e.g. `"blog"`), never a real storage path -
 * only file ids are (`"pages/blog/page.tsx"`), since only files are real
 * addressable storage entries this component can rename/delete/move. */
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

/** `dataTransfer` MIME type a drag started by this tree tags itself with -
 * distinguishes "a row from this tree" from an unrelated OS-level drag
 * (a file dropped from the Finder, etc.) landing on the same handlers. */
const DRAG_TYPE = "text/drycms-bubble-file-path";

/** Focuses a just-mounted `contentEditable` box and selects its whole
 * (pre-filled) text, so typing replaces it outright - the `<input>`
 * equivalent of `autoFocus` + `select()`. Runs exactly once via the
 * `doneRef`-guarded commit/cancel below, not on every render: `textContent`
 * is set imperatively here and never touched again, since re-assigning it
 * from a Preact re-render would fight the user's live edits/cursor
 * position (the classic contentEditable-vs-vdom problem). */
function EditableName(props: {
  initialValue: string;
  placeholder?: string;
  ariaLabel: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const doneRef = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.textContent = props.initialValue;
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount; uncontrolled after that.
  }, []);

  function commit() {
    if (doneRef.current) return;
    doneRef.current = true;
    props.onCommit((ref.current?.textContent ?? "").replace(/\s+/g, " ").trim());
  }

  function cancel() {
    if (doneRef.current) return;
    doneRef.current = true;
    props.onCancel();
  }

  return (
    <span
      ref={ref}
      class="page-components-tree-edit"
      contentEditable
      role="textbox"
      aria-label={props.ariaLabel}
      data-placeholder={props.placeholder}
      spellcheck={false}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        } else if (event.key === "Escape") {
          event.preventDefault();
          cancel();
        }
      }}
      onBlur={commit}
    />
  );
}

/**
 * Expandable folder tree for `BubbleMenu.tsx` - the same shape and CSS Page
 * Editor's own (now-removed) `ComponentTreePanel` sidebar used
 * (`page-components-tree*`, `buildComponentTree`), including that
 * component's drag & drop / inline create-rename / right-click menu, ported
 * back onto this flat-path data source. Now the ONLY place page source can
 * be created, renamed, moved or deleted from the UI - the operations
 * themselves live behind `use-page-builder-source.ts`'s
 * `createFile`/`renameFile`/`deleteFile`, reached through `BubbleMenu.tsx`'s
 * passthrough props.
 *
 * Uses `useOverlayScrollbars` with its default (mount-once) `deps` - safe
 * here because the scrollable container below is now ALWAYS rendered (the
 * "no files" state renders a `<p>` INSIDE it, not instead of it), so the
 * ref never goes from null to populated after first mount. The tree's
 * PREVIOUS attempt at this (see git history) had a real crash keying the
 * hook's `deps` on `activeRoot`, which reruns the hook's destroy+reinit
 * effect against a container Preact is SIMULTANEOUSLY re-rendering
 * different children into.
 */
export default function BubbleFileTree(props: BubbleFileTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const { ref: treeRef } = useOverlayScrollbars<HTMLDivElement>();
  const rowsRef = useRef<HTMLDivElement>(null);

  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [creatingParent, setCreatingParent] = useState<string | null>(null);
  /** Explicit folder pick ("New" targets this) - `null` falls back to
   * `activePath`'s own folder, so the inline create box shows up wherever
   * the user is actually looking instead of always at the tree root. */
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  /** `""` = the drop-root-hint bar; a folder or file row's own id = that
   * row's outline; `null` = nothing being dragged over. */
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  /** The file id currently being dragged FROM this tree, or `null`. Drives
   * the persistent "move to root" strip below - a plain background-hover
   * zone (the tree container's own `onDragOver`) is only reachable while
   * the mouse happens to sit over actual empty space, which a fully-packed
   * row list may not have any of; a dedicated, always-present strip is
   * reachable regardless of how many rows are showing. */
  const [draggingPath, setDraggingPath] = useState<string | null>(null);

  const tree = useMemo(() => {
    const paths = Object.keys(props.sourceByPath).filter(
      (path) => path === props.activeRoot || path.startsWith(`${props.activeRoot}/`),
    );
    return buildComponentTree(buildEntries(paths, props.activeRoot));
  }, [props.sourceByPath, props.activeRoot]);

  // Folder ids are relative to `activeRoot` - stale once the tab changes.
  useEffect(() => {
    setActiveFolder(null);
  }, [props.activeRoot]);

  const initialCreateSignal = useRef(props.createSignal);
  useEffect(() => {
    if (props.createSignal === initialCreateSignal.current) return;
    initialCreateSignal.current = props.createSignal;
    startCreating();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-fire on a real bump from BubbleMenu's "+" button.
  }, [props.createSignal]);

  useEffect(() => {
    if (!props.activePath || rootOfPath(props.activePath) !== props.activeRoot) return;
    const relativeParts = props.activePath.slice(props.activeRoot.length + 1).split("/").slice(0, -1);
    if (relativeParts.length === 0) return;
    setCollapsed((current) => {
      const next = new Set(current);
      let changed = false;
      for (let index = 1; index <= relativeParts.length; index += 1) {
        if (next.delete(relativeParts.slice(0, index).join("/"))) changed = true;
      }
      return changed ? next : current;
    });
  }, [props.activePath, props.activeRoot]);

  useEffect(() => {
    if (!props.activePath || rootOfPath(props.activePath) !== props.activeRoot) return;
    const active = rowsRef.current?.querySelector<HTMLButtonElement>('[aria-current="page"]');
    active?.focus({ preventScroll: true });
    active?.scrollIntoView({ block: "nearest" });
  }, [props.activePath, props.activeRoot, collapsed]);

  function toggle(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectFolder(id: string) {
    setActiveFolder(id);
    setCollapsed((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  /** The folder relative to `activeRoot` a NEW item lands in - an explicit
   * pick, else the currently open file's own folder, else the tab root. */
  function relativeFolderOfActivePath(): string | null {
    if (!props.activePath || !props.activePath.startsWith(`${props.activeRoot}/`)) return null;
    const rel = props.activePath.slice(props.activeRoot.length + 1);
    const index = rel.lastIndexOf("/");
    return index === -1 ? null : rel.slice(0, index);
  }
  const effectiveFolder = activeFolder ?? relativeFolderOfActivePath();

  function startCreating() {
    const target = effectiveFolder;
    setCreatingParent(target);
    setCreating(true);
    if (target) {
      setCollapsed((prev) => {
        if (!prev.has(target)) return prev;
        const next = new Set(prev);
        next.delete(target);
        return next;
      });
    }
  }

  async function commitCreating(typed: string) {
    if (!typed) {
      setCreating(false);
      return;
    }
    const folder = creatingParent ? `${props.activeRoot}/${creatingParent}` : props.activeRoot;
    const fullPath = `${folder}/${typed}`;
    if (fullPath in props.sourceByPath) {
      toast.add({ type: "error", title: `"${typed}" already exists here.` });
      return;
    }
    setCreating(false);
    try {
      await props.onCreateFile(fullPath, fileTemplate(props.activeRoot, fullPath));
    } catch (err) {
      toast.add({ type: "error", title: err instanceof Error ? err.message : "Could not create the file." });
    }
  }

  function startRename(entry: FileEntry) {
    setRenamingPath(entry.id);
  }

  async function commitRename(entry: FileEntry, typed: string) {
    setRenamingPath(null);
    if (!typed || typed === entry.name) return;
    const parent = parentOfFullPath(entry.id);
    const to = parent ? `${parent}/${typed}` : typed;
    if (to === entry.id) return;
    if (to in props.sourceByPath) {
      toast.add({ type: "error", title: `"${typed}" already exists here.` });
      return;
    }
    try {
      await props.onRenameFile(entry.id, to);
    } catch (err) {
      toast.add({ type: "error", title: err instanceof Error ? err.message : "Could not rename the file." });
    }
  }

  async function commitMove(from: string, to: string) {
    if (from === to) return;
    if (to in props.sourceByPath) {
      toast.add({ type: "error", title: `"${basename(to)}" already exists there.` });
      return;
    }
    try {
      await props.onRenameFile(from, to);
    } catch (err) {
      toast.add({ type: "error", title: err instanceof Error ? err.message : "Could not move the file." });
    }
  }

  return (
    <div class="page-components-tree-wrap">
      <div class="page-components-tree" ref={treeRef}>
        <div ref={rowsRef}>
          {tree.length === 0 && !(creating && creatingParent === null) ? (
            <p class="hint">No files here yet.</p>
          ) : (
            <BubbleFileTreeList
              nodes={tree}
              folderId={null}
              collapsed={collapsed}
              activePath={props.activePath}
              activeFolder={effectiveFolder}
              onToggle={toggle}
              onSelectFolder={selectFolder}
              onSelectFile={props.onSelectFile}
              onStartRename={startRename}
              onDeleteFile={props.onDeleteFile}
              canDelete={props.canDelete}
              renamingPath={renamingPath}
              onCommitRename={commitRename}
              onCancelRename={() => setRenamingPath(null)}
              onCommitMove={commitMove}
              dragOverId={dragOverId}
              onDragOverId={setDragOverId}
              activeRoot={props.activeRoot}
              creating={creating}
              creatingParent={creatingParent}
              onCommitCreating={commitCreating}
              onCancelCreating={() => setCreating(false)}
              onDragStart={setDraggingPath}
              onDragEnd={() => setDraggingPath(null)}
            />
          )}
        </div>
      </div>
      {/* A dedicated, always-sized, always-reachable target while a drag
          from THIS tree is in flight - deliberately a SIBLING of the
          scrollable tree above, not a child of it: `useOverlayScrollbars`
          relocates the host's existing children into its own generated
          viewport, so a child here would scroll out of reach on a long
          list instead of staying pinned as a real footer. */}
      {draggingPath && parentOfFullPath(draggingPath) !== props.activeRoot && (
        <div
          class={`page-components-tree-drop-root${dragOverId === "" ? " drop-target" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOverId("");
          }}
          onDragLeave={() => setDragOverId((prev) => (prev === "" ? null : prev))}
          onDrop={(event) => {
            event.preventDefault();
            setDragOverId(null);
            const from = event.dataTransfer?.getData(DRAG_TYPE) || draggingPath;
            if (!from) return;
            void commitMove(from, `${props.activeRoot}/${basename(from)}`);
          }}
        >
          Move to {props.activeRoot}/
        </div>
      )}
    </div>
  );
}

function rootOfPath(path: string): string {
  return path.split("/")[0] ?? "";
}

interface CreateRowProps {
  activeRoot: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}

function CreateRow({ activeRoot, onCommit, onCancel }: CreateRowProps) {
  return (
    <div class="page-components-tree-row page-components-tree-create">
      <span class="page-components-tree-chevron-spacer" />
      {fileIconForName(`page${defaultExtension(activeRoot)}`)}
      <EditableName
        initialValue=""
        placeholder={`page${defaultExtension(activeRoot)}`}
        ariaLabel="New file name"
        onCommit={onCommit}
        onCancel={onCancel}
      />
    </div>
  );
}

interface BubbleFileTreeListProps {
  nodes: ComponentTreeNode[];
  /** The relative-to-`activeRoot` id of the folder whose CHILDREN this list
   * renders - `null` for the root-level list. */
  folderId: string | null;
  collapsed: Set<string>;
  activePath: string | null;
  activeFolder: string | null;
  onToggle: (id: string) => void;
  onSelectFolder: (id: string) => void;
  onSelectFile: (path: string) => void;
  onStartRename: (entry: FileEntry) => void;
  onDeleteFile: (path: string) => void;
  canDelete: (path: string) => boolean;
  renamingPath: string | null;
  onCommitRename: (entry: FileEntry, value: string) => void;
  onCancelRename: () => void;
  onCommitMove: (from: string, to: string) => void;
  dragOverId: string | null;
  onDragOverId: (id: string | null) => void;
  activeRoot: string;
  creating: boolean;
  creatingParent: string | null;
  onCommitCreating: (value: string) => void;
  onCancelCreating: () => void;
  onDragStart: (path: string) => void;
  onDragEnd: () => void;
}

function BubbleFileTreeList(props: BubbleFileTreeListProps) {
  const open = (id: string) => !props.collapsed.has(id);

  return (
    <>
      {props.creating && props.creatingParent === props.folderId && (
        <CreateRow activeRoot={props.activeRoot} onCommit={props.onCommitCreating} onCancel={props.onCancelCreating} />
      )}
      {props.nodes.map((node) => {
        const entry = node.entry;
        const isFolder = entry.kind === "folder";
        const expanded = isFolder && open(entry.id);
        const renaming = props.renamingPath === entry.id;

        const menuItems: PopoverMenuEntry[] = [
          { type: "item", label: "Rename", icon: <RenameIcon />, onClick: () => props.onStartRename(entry) },
          ...(props.canDelete(entry.id)
            ? [{ type: "item", label: "Delete", icon: <TrashIcon />, danger: true, onClick: () => props.onDeleteFile(entry.id) } as PopoverMenuEntry]
            : []),
        ];

        const row = (
          <div
            class={[
              "page-components-tree-row",
              entry.kind === "file" && entry.id === props.activePath && "selected",
              isFolder && props.activeFolder === entry.id && "folder-active",
              props.dragOverId === entry.id && "drop-target",
            ]
              .filter(Boolean)
              .join(" ")}
            draggable={entry.kind === "file" && !renaming}
            onDragStart={(event) => {
              if (entry.kind !== "file" || !event.dataTransfer) return;
              event.dataTransfer.setData(DRAG_TYPE, entry.id);
              event.dataTransfer.effectAllowed = "move";
              props.onDragStart(entry.id);
            }}
            onDragEnd={() => props.onDragEnd()}
            onDragOver={(event) => {
              event.stopPropagation();
              event.preventDefault();
              props.onDragOverId(entry.id);
            }}
            onDragLeave={(event) => {
              event.stopPropagation();
              props.onDragOverId(null);
            }}
            onDrop={(event) => {
              event.stopPropagation();
              event.preventDefault();
              props.onDragOverId(null);
              const from = event.dataTransfer?.getData(DRAG_TYPE);
              if (!from) return;
              // Dropping onto a FILE lands beside it (its own parent
              // folder) - the common "drop on a sibling" file-manager
              // convention - dropping onto a FOLDER lands inside it.
              const destFolder = isFolder ? `${props.activeRoot}/${entry.id}` : parentOfFullPath(entry.id);
              props.onCommitMove(from, `${destFolder}/${basename(from)}`);
            }}
          >
            {isFolder ? (
              <button
                type="button"
                class="page-components-tree-chevron"
                aria-expanded={expanded}
                aria-label={expanded ? `Collapse ${entry.name}` : `Expand ${entry.name}`}
                onClick={() => props.onToggle(entry.id)}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                  <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.343 6.343L15 12l-5.657 5.657" />
                </svg>
              </button>
            ) : (
              <span class="page-components-tree-chevron-spacer" />
            )}
            {isFolder ? expanded ? <FolderBaseOpenIcon /> : <FolderBaseIcon /> : fileIconForName(entry.name)}
            {renaming ? (
              <EditableName
                initialValue={entry.name}
                ariaLabel={`Rename ${entry.name}`}
                onCommit={(value) => props.onCommitRename(entry, value)}
                onCancel={props.onCancelRename}
              />
            ) : (
              <button
                type="button"
                class="page-components-tree-item"
                aria-current={entry.id === props.activePath ? "page" : undefined}
                onClick={() => (isFolder ? props.onSelectFolder(entry.id) : props.onSelectFile(entry.id))}
              >
                <span>{entry.name}</span>
              </button>
            )}
          </div>
        );

        return (
          <div key={entry.id}>
            {entry.kind === "file" && !renaming ? (
              <ContextMenu label={`Actions for ${entry.name}`} items={menuItems}>
                {row}
              </ContextMenu>
            ) : (
              row
            )}
            {isFolder && (expanded || props.creatingParent === entry.id) && (node.children.length > 0 || props.creatingParent === entry.id) && (
              <div class="page-components-tree-children">
                <BubbleFileTreeList {...props} nodes={node.children} folderId={entry.id} />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
