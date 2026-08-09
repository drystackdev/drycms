import { useMemo, useState } from "preact/hooks";
import ContextMenu from "../../components/ContextMenu.js";
import type { FileEntry } from "../../storage/entry-types.js";
import {
  CodeFieldTypeIcon,
  FolderIcon,
  PlusIcon,
  RenameIcon,
  SearchIcon,
  TrashIcon,
} from "../../components/icons/index.js";
import {
  buildComponentTree,
  filterComponentTree,
  type ComponentTreeNode,
} from "../../page-components/tree.js";

interface ComponentTreePanelProps {
  entries: FileEntry[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onCreateFile: (path: string) => void;
  onCreateFolder: (path: string) => void;
  onDelete: (entry: FileEntry) => void;
  onMove: (from: string, to: string) => void;
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

export default function ComponentTreePanel({
  entries,
  selectedPath,
  onSelect,
  onCreateFile,
  onCreateFolder,
  onDelete,
  onMove,
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
  const effectiveFolder = activeFolder ?? (selectedPath ? parentOf(selectedPath) : "");

  const tree = useMemo(() => buildComponentTree(entries), [entries]);
  const { nodes: filteredTree, matchedFolderIds } = useMemo(
    () => filterComponentTree(tree, query),
    [tree, query],
  );
  const isOpen = (id: string) =>
    (query.trim() && matchedFolderIds.has(id)) || !collapsed.has(id);

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

  function selectFile(path: string) {
    // Clears an explicit folder pin - `effectiveFolder` then falls back to
    // this file's own parent, so "New" after browsing to a different file
    // targets where the user is actually looking, not a stale earlier pick.
    setActiveFolder(null);
    onSelect(path);
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
            activeFolder={effectiveFolder}
            isOpen={isOpen}
            isDirty={isDirty}
            needsBuild={needsBuild}
            onToggleFolder={toggleFolder}
            onSelectFolder={selectFolder}
            onSelectFile={selectFile}
            onDelete={onDelete}
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
        autoFocus
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
  activeFolder: string;
  isOpen: (id: string) => boolean;
  isDirty?: (path: string) => boolean;
  needsBuild?: (path: string) => boolean;
  onToggleFolder: (id: string) => void;
  onSelectFolder: (id: string) => void;
  onSelectFile: (path: string) => void;
  onDelete: (entry: FileEntry) => void;
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
    activeFolder,
    isOpen,
    isDirty,
    needsBuild,
    onToggleFolder,
    onSelectFolder,
    onSelectFile,
    onDelete,
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
        const menuItems = renaming
          ? []
          : [
              {
                type: "item" as const,
                label: "Rename",
                icon: <RenameIcon />,
                onClick: () => onStartRename(entry),
              },
              { type: "separator" as const },
              {
                type: "item" as const,
                label: "Delete",
                icon: <TrashIcon />,
                danger: true,
                onClick: () => onDelete(entry),
              },
            ];

        const row = (
          <div
            class={[
              "page-components-tree-row",
              entry.kind === "file" && selectedPath === entry.id && "selected",
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
                autoFocus
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
                onClick={() => onSelectFile(entry.id)}
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
