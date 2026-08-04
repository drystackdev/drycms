import { useMemo, useState } from "preact/hooks";
import ContextMenu from "../../components/ContextMenu.js";
import type { FileEntry } from "../../components/file-manager-types.js";
import { AddFolderIcon, CodeFieldTypeIcon, FolderIcon, PlusIcon, RenameIcon, SearchIcon, TrashIcon } from "../../components/icons.js";
import { buildComponentTree, filterComponentTree, type ComponentTreeNode } from "../../page-components/tree.js";

interface ComponentTreePanelProps {
  entries: FileEntry[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  onCreateFile: (path: string) => void;
  onCreateFolder: (path: string) => void;
  onDelete: (entry: FileEntry) => void;
  onMove: (from: string, to: string) => void;
}

type Creating = "file" | "folder" | null;

function parentOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

export default function ComponentTreePanel({ entries, selectedPath, onSelect, onCreateFile, onCreateFolder, onDelete, onMove }: ComponentTreePanelProps) {
  const [query, setQuery] = useState("");
  // Folders default OPEN (matches the shadcn tree reference) - this tracks
  // only the ones a user explicitly collapsed, not every open one.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState<Creating>(null);
  const [creatingName, setCreatingName] = useState("");
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renamingValue, setRenamingValue] = useState("");
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);

  const tree = useMemo(() => buildComponentTree(entries), [entries]);
  const { nodes: filteredTree, matchedFolderIds } = useMemo(() => filterComponentTree(tree, query), [tree, query]);
  const isOpen = (id: string) => (query.trim() && matchedFolderIds.has(id)) || !collapsed.has(id);

  function toggleFolder(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function startCreating(kind: "file" | "folder") {
    setCreating(kind);
    setCreatingName("");
  }

  function submitCreate(event: Event) {
    event.preventDefault();
    const name = creatingName.trim();
    if (!name) return;
    if (creating === "file") onCreateFile(name);
    else if (creating === "folder") onCreateFolder(name);
    setCreating(null);
    setCreatingName("");
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
    const name = from.includes("/") ? from.slice(from.lastIndexOf("/") + 1) : from;
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
            onInput={(event) => setQuery((event.target as HTMLInputElement).value)}
          />
        </div>
        <button type="button" class="ghost icon sm" aria-label="New component" onClick={() => startCreating("file")}>
          <PlusIcon />
        </button>
        <button type="button" class="ghost icon sm" aria-label="New folder" onClick={() => startCreating("folder")}>
          <AddFolderIcon />
        </button>
      </div>

      {creating && (
        <form class="page-components-tree-row page-components-tree-create" onSubmit={submitCreate}>
          {creating === "folder" ? <FolderIcon /> : <CodeFieldTypeIcon />}
          <input
            autoFocus
            class="page-components-tree-input"
            value={creatingName}
            placeholder={creating === "folder" ? "e.g. layout or layout/blocks" : "e.g. Button.tsx or layout/Header.tsx"}
            onInput={(event) => setCreatingName((event.target as HTMLInputElement).value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setCreating(null);
            }}
            onBlur={() => setCreating(null)}
          />
        </form>
      )}

      <div
        class="page-components-tree scroll"
        onDragOver={(event) => {
          event.preventDefault();
          setDragOverPath("");
        }}
        onDragLeave={() => setDragOverPath((prev) => (prev === "" ? null : prev))}
        onDrop={handleRootDrop}
      >
        {filteredTree.length === 0 ? (
          <p class="hint">{query.trim() ? "No matches." : "No components yet."}</p>
        ) : (
          <ComponentTreeList
            nodes={filteredTree}
            selectedPath={selectedPath}
            isOpen={isOpen}
            onToggleFolder={toggleFolder}
            onSelect={onSelect}
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
          />
        )}
        {dragOverPath === "" && <div class="page-components-tree-drop-root-hint" />}
      </div>
    </div>
  );
}

interface ComponentTreeListProps {
  nodes: ComponentTreeNode[];
  selectedPath: string | null;
  isOpen: (id: string) => boolean;
  onToggleFolder: (id: string) => void;
  onSelect: (path: string) => void;
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
}

function ComponentTreeList(props: ComponentTreeListProps) {
  const {
    nodes, selectedPath, isOpen, onToggleFolder, onSelect, onDelete,
    onStartRename, renamingPath, renamingValue, onRenamingValueChange, onCommitRename, onCancelRename,
    onMove, dragOverPath, onDragOverPath,
  } = props;

  return (
    <>
      {nodes.map((node) => {
        const entry = node.entry;
        const renaming = renamingPath === entry.id;
        const open = entry.kind === "folder" && isOpen(entry.id);
        const menuItems = renaming
          ? []
          : [
              { type: "item" as const, label: "Rename", icon: <RenameIcon />, onClick: () => onStartRename(entry) },
              { type: "separator" as const },
              { type: "item" as const, label: "Delete", icon: <TrashIcon />, danger: true, onClick: () => onDelete(entry) },
            ];

        const row = (
          <div
            class={[
              "page-components-tree-row",
              selectedPath === entry.id && "selected",
              dragOverPath === entry.id && "drop-target",
            ].filter(Boolean).join(" ")}
            draggable={!renaming}
            onDragStart={(event) => {
              if (!event.dataTransfer) return;
              event.dataTransfer.setData("text/drycms-page-component-path", entry.id);
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
              const from = event.dataTransfer?.getData("text/drycms-page-component-path");
              if (!from || from === entry.id) return;
              const name = from.includes("/") ? from.slice(from.lastIndexOf("/") + 1) : from;
              const to = entry.id ? `${entry.id}/${name}` : name;
              if (to !== from) onMove(from, to);
            }}
          >
            {entry.kind === "folder" ? (
              <button type="button" class="page-components-tree-chevron" aria-expanded={open} aria-label={open ? `Collapse ${entry.name}` : `Expand ${entry.name}`} onClick={() => onToggleFolder(entry.id)}>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
                  <path d="M2.5 1.5 L7 5 L2.5 8.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
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
                onInput={(event) => onRenamingValueChange((event.target as HTMLInputElement).value)}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === "Enter") onCommitRename(entry);
                  else if (event.key === "Escape") onCancelRename();
                }}
                onBlur={() => onCommitRename(entry)}
              />
            ) : entry.kind === "file" ? (
              <button type="button" class="page-components-tree-item" onClick={() => onSelect(entry.id)}>
                <span>{entry.name}</span>
              </button>
            ) : (
              <button type="button" class="page-components-tree-item" onClick={() => onToggleFolder(entry.id)}>
                <span>{entry.name}</span>
              </button>
            )}
          </div>
        );

        return (
          <div key={entry.id}>
            {renaming || menuItems.length === 0 ? row : (
              <ContextMenu label={`Actions for ${entry.name}`} items={menuItems}>
                {row}
              </ContextMenu>
            )}
            {entry.kind === "folder" && open && node.children.length > 0 && (
              <div class="page-components-tree-children">
                <ComponentTreeList {...props} nodes={node.children} />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
