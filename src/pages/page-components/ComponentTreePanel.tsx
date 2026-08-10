import { useMemo, useState } from "preact/hooks";
import ContextMenu from "../../components/ContextMenu.js";
import type { PopoverMenuEntry } from "../../components/Popover.js";
import type { FileEntry } from "../../storage/entry-types.js";
import {
  CodeFieldTypeIcon,
  CopyIcon,
  FolderIcon,
  PasteIcon,
  PlusIcon,
  RenameIcon,
  SearchIcon,
  TrashIcon,
} from "../../components/icons/index.js";
import {
  buildComponentTree,
  filterComponentTree,
  flattenVisibleFilePaths,
  type ComponentTreeNode,
} from "../../page-components/tree.js";

interface ComponentTreePanelProps {
  entries: FileEntry[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onCreateFile: (path: string) => void;
  onCreateFolder: (path: string) => void;
  /** Always an array - a single right-clicked row is a one-element delete,
   * a right-click inside a multi-selection deletes the whole set. */
  onDelete: (entries: FileEntry[]) => void;
  onMove: (from: string, to: string) => void;
  /** Copies `paths` (files only) into `destFolder` - a full storage path, or
   * `""` for the tab's own tree root, same convention `onCreateFile` uses.
   * The panel owns the clipboard (which paths are copied); the consumer owns
   * the actual read+write, since only it has the file CONTENT. */
  onPaste: (paths: string[], destFolder: string) => void;
  /** Fired when paths enter the panel's clipboard - Cmd/Ctrl+C has no visible
   * effect of its own, so the consumer gets a chance to say something. */
  onCopy?: (paths: string[]) => void;
  /** Small unsaved-changes dot on a file row - optional, a consumer with no
   * such concept (none needed it before `PageEditor.tsx`) just omits it. */
  isDirty?: (path: string) => boolean;
  /** Small "saved but not yet built" dot on a file row - same optional
   * shape as `isDirty` (only `PageEditor.tsx` has a build concept at all).
   * Only meaningful for a `page.tsx` row; a consumer decides that. */
  needsBuild?: (path: string) => boolean;
}

function parentOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

/** Callback ref for an input that only exists while it's being used (the
 * create row, the rename row) - it has to take focus the moment it appears,
 * or the user types into nothing. NOT the `autofocus` attribute: that's only
 * honored while the document is still loading, so on an element inserted
 * later (every case here) it silently does nothing - and Preact 10 has no
 * special handling that would paper over it. Module-level so its identity is
 * stable across renders and Preact doesn't re-run it on every keystroke. */
function focusOnMount(element: HTMLInputElement | null): void {
  if (!element) return;
  element.focus();
  element.select();
}

export default function ComponentTreePanel({
  entries,
  selectedPath,
  onSelect,
  onCreateFile,
  onCreateFolder,
  onDelete,
  onMove,
  onPaste,
  onCopy,
  isDirty,
  needsBuild,
}: ComponentTreePanelProps) {
  const [query, setQuery] = useState("");
  // Folders default OPEN (matches the shadcn tree reference) - this tracks
  // only the ones a user explicitly collapsed, not every open one.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [creatingName, setCreatingName] = useState("");
  /** Captured once, when "New" is clicked - the folder the create-form
   * itself renders inside (and the prefix `submitCreate` uses), decoupled
   * from `activeFolder` so a stray click elsewhere while the input is open
   * can't move the form out from under what's being typed. `""` (not
   * `null`) means the tree ROOT - joining onto it is a no-op either way
   * (`joinPath`), but a distinct empty-string sentinel keeps the "which
   * folder's child list renders this" comparison below unambiguous against
   * "not creating at all" (`creatingParent === null` when `!creating`). */
  const [creatingParent, setCreatingParent] = useState<string | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renamingValue, setRenamingValue] = useState("");
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  /** Explicit folder selection ("chọn folder" - new items target this).
   * `null` = no explicit pick; `effectiveFolder` below then falls back to
   * whatever file is currently open, which is friendlier than always
   * defaulting all the way back to root. */
  const [activeFolder, setActiveFolder] = useState<string | null>(null);
  /** Files picked with Cmd/Ctrl+click or a Shift+click range - what a copy or
   * a delete acts on. Empty is the normal state and does NOT mean "nothing
   * selected": `actingPaths` below then falls back to the file open in the
   * editor, so a plain click never has to write this at all. Files only -
   * a folder row picks `activeFolder` instead (a different concept: where
   * new/pasted items land). */
  const [selection, setSelection] = useState<ReadonlySet<string>>(new Set());
  /** The row a Shift+click measures its range FROM - the last row picked
   * without Shift. Kept separate from the selection so a second Shift+click
   * re-measures from the same origin (growing/shrinking one range) instead of
   * walking the anchor along with it. */
  const [anchorPath, setAnchorPath] = useState<string | null>(null);
  /** Panel-local copy buffer - deliberately not the system clipboard: these
   * are storage PATHS, meaningless outside this tree, and reading the real
   * clipboard would need a permission prompt for no gain. */
  const [clipboard, setClipboard] = useState<string[]>([]);
  const effectiveFolder = activeFolder ?? (selectedPath ? parentOf(selectedPath) : "");

  const tree = useMemo(() => buildComponentTree(entries), [entries]);
  const entryById = useMemo(() => new Map(entries.map((entry) => [entry.id, entry])), [entries]);
  const { nodes: filteredTree, matchedFolderIds } = useMemo(
    () => filterComponentTree(tree, query),
    [tree, query],
  );
  const isOpen = (id: string) =>
    (query.trim() && matchedFolderIds.has(id)) || !collapsed.has(id);

  /** What the user actually picked, pruned of paths that no longer exist (a
   * delete/move/rename/tab switch can strip a row out from under it - deriving
   * instead of syncing means no stale entry ever survives to be copied or
   * deleted). This is what gets the selection FILL, so an ordinary single
   * click - which leaves this empty - keeps looking exactly as it always has. */
  const pickedPaths = useMemo(() => {
    const alive = new Set<string>();
    for (const path of selection) {
      if (entryById.get(path)?.kind === "file") alive.add(path);
    }
    return alive;
  }, [selection, entryById]);

  /** What a copy/delete acts on: the explicit pick, or - when there is none -
   * the file open in the editor, so Cmd+C with nothing picked still copies the
   * obvious thing. Also the seed a Cmd/Ctrl+click toggles against, which is
   * what makes "open A, Cmd+click B" mean both rather than only B. */
  const actingPaths = useMemo(
    () => (pickedPaths.size > 0 ? pickedPaths : new Set(selectedPath ? [selectedPath] : [])),
    [pickedPaths, selectedPath],
  );

  // Not memoized: one O(rows) walk per render over a tree small enough to fit
  // in a sidebar, and its real inputs (`collapsed`, `query`, `matchedFolderIds`
  // via `isOpen`) are exactly the things a dep array here would get wrong.
  const visibleFilePaths = flattenVisibleFilePaths(filteredTree, isOpen);

  function toggleFolder(id: string) {
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

  /** Plain click: the selection collapses back to this one file and the file
   * opens. Also clears an explicit folder pin - `effectiveFolder` then falls
   * back to this file's own parent, so "New"/paste after browsing to a
   * different file targets where the user is actually looking, not a stale
   * earlier pick. */
  function selectFile(path: string) {
    setActiveFolder(null);
    // Empty, not `{path}`: with no explicit pick the row draws exactly as it
    // did before multi-select existed (outline only, no fill), while
    // `actingPaths` still resolves a lone Cmd+C to this file.
    setSelection(new Set());
    setAnchorPath(path);
    onSelect(path);
  }

  /** The three click gestures a file row supports, VS Code's own split:
   * Cmd/Ctrl toggles ONE row in or out without touching what's open in the
   * editor; Shift replaces the selection with everything between the anchor
   * and this row, in on-screen order (`visibleFilePaths`); a plain click
   * resets to just this file. */
  function handleFileClick(path: string, event: MouseEvent) {
    if (event.shiftKey) {
      const from = anchorPath ?? selectedPath;
      const start = from ? visibleFilePaths.indexOf(from) : -1;
      const end = visibleFilePaths.indexOf(path);
      // Anchor scrolled out of the filtered/collapsed view - nothing sensible
      // to range from, so treat it as a fresh plain click.
      if (start === -1 || end === -1) return selectFile(path);
      const [lo, hi] = start <= end ? [start, end] : [end, start];
      setSelection(new Set(visibleFilePaths.slice(lo, hi + 1)));
      setActiveFolder(null);
      onSelect(path);
      return;
    }
    if (event.metaKey || event.ctrlKey) {
      const next = new Set(actingPaths);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      setSelection(next);
      setAnchorPath(path);
      return;
    }
    selectFile(path);
  }

  function copyPaths(paths: string[]) {
    if (paths.length === 0) return;
    setClipboard(paths);
    onCopy?.(paths);
  }

  function pasteInto(destFolder: string) {
    if (clipboard.length === 0) return;
    // Drop the selection: it still points at the SOURCE files, and leaving
    // them filled while the fresh copy is what just opened reads as if the
    // paste landed on the originals. Empty falls back to the open file, which
    // the consumer switches to the new copy.
    setSelection(new Set());
    setAnchorPath(null);
    onPaste(clipboard, destFolder);
  }

  /** Cmd/Ctrl+C / Cmd/Ctrl+V, scoped to the tree container rather than the
   * window: the code editor next to it owns those keys for text, and even
   * inside this panel the rename/create inputs (and the search box, which
   * lives outside this container anyway) must keep the browser's own
   * copy/paste. `tabIndex={-1}` on the container is what makes this fire at
   * all in Safari, where clicking a `<button>` doesn't focus it. */
  function handleTreeKeyDown(event: KeyboardEvent) {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
    const target = event.target as HTMLElement | null;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
    const key = event.key.toLowerCase();
    if (key === "c") {
      event.preventDefault();
      copyPaths([...actingPaths]);
    } else if (key === "v") {
      event.preventDefault();
      pasteInto(effectiveFolder);
    }
  }

  function startCreating() {
    setCreating(true);
    setCreatingName("");
    setCreatingParent(effectiveFolder);
    // The parent folder has to be visibly open for the inline input (a
    // child of it) to render at all.
    if (effectiveFolder) {
      setCollapsed((prev) => {
        if (!prev.has(effectiveFolder)) return prev;
        const next = new Set(prev);
        next.delete(effectiveFolder);
        return next;
      });
    }
  }

  function cancelCreating() {
    setCreating(false);
    setCreatingName("");
  }

  /** A trailing `/` makes a folder instead of a file - same "type where it
   * appears" flow either way, just a different endpoint. A name that
   * ITSELF contains `/` (`"blogs/new-post/page.tsx"`) already reaches
   * multiple nesting levels in one go - `onCreateFile`/`onCreateFolder`'s
   * own storage-layer writers already auto-create missing intermediate
   * folders, nothing extra needed here for that part. */
  function submitCreate(event: Event) {
    event.preventDefault();
    const typed = creatingName.trim();
    if (!typed) return cancelCreating();
    const isFolder = typed.endsWith("/");
    const name = isFolder ? typed.slice(0, -1) : typed;
    if (!name) return cancelCreating();
    const fullPath = joinPath(creatingParent ?? "", name);
    if (isFolder) onCreateFolder(fullPath);
    else onCreateFile(fullPath);
    cancelCreating();
  }

  function startRename(entry: FileEntry) {
    setRenamingPath(entry.id);
    setRenamingValue(entry.name);
  }

  function commitRename(entry: FileEntry) {
    const name = renamingValue.trim();
    setRenamingPath(null);
    if (!name || name === entry.name) return;
    onMove(entry.id, joinPath(parentOf(entry.id), name));
  }

  function handleRootDrop(event: DragEvent) {
    event.preventDefault();
    setDragOverPath(null);
    const from = event.dataTransfer?.getData("text/drycms-page-component-path");
    if (!from) return;
    const name = from.includes("/")
      ? from.slice(from.lastIndexOf("/") + 1)
      : from;
    if (parentOf(from) !== "") onMove(from, name);
  }

  return (
    <div class="page-components-sidebar">
      <div class="page-components-sidebar-header">
        <div class="page-components-search">
          <SearchIcon />
          <input
            type="text"
            placeholder="Search…"
            value={query}
            onInput={(event) =>
              setQuery((event.target as HTMLInputElement).value)
            }
          />
        </div>
        <button
          type="button"
          class="ghost icon sm"
          aria-label="New (type a name ending in / for a folder)"
          onClick={startCreating}
        >
          <PlusIcon />
        </button>
      </div>

      <div
        class="page-components-tree scroll"
        tabIndex={-1}
        onKeyDown={handleTreeKeyDown}
        onClick={(event) => {
          // Only the container's own background, not a bubbled row click -
          // clicking empty space deselects the active folder (new items
          // fall back to whatever file is open, or root).
          if (event.target === event.currentTarget) setActiveFolder(null);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragOverPath("");
        }}
        onDragLeave={() =>
          setDragOverPath((prev) => (prev === "" ? null : prev))
        }
        onDrop={handleRootDrop}
      >
        {filteredTree.length === 0 && !(creating && creatingParent === "") ? (
          <p class="hint">
            {query.trim() ? "No matches." : "No components yet."}
          </p>
        ) : (
          <ComponentTreeList
            nodes={filteredTree}
            folderId=""
            selectedPath={selectedPath}
            pickedPaths={pickedPaths}
            activeFolder={effectiveFolder}
            isOpen={isOpen}
            isDirty={isDirty}
            needsBuild={needsBuild}
            onToggleFolder={toggleFolder}
            onSelectFolder={selectFolder}
            onFileClick={handleFileClick}
            onDelete={onDelete}
            entryById={entryById}
            clipboardSize={clipboard.length}
            onCopyPaths={copyPaths}
            onPasteInto={pasteInto}
            onStartRename={startRename}
            renamingPath={renamingPath}
            renamingValue={renamingValue}
            onRenamingValueChange={setRenamingValue}
            onCommitRename={commitRename}
            onCancelRename={() => setRenamingPath(null)}
            onMove={onMove}
            dragOverPath={dragOverPath}
            onDragOverPath={setDragOverPath}
            creating={creating}
            creatingParent={creatingParent}
            creatingName={creatingName}
            onCreatingNameChange={setCreatingName}
            onSubmitCreate={submitCreate}
            onCancelCreate={cancelCreating}
          />
        )}
        {dragOverPath === "" && (
          <div class="page-components-tree-drop-root-hint" />
        )}
      </div>
    </div>
  );
}

interface CreateRowProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (event: Event) => void;
  onCancel: () => void;
}

function CreateRow({ value, onChange, onSubmit, onCancel }: CreateRowProps) {
  const isFolder = value.trim().endsWith("/");
  return (
    <form
      class="page-components-tree-row page-components-tree-create"
      onSubmit={onSubmit}
    >
      {isFolder ? <FolderIcon /> : <CodeFieldTypeIcon />}
      <input
        ref={focusOnMount}
        class="page-components-tree-input"
        value={value}
        placeholder="e.g. Button.tsx, or folder/ for a folder"
        onInput={(event) => onChange((event.target as HTMLInputElement).value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
        onBlur={onCancel}
      />
    </form>
  );
}

interface ComponentTreeListProps {
  nodes: ComponentTreeNode[];
  /** The id of the folder whose CHILDREN this particular list renders -
   * `""` for the root-level list. Compared against `creatingParent` to
   * decide whether the create-form belongs inside THIS list. */
  folderId: string;
  selectedPath: string | null;
  /** The explicitly picked file rows (see the panel's own `pickedPaths`) -
   * these draw filled, and a right-click inside them acts on the whole set. */
  pickedPaths: ReadonlySet<string>;
  activeFolder: string;
  isOpen: (id: string) => boolean;
  isDirty?: (path: string) => boolean;
  needsBuild?: (path: string) => boolean;
  onToggleFolder: (id: string) => void;
  onSelectFolder: (id: string) => void;
  onFileClick: (path: string, event: MouseEvent) => void;
  onDelete: (entries: FileEntry[]) => void;
  entryById: Map<string, FileEntry>;
  clipboardSize: number;
  onCopyPaths: (paths: string[]) => void;
  onPasteInto: (destFolder: string) => void;
  onStartRename: (entry: FileEntry) => void;
  renamingPath: string | null;
  renamingValue: string;
  onRenamingValueChange: (value: string) => void;
  onCommitRename: (entry: FileEntry) => void;
  onCancelRename: () => void;
  onMove: (from: string, to: string) => void;
  dragOverPath: string | null;
  onDragOverPath: (path: string | null) => void;
  creating: boolean;
  creatingParent: string | null;
  creatingName: string;
  onCreatingNameChange: (value: string) => void;
  onSubmitCreate: (event: Event) => void;
  onCancelCreate: () => void;
}

function ComponentTreeList(props: ComponentTreeListProps) {
  const {
    nodes,
    folderId,
    selectedPath,
    pickedPaths,
    activeFolder,
    isOpen,
    isDirty,
    needsBuild,
    onToggleFolder,
    onSelectFolder,
    onFileClick,
    onDelete,
    entryById,
    clipboardSize,
    onCopyPaths,
    onPasteInto,
    onStartRename,
    renamingPath,
    renamingValue,
    onRenamingValueChange,
    onCommitRename,
    onCancelRename,
    onMove,
    dragOverPath,
    onDragOverPath,
    creating,
    creatingParent,
    creatingName,
    onCreatingNameChange,
    onSubmitCreate,
    onCancelCreate,
  } = props;

  return (
    <>
      {creating && creatingParent === folderId && (
        <CreateRow
          value={creatingName}
          onChange={onCreatingNameChange}
          onSubmit={onSubmitCreate}
          onCancel={onCancelCreate}
        />
      )}
      {nodes.map((node) => {
        const entry = node.entry;
        const renaming = renamingPath === entry.id;
        const open = entry.kind === "folder" && isOpen(entry.id);
        const inSelection = entry.kind === "file" && pickedPaths.has(entry.id);
        /** Right-clicking INSIDE the selection acts on the whole set;
         * right-clicking a row outside it acts on that row alone (and leaves
         * the selection untouched - same as every file manager). */
        const targets = inSelection ? [...pickedPaths] : entry.kind === "file" ? [entry.id] : [];
        const bulk = inSelection && pickedPaths.size > 1;
        const deleteTargets = bulk
          ? targets.map((path) => entryById.get(path)).filter((item): item is FileEntry => !!item)
          : [entry];
        // A file's own folder is where a paste next to it belongs.
        const pasteFolder = entry.kind === "folder" ? entry.id : parentOf(entry.id);
        // Built imperatively rather than as one conditional-spread literal:
        // every group here is optional, and a separator must never lead the
        // menu (it would render as a stray rule above the first item).
        const menuItems: PopoverMenuEntry[] = [];
        if (!renaming) {
          if (targets.length > 0) {
            menuItems.push({
              type: "item",
              label: bulk ? `Copy ${targets.length} files` : "Copy",
              icon: <CopyIcon />,
              onClick: () => onCopyPaths(targets),
            });
          }
          if (clipboardSize > 0) {
            menuItems.push({
              type: "item",
              label: clipboardSize > 1 ? `Paste ${clipboardSize} files` : "Paste",
              icon: <PasteIcon />,
              onClick: () => onPasteInto(pasteFolder),
            });
          }
          if (!bulk) {
            if (menuItems.length > 0) menuItems.push({ type: "separator" });
            menuItems.push({
              type: "item",
              label: "Rename",
              icon: <RenameIcon />,
              onClick: () => onStartRename(entry),
            });
          }
          if (menuItems.length > 0) menuItems.push({ type: "separator" });
          menuItems.push({
            type: "item",
            label: bulk ? `Delete ${deleteTargets.length} items` : "Delete",
            icon: <TrashIcon />,
            danger: true,
            onClick: () => onDelete(deleteTargets),
          });
        }

        const row = (
          <div
            class={[
              "page-components-tree-row",
              entry.kind === "file" && selectedPath === entry.id && "selected",
              inSelection && "in-selection",
              entry.kind === "folder" && activeFolder === entry.id && "folder-active",
              dragOverPath === entry.id && "drop-target",
            ]
              .filter(Boolean)
              .join(" ")}
            draggable={!renaming}
            onDragStart={(event) => {
              if (!event.dataTransfer) return;
              event.dataTransfer.setData(
                "text/drycms-page-component-path",
                entry.id,
              );
              event.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(event) => {
              // Always stop propagation, even for a file row (not a valid
              // drop target) - otherwise the event bubbles to the tree
              // container's own root-drop handler, which would misread
              // "hovering a nested file" as "drop at the tree root".
              event.stopPropagation();
              if (entry.kind !== "folder") return;
              event.preventDefault();
              onDragOverPath(entry.id);
            }}
            onDragLeave={(event) => {
              event.stopPropagation();
              onDragOverPath(null);
            }}
            onDrop={(event) => {
              event.stopPropagation();
              if (entry.kind !== "folder") return;
              event.preventDefault();
              onDragOverPath(null);
              const from = event.dataTransfer?.getData(
                "text/drycms-page-component-path",
              );
              if (!from || from === entry.id) return;
              const name = from.includes("/")
                ? from.slice(from.lastIndexOf("/") + 1)
                : from;
              const to = entry.id ? `${entry.id}/${name}` : name;
              if (to !== from) onMove(from, to);
            }}
          >
            {entry.kind === "folder" ? (
              <button
                type="button"
                class="page-components-tree-chevron"
                aria-expanded={open}
                aria-label={
                  open ? `Collapse ${entry.name}` : `Expand ${entry.name}`
                }
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleFolder(entry.id);
                }}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                  <path
                    fill="none"
                    stroke="currentColor"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    stroke-width="2"
                    d="M9.343 6.343L15 12l-5.657 5.657"
                  />
                </svg>
              </button>
            ) : (
              <span class="page-components-tree-chevron-spacer" />
            )}
            {entry.kind === "folder" ? <FolderIcon /> : <CodeFieldTypeIcon />}
            {renaming ? (
              <input
                ref={focusOnMount}
                class="page-components-tree-input"
                value={renamingValue}
                onInput={(event) =>
                  onRenamingValueChange(
                    (event.target as HTMLInputElement).value,
                  )
                }
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") onCommitRename(entry);
                  else if (event.key === "Escape") onCancelRename();
                }}
                onBlur={() => onCommitRename(entry)}
              />
            ) : entry.kind === "file" ? (
              <button
                type="button"
                class="page-components-tree-item"
                onClick={(event) => onFileClick(entry.id, event)}
              >
                <span>{entry.name}</span>
                <span class="page-components-tree-dots">
                  {isDirty?.(entry.id) ? (
                    <span class="page-components-tree-dirty-dot" title="Unsaved changes" />
                  ) : (
                    needsBuild?.(entry.id) && (
                      <span class="page-components-tree-build-dot" title="Saved, not built yet" />
                    )
                  )}
                </span>
              </button>
            ) : (
              <button
                type="button"
                class="page-components-tree-item"
                onClick={() => onSelectFolder(entry.id)}
              >
                <span>{entry.name}</span>
              </button>
            )}
          </div>
        );

        return (
          <div key={entry.id}>
            {renaming || menuItems.length === 0 ? (
              row
            ) : (
              <ContextMenu
                label={`Actions for ${entry.name}`}
                items={menuItems}
              >
                {row}
              </ContextMenu>
            )}
            {entry.kind === "folder" &&
              (open || (creating && creatingParent === entry.id)) &&
              (node.children.length > 0 || (creating && creatingParent === entry.id)) && (
                <div class="page-components-tree-children">
                  <ComponentTreeList {...props} nodes={node.children} folderId={entry.id} />
                </div>
              )}
          </div>
        );
      })}
    </>
  );
}
