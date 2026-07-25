import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { readCachedFile } from "./file-manager-blob-cache.js";
import type { FileEntry, FileManagerSource } from "./file-manager-types.js";
import {
  collectDescendantIds,
  folderPath,
  formatBytes,
  formatDate,
  isAccepted,
  isHiddenEntry,
  isImageEntry,
  retargetSubtree,
  sortEntries,
  thumbnailUrl,
} from "./file-manager-utils.js";
import {
  AddFolderIcon,
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  CloseIcon,
  CopyIcon,
  GridIcon,
  ListViewIcon,
  MinusIcon,
  MoveIcon,
  PasteIcon,
  PlusIcon,
  PreviewIcon,
  RenameIcon,
  ReplaceIcon,
  TrashIcon,
  UploadIcon,
  XIcon,
} from "./icons.js";
import { toast } from "./Toast.js";
import FileManagerUploadArtwork from "./FileManagerUploadArtwork.js";
import Popover, { type PopoverMenuEntry } from "./Popover.js";

export interface FileManagerProps {
  /** Where data is read from and writes are sent - see `FileManagerSource`. */
  source: FileManagerSource;
  /** Selected id(s). Single mode (`multiple` false): a `string` (`''` when nothing's picked). Multi mode (the default): a `string[]`. */
  value?: string | string[];
  onChange?: (value: string | string[]) => void;
  /** @default true */
  multiple?: boolean;
  /** Extensions (no dot) a file must match to be selectable. Non-matching files are shown disabled, not hidden. Folders are never disabled by this. */
  accept?: string[];
  /** @default "list" */
  defaultView?: "list" | "grid";
}

type MoveCopyState = { mode: "move" | "copy"; ids: string[] } | null;

const VIEW_STORAGE_KEY = "drycms-file-manager-view";
const PREVIEW_STORAGE_KEY = "drycms-file-manager-preview";

/** Reads the last-used list/grid choice - shared across every `FileManager`
 * on the page, same as any other persisted user preference. Guarded for SSR
 * and for `localStorage` throwing (private browsing, disabled storage, ...). */
function readStoredView(fallback: "list" | "grid"): "list" | "grid" {
  try {
    const stored = localStorage.getItem(VIEW_STORAGE_KEY);
    return stored === "list" || stored === "grid" ? stored : fallback;
  } catch {
    return fallback;
  }
}

/** Same idea as `readStoredView`, for the uncontrolled preview toggle. */
function readStoredPreview(fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(PREVIEW_STORAGE_KEY);
    return stored === "true" || stored === "false" ? stored === "true" : fallback;
  } catch {
    return fallback;
  }
}

const FOLDER_QUERY_KEY = "dry_folder";

/** Reads the folder id encoded in the current URL, if any - lets a reload or
 * a shared link land back in the same folder. Guarded for SSR. */
function readFolderFromUrl(): string | null {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get(FOLDER_QUERY_KEY);
}

/** Writes `folderId` into the URL's query string and browser history, so
 * back/forward moves between folders like any other page navigation.
 * `replace` swaps the current entry instead of pushing a new one - used for
 * the initial mount, so opening the manager doesn't itself become a
 * back-button stop. */
function writeFolderToUrl(folderId: string | null, replace: boolean) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (folderId === null) url.searchParams.delete(FOLDER_QUERY_KEY);
  else url.searchParams.set(FOLDER_QUERY_KEY, folderId);
  const state = { [FOLDER_QUERY_KEY]: folderId };
  if (replace) window.history.replaceState(state, "", url);
  else window.history.pushState(state, "", url);
}

/** Opens/closes a native `<dialog>` to match `active`, and reports back when the dialog closes itself (Escape, backdrop click, or an in-dialog `close()` call). */
function useDialogSync(active: boolean, onDismiss: () => void) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (active && !el.open) el.showModal();
    if (!active && el.open) el.close();
  }, [active]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handleClose = () => onDismiss();
    el.addEventListener("close", handleClose);
    return () => el.removeEventListener("close", handleClose);
  }, [onDismiss]);

  return ref;
}

// --------------------------------------------------------------- More menu

interface MoreMenuProps {
  label: string;
  /** Every action is optional - omitted when `source` doesn't support it (see
   * `FileManagerSource`), the same way `onReplace` was already conditionally
   * omitted for folders. Renders nothing if every action ends up omitted. */
  onRename?: () => void;
  onReplace?: () => void;
  onCopy?: () => void;
  onMove?: () => void;
  onDelete?: () => void;
}

/** Row-level equivalent of the selection bar's Copy/Move/Delete trio - picking
 * one here acts on just this entry (it's put in the clipboard, or deleted,
 * on its own) without requiring the row's checkbox to be ticked first. Thin
 * wrapper around the generic `Popover` (see its showcase entry). */
function MoreMenu({
  label,
  onRename,
  onReplace,
  onCopy,
  onMove,
  onDelete,
}: MoreMenuProps) {
  const items: PopoverMenuEntry[] = [];
  if (onRename)
    items.push({
      type: "item",
      label: "Rename",
      icon: <RenameIcon />,
      onClick: onRename,
    });
  if (onReplace)
    items.push({
      type: "item",
      label: "Replace",
      icon: <ReplaceIcon />,
      onClick: onReplace,
    });
  if ((onCopy || onMove) && items.length > 0) items.push({ type: "separator" });
  if (onCopy)
    items.push({
      type: "item",
      label: "Copy",
      icon: <CopyIcon />,
      onClick: onCopy,
    });
  if (onMove)
    items.push({
      type: "item",
      label: "Move",
      icon: <MoveIcon />,
      onClick: onMove,
    });
  if (onDelete && items.length > 0) items.push({ type: "separator" });
  if (onDelete) {
    items.push({
      type: "item",
      label: "Delete",
      icon: <TrashIcon />,
      onClick: onDelete,
      danger: true,
    });
  }
  if (items.length === 0) return null;

  return <Popover label={`More actions for ${label}`} items={items} />;
}

// --------------------------------------------------------------- Breadcrumb

interface BreadcrumbProps {
  chain: FileEntry[];
  onNavigate: (id: string | null) => void;
  /** Drag-to-move onto a breadcrumb entry - see the main component's
   * `dragIds`/`breadcrumbDragOverId`/drag handlers for the shared state. */
  dragOverId: string | null | undefined;
  onDragOver: (id: string | null) => (event: DragEvent) => void;
  onDragLeave: (id: string | null) => () => void;
  onDrop: (id: string | null) => (event: DragEvent) => void;
}

function Breadcrumb({
  chain,
  onNavigate,
  dragOverId,
  onDragOver,
  onDragLeave,
  onDrop,
}: BreadcrumbProps) {
  return (
    <nav class="file-breadcrumb" aria-label="Breadcrumb">
      <button
        type="button"
        class={["link", dragOverId === null ? "drag-over" : null]
          .filter(Boolean)
          .join(" ")}
        onClick={() => onNavigate(null)}
        onDragOver={onDragOver(null)}
        onDragLeave={onDragLeave(null)}
        onDrop={onDrop(null)}
      >
        Root
      </button>
      {chain.map((entry) => (
        <span key={entry.id}>
          <span class="file-breadcrumb-sep" aria-hidden="true">
            /
          </span>
          <button
            type="button"
            class={["link", dragOverId === entry.id ? "drag-over" : null]
              .filter(Boolean)
              .join(" ")}
            onClick={() => onNavigate(entry.id)}
            onDragOver={onDragOver(entry.id)}
            onDragLeave={onDragLeave(entry.id)}
            onDrop={onDrop(entry.id)}
          >
            {entry.name}
          </button>
        </span>
      ))}
    </nav>
  );
}

// ------------------------------------------------------------------ Toolbar

interface ToolbarProps {
  query: string;
  onQuery: (value: string) => void;
  view: "list" | "grid";
  onView: (view: "list" | "grid") => void;
  /** Omitted (hides the button) when `source` doesn't support the action. */
  onNewFolder?: () => void;
  onUpload?: () => void;
  previewOn: boolean;
  onTogglePreview: () => void;
  /** The current folder is (re)loading - a small spinner next to the view
   * toggle, instead of a full skeleton, since `entries` keeps showing
   * whatever it already had until the fresh data replaces it. */
  loading: boolean;
}

function Toolbar({
  query,
  onQuery,
  view,
  onView,
  onNewFolder,
  onUpload,
  previewOn,
  onTogglePreview,
  loading,
}: ToolbarProps) {
  return (
    <div class="file-toolbar row">
      <input
        type="search"
        value={query}
        placeholder="Search this folder…"
        aria-label="Search this folder"
        style="max-width: 18rem"
        onInput={(event) =>
          onQuery((event.currentTarget as HTMLInputElement).value)
        }
      />
      <span class="spacer" />
      {loading && <span class="spinner" aria-hidden="true" />}
      <div class="file-view-toggle" role="group" aria-label="View">
        <button
          type="button"
          class="ghost icon sm"
          data-tooltip="List view"
          aria-pressed={view === "list"}
          aria-label="List view"
          onClick={() => onView("list")}
        >
          <ListViewIcon />
        </button>
        <button
          type="button"
          class="ghost icon sm"
          data-tooltip="Grid view"
          aria-pressed={view === "grid"}
          aria-label="Grid view"
          onClick={() => onView("grid")}
        >
          <GridIcon />
        </button>
        <button
          type="button"
          class="ghost icon sm"
          data-tooltip={previewOn ? "Hide preview" : "Show preview"}
          aria-pressed={previewOn}
          aria-label={previewOn ? "Hide preview" : "Show preview"}
          onClick={onTogglePreview}
        >
          <PreviewIcon />
        </button>
      </div>
      {onNewFolder && (
        <button type="button" class="outline" onClick={onNewFolder}>
          <AddFolderIcon /> New folder
        </button>
      )}
      {onUpload && (
        <button type="button" class="outline" onClick={onUpload}>
          <UploadIcon /> Upload
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- List view

interface ViewProps {
  entries: FileEntry[];
  selectedIds: string[];
  /** Items cut/copied and pending a paste elsewhere - dimmed so they read as
   * "already spoken for" without looking like they're still checkbox-selected. */
  clipboard: MoveCopyState;
  isDisabled: (entry: FileEntry) => boolean;
  onToggle: (entry: FileEntry) => void;
  /** cmd/ctrl+click on the name toggles selection instead of opening - the event is
   * forwarded so the caller can check the modifier. */
  onOpen: (entry: FileEntry, event?: MouseEvent) => void;
  more: (entry: FileEntry) => ComponentChildren;
  /** Drag-to-move - see the main component's `canDrag`/`dragOverId`/drag handlers. */
  canDrag: (entry: FileEntry) => boolean;
  dragOverId: string | null;
  onDragStartEntry: (entry: FileEntry) => (event: DragEvent) => void;
  onDragEndEntry: () => void;
  onDragOverEntry: (entry: FileEntry) => (event: DragEvent) => void;
  onDragLeaveEntry: (entry: FileEntry) => () => void;
  onDropEntry: (entry: FileEntry) => (event: DragEvent) => void;
  /** Real thumbnails (list: 16:9 mini, grid: full-card) instead of the generic file-type icon. */
  preview: boolean;
}

function ListView({
  entries,
  selectedIds,
  clipboard,
  isDisabled,
  sortDir,
  onSort,
  onToggle,
  onOpen,
  more,
  canDrag,
  dragOverId,
  onDragStartEntry,
  onDragEndEntry,
  onDragOverEntry,
  onDragLeaveEntry,
  onDropEntry,
  preview,
  multiple,
  allSelected,
  onToggleAll,
  onUnselect,
  locked,
  onMove,
  onCopy,
  onDelete,
  canPaste,
  onPasteClipboard,
  onCancelClipboard,
}: ViewProps & {
  sortDir: "asc" | "desc";
  onSort: () => void;
  multiple: boolean;
  allSelected: boolean;
  onToggleAll: () => void;
  onUnselect: () => void;
  locked: boolean;
  onMove?: () => void;
  onCopy?: () => void;
  onDelete?: () => void;
  canPaste: boolean;
  onPasteClipboard: () => void;
  onCancelClipboard: () => void;
}) {
  return (
    <div class="scroll">
      <table class="file-table">
        <thead>
          {clipboard ? (
            /* Takes over the exact slot the selection row below uses - the
             * clipboard and selection states never compete for space. */
            <tr>
              <td colSpan={6} class="file-table-selection">
                <div class="row justify-between">
                  <ClipboardBarContent
                    mode={clipboard.mode}
                    count={clipboard.ids.length}
                    canPaste={canPaste}
                    onPaste={onPasteClipboard}
                    onCancel={onCancelClipboard}
                  />
                </div>
              </td>
            </tr>
          ) : selectedIds.length > 0 ? (
            /* One cell spanning every column - swapped in only while something's
             * selected, instead of permanently occupying the header. */
            <tr>
              <td colSpan={6} class="file-table-selection">
                <div class="row justify-between">
                  <div class="row">
                    {multiple && (
                      <button
                        type="button"
                        class="ghost sm"
                        disabled={locked}
                        onClick={onToggleAll}
                      >
                        {allSelected ? "Unselect all" : "Select all"}
                      </button>
                    )}
                    <strong>{selectedIds.length} selected</strong>
                    <button
                      type="button"
                      class="ghost icon sm"
                      data-tooltip="Unselect"
                      aria-label="Unselect"
                      disabled={locked}
                      onClick={onUnselect}
                    >
                      <XIcon />
                    </button>
                  </div>
                  <SelectionActions
                    disabled={locked}
                    onMove={onMove}
                    onCopy={onCopy}
                    onDelete={onDelete}
                  />
                </div>
              </td>
            </tr>
          ) : (
            <tr>
              <th></th>
              <th>
                <button type="button" class="link sm" onClick={onSort}>
                  Name
                  {sortDir === "asc" ? <ArrowUpIcon /> : <ArrowDownIcon />}
                </button>
              </th>
              <th class="numeric">Size</th>
              <th>Type</th>
              <th>Modified</th>
              <th class="file-table-more">
                <span class="sr-only">Actions</span>
              </th>
            </tr>
          )}
        </thead>
        <tbody>
          {entries.length === 0 ? (
            <tr style={{ cursor: "default" }}>
              <td colSpan={6}>
                <div class="center" style={{height: 200}} >No files.</div>
              </td>
            </tr>
          ) : (
            entries.map((entry) => {
              const selected = selectedIds.includes(entry.id);
              const pending = clipboard?.ids.includes(entry.id) ?? false;
              const disabled = isDisabled(entry);
              const { date, time } = formatDate(entry.modifiedAt);
              const isDropTarget = entry.kind === "folder";
              return (
                <tr
                  key={entry.id}
                  class={
                    [
                      pending ? "pending" : selected ? "selected" : null,
                      dragOverId === entry.id ? "drag-over" : null,
                    ]
                      .filter(Boolean)
                      .join(" ") || undefined
                  }
                  draggable={canDrag(entry)}
                  onClick={(event) => onOpen(entry, event)}
                  onDragStart={onDragStartEntry(entry)}
                  onDragEnd={onDragEndEntry}
                  onDragOver={isDropTarget ? onDragOverEntry(entry) : undefined}
                  onDragLeave={
                    isDropTarget ? onDragLeaveEntry(entry) : undefined
                  }
                  onDrop={isDropTarget ? onDropEntry(entry) : undefined}
                >
                  <td
                    class="file-table-check"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      disabled={disabled}
                      aria-label={`Select ${entry.name}`}
                      onChange={() => onToggle(entry)}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      class="file-name-cell"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpen(entry, event);
                      }}
                    >
                      {preview && isImageEntry(entry) ? (
                        <img
                          class="file-thumb-preview"
                          src={entry.previewUrl ?? thumbnailUrl(entry)}
                          alt=""
                        />
                      ) : (
                        <img
                          class="file-thumb-icon"
                          src={thumbnailUrl(entry)}
                          alt=""
                          width={20}
                          height={20}
                        />
                      )}
                      <span>{entry.name}</span>
                    </button>
                  </td>
                  <td class="numeric">{formatBytes(entry.size)}</td>
                  <td>{entry.kind === "folder" ? "folder" : entry.ext}</td>
                  <td>
                    <div>{date}</div>
                    <small class="muted">{time}</small>
                  </td>
                  <td
                    class="file-table-more"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {more(entry)}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- Grid view

function GridView({
  entries,
  selectedIds,
  clipboard,
  isDisabled,
  onToggle,
  onOpen,
  more,
  canDrag,
  dragOverId,
  onDragStartEntry,
  onDragEndEntry,
  onDragOverEntry,
  onDragLeaveEntry,
  onDropEntry,
  preview,
}: ViewProps) {
  if (entries.length === 0) return <div class="empty">No files.</div>;

  return (
    <div class="file-grid">
      {entries.map((entry) => {
        const selected = selectedIds.includes(entry.id);
        const pending = clipboard?.ids.includes(entry.id) ?? false;
        const disabled = isDisabled(entry);
        const isDropTarget = entry.kind === "folder";
        const showMedia = preview && isImageEntry(entry);
        return (
          <div
            key={entry.id}
            class={[
              "file-card",
              showMedia ? "file-card-media" : null,
              pending ? "pending" : null,
              dragOverId === entry.id ? "drag-over" : null,
            ]
              .filter(Boolean)
              .join(" ")}
            draggable={canDrag(entry)}
            onClick={(event) => onOpen(entry, event)}
            onDragStart={onDragStartEntry(entry)}
            onDragEnd={onDragEndEntry}
            onDragOver={isDropTarget ? onDragOverEntry(entry) : undefined}
            onDragLeave={isDropTarget ? onDragLeaveEntry(entry) : undefined}
            onDrop={isDropTarget ? onDropEntry(entry) : undefined}
          >
            {showMedia ? (
              <>
                {/* Real thumbnail fills the card - the rest (checkbox, more
                 * menu, name, size) lives in a blurred overlay that's hidden
                 * until hover/focus (or the item is already checked), so the
                 * default view reads as a plain photo grid. */}
                <img
                  class="file-card-media-image"
                  src={entry.previewUrl ?? thumbnailUrl(entry)}
                  alt=""
                />
                <div class="file-card-media-overlay">
                  <div
                    class="file-card-media-top"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {!disabled && (
                      <input
                        type="checkbox"
                        checked={selected}
                        aria-label={`Select ${entry.name}`}
                        onClick={(event) => event.stopPropagation()}
                        onChange={() => onToggle(entry)}
                      />
                    )}
                    {more(entry)}
                  </div>
                  <div class="file-card-media-bottom">
                    <button
                      type="button"
                      class="file-card-name"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpen(entry, event);
                      }}
                    >
                      {entry.name}
                    </button>
                    <small class="muted">
                      {formatBytes(entry.size)}
                      {entry.kind === "folder"
                        ? ` · ${entry.fileCount ?? 0} files`
                        : ""}
                    </small>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div
                  class="file-card-head"
                  onClick={(event) => event.stopPropagation()}
                >
                  {/* Purely the selection hit-target - opening happens by clicking
                   * the rest of the card, so this never doubles as a button (the
                   * overlay input would swallow every click anyway).
                   * Thumbnail and checkbox both always sit in the DOM; CSS
                   * (`:hover`, `:checked`, `:has()`) drives which one shows. */}
                  <label class="file-card-select">
                    {!disabled && (
                      <input
                        type="checkbox"
                        class="file-card-checkbox"
                        checked={selected}
                        aria-label={`Select ${entry.name}`}
                        onChange={() => onToggle(entry)}
                      />
                    )}
                    <img
                      class="file-card-thumb"
                      src={thumbnailUrl(entry)}
                      alt=""
                      width={40}
                      height={40}
                      style={{ pointerEvents: "none" }}
                    />
                  </label>
                  {more(entry)}
                </div>
                <button
                  type="button"
                  class="file-card-name"
                  onClick={(event) => {
                    event.stopPropagation();
                    onOpen(entry, event);
                  }}
                >
                  {entry.name}
                </button>
                <small class="muted">
                  {formatBytes(entry.size)}
                  {entry.kind === "folder"
                    ? ` · ${entry.fileCount ?? 0} files`
                    : ""}
                </small>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ----------------------------------------------------------- Selection bar

interface SelectionActionsProps {
  disabled: boolean;
  /** Omitted (hides the button) when `source` doesn't support the action. */
  onMove?: () => void;
  onCopy?: () => void;
  onDelete?: () => void;
}

/** The Copy/Move/Delete trio - shared by the always-visible grid `SelectionBar`
 * below and list view's in-header equivalent (see `ListView`), so both stay
 * in sync instead of drifting into two slightly different toolbars. */
function SelectionActions({
  disabled,
  onMove,
  onCopy,
  onDelete,
}: SelectionActionsProps) {
  return (
    <div class="row">
      {onCopy && (
        <button
          type="button"
          class="ghost icon sm"
          data-tooltip="Copy"
          aria-label="Copy selection"
          disabled={disabled}
          onClick={onCopy}
        >
          <CopyIcon />
        </button>
      )}
      {onMove && (
        <button
          type="button"
          class="ghost icon sm"
          data-tooltip="Move"
          aria-label="Move selection"
          disabled={disabled}
          onClick={onMove}
        >
          <MoveIcon />
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          class="icon sm destructive"
          data-tooltip="Delete"
          aria-label="Delete selection"
          disabled={disabled}
          onClick={onDelete}
        >
          <TrashIcon />
        </button>
      )}
    </div>
  );
}

interface SelectionBarProps {
  count: number;
  multiple: boolean;
  allSelected: boolean;
  /** Clipboard has something pending paste - selection is frozen until it's pasted or cancelled. */
  locked: boolean;
  onSelectAll: () => void;
  onUnselectAll: () => void;
  onMove?: () => void;
  onCopy?: () => void;
  onDelete?: () => void;
}

/** Grid view only - list view gets the same controls folded into its own
 * table header instead (see `ListView`), since grid has no header row to
 * take over. Always mounted (not just once something's selected) so the
 * layout doesn't jump; its actions just disable at zero selected. */
function SelectionBar({
  count,
  multiple,
  allSelected,
  locked,
  onSelectAll,
  onUnselectAll,
  onMove,
  onCopy,
  onDelete,
}: SelectionBarProps) {
  return (
    <div class="file-selection-bar">
      <div class="row">
        {multiple && (
          <button
            type="button"
            class="ghost sm"
            disabled={locked}
            onClick={allSelected ? onUnselectAll : onSelectAll}
          >
            {allSelected ? "Unselect all" : "Select all"}
          </button>
        )}
        {count > 0 && (
          <>
            <strong>{count} selected</strong>
            <button
              type="button"
              class="ghost icon sm"
              data-tooltip="Unselect"
              aria-label="Unselect"
              disabled={locked}
              onClick={onUnselectAll}
            >
              <XIcon />
            </button>
          </>
        )}
      </div>
      <SelectionActions
        disabled={locked || count === 0}
        onMove={onMove}
        onCopy={onCopy}
        onDelete={onDelete}
      />
    </div>
  );
}

// ------------------------------------------------------------- Clipboard bar

interface ClipboardBarProps {
  mode: "move" | "copy";
  count: number;
  canPaste: boolean;
  onPaste: () => void;
  onCancel: () => void;
}

/** The text + Cancel/Paste controls, with no outer wrapper - shared by the
 * grid's `ClipboardBar` (below) and list view's in-header equivalent (see
 * `ListView`), same split as `SelectionActions`/`SelectionBar`. */
function ClipboardBarContent({
  mode,
  count,
  canPaste,
  onPaste,
  onCancel,
}: ClipboardBarProps) {
  return (
    <>
      <div class="row">
        <strong>
          {count} item{count === 1 ? "" : "s"}{" "}
          {mode === "move" ? "to move" : "to copy"}
        </strong>
        {!canPaste && <small class="muted">Can't paste into this folder</small>}
      </div>
      <div class="row">
        <button type="button" class="ghost sm" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" class="sm" disabled={!canPaste} onClick={onPaste}>
          <PasteIcon /> Paste here
        </button>
      </div>
    </>
  );
}

/** Grid view only - takes over the `SelectionBar`'s slot the moment a
 * clipboard exists (see the main component), same "one bar at a time" rule
 * `.file-selection-bar` is built around. Shown after Move/Copy is picked from
 * a row or the selection bar - browse to the destination folder, then Paste
 * there. Replaces a folder-tree dialog with the cut/copy-then-paste flow
 * users already know from a file explorer. */
function ClipboardBar(props: ClipboardBarProps) {
  return (
    <div class="file-selection-bar">
      <ClipboardBarContent {...props} />
    </div>
  );
}

// ------------------------------------------------------------ Rename dialog

function RenameDialog({
  target,
  onClose,
  onSubmit,
  busy,
}: {
  target: FileEntry | null;
  onClose: () => void;
  onSubmit: (name: string) => void;
  busy: boolean;
}) {
  const ref = useDialogSync(target !== null, onClose);
  const [name, setName] = useState("");

  useEffect(() => {
    if (target) setName(target.name);
  }, [target]);

  return (
    <dialog ref={ref} aria-label="Rename">
      {target && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = name.trim();
            if (trimmed) onSubmit(trimmed);
          }}
        >
          <header>
            <h3>Rename</h3>
          </header>
          <input
            type="text"
            value={name}
            onInput={(event) =>
              setName((event.currentTarget as HTMLInputElement).value)
            }
          />
          <footer>
            <button type="button" class="outline" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" disabled={busy}>
              Save
            </button>
          </footer>
        </form>
      )}
    </dialog>
  );
}

// -------------------------------------------------------- New folder dialog

function NewFolderDialog({
  open,
  onClose,
  onSubmit,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (name: string) => void;
  busy: boolean;
}) {
  const ref = useDialogSync(open, onClose);
  const [name, setName] = useState("");

  useEffect(() => {
    if (open) setName("");
  }, [open]);

  return (
    <dialog ref={ref} aria-label="New folder">
      {open && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const trimmed = name.trim();
            if (trimmed) onSubmit(trimmed);
          }}
        >
          <header>
            <h3>New folder</h3>
          </header>
          <input
            type="text"
            placeholder="Folder name"
            value={name}
            onInput={(event) =>
              setName((event.currentTarget as HTMLInputElement).value)
            }
          />
          <footer>
            <button type="button" class="outline" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" disabled={busy || !name.trim()}>
              Create
            </button>
          </footer>
        </form>
      )}
    </dialog>
  );
}

// -------------------------------------------------------------- Upload dialog

function UploadDialog({
  open,
  folderPathLabel,
  onClose,
  onSubmit,
  busy,
}: {
  open: boolean;
  folderPathLabel: string;
  onClose: () => void;
  onSubmit: (files: File[]) => void;
  busy: boolean;
}) {
  const ref = useDialogSync(open, onClose);
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setFiles([]);
  }, [open]);

  const addFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setFiles((current) => [...current, ...Array.from(list)]);
  };

  return (
    <dialog
      ref={ref}
      class="file-dialog file-upload-dialog"
      aria-label="Upload files"
    >
      {open && (
        <>
          <header>
            <h3>Upload files</h3>
            <p>
              Uploading to <strong>{folderPathLabel}</strong>
            </p>
          </header>

          <label
            class={dragOver ? "upload-dropzone dragging" : "upload-dropzone"}
            onDragOver={(event) => {
              event.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragOver(false);
              addFiles(
                (event as unknown as DragEvent).dataTransfer?.files ?? null,
              );
            }}
          >
            <FileManagerUploadArtwork />
            <strong>Drop or select files</strong>
            <p>
              Drag files here, or{" "}
              <button
                type="button"
                class="link"
                onClick={() => inputRef.current?.click()}
              >
                browse
              </button>{" "}
              your device.
            </p>
            <input
              ref={inputRef}
              type="file"
              multiple
              hidden
              onChange={(event) => {
                addFiles((event.currentTarget as HTMLInputElement).files);
                (event.currentTarget as HTMLInputElement).value = "";
              }}
            />
          </label>

          {files.length > 0 && (
            <ul class="upload-file-list">
              {files.map((file, index) => (
                <li key={`${file.name}-${index}`}>
                  <span>{file.name}</span>
                  <small class="muted">{formatBytes(file.size)}</small>
                  <button
                    type="button"
                    class="ghost icon sm"
                    data-tooltip="Remove"
                    aria-label={`Remove ${file.name}`}
                    onClick={() =>
                      setFiles((current) =>
                        current.filter((_, i) => i !== index),
                      )
                    }
                  >
                    <XIcon />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <footer>
            <button type="button" class="outline" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || files.length === 0}
              aria-busy={busy}
              onClick={() => onSubmit(files)}
            >
              Upload{files.length > 0 ? ` (${files.length})` : ""}
            </button>
          </footer>
        </>
      )}
    </dialog>
  );
}

// ---------------------------------------------------------------- Preview

interface PreviewDialogProps {
  entry: FileEntry | null;
  scope: FileEntry[];
  onClose: () => void;
  onNavigate: (id: string) => void;
  /** Omitted (hides the action) when `source` doesn't support it. */
  onRename?: (id: string) => void;
  onReplace?: (id: string) => void;
  onCopy?: (id: string) => void;
  onMove?: (id: string) => void;
  onDelete?: (id: string) => void;
}

const ZOOM_MIN = 25;
const ZOOM_MAX = 400;
const ZOOM_STEP = 25;
/** A single scroll gesture fires many `wheel` events (especially trackpads),
 * so the step per event needs to be much smaller than the +/- buttons' - at
 * `ZOOM_STEP` it multiplied out to a jarring zoom-per-notch. */
const WHEEL_ZOOM_STEP = 5;
/** Minimum horizontal drag (px) on the stage before a swipe commits to prev/next. */
const SWIPE_THRESHOLD = 60;

/** Resolves what to actually put in the preview `<img src>`. Files with a
 * `contentHash` (github/future R2-S3 - see `StorageStatEntry.contentHash`)
 * go through the sha-keyed IndexedDB cache (`readCachedFile`), so re-opening
 * the same bytes later - even at a different path, after a rename/move -
 * doesn't refetch them; anything without one (`local`, or a same-session
 * upload preview) just uses `previewUrl` directly, unchanged from before.
 * Deliberately returns `undefined` (not the plain URL) while a cached fetch
 * is in flight - falling back to the raw URL there would make the `<img>`
 * load it directly too, fetching the same bytes twice over the network. */
function usePreviewImageSrc(entry: FileEntry | null): string | undefined {
  const [cachedSrc, setCachedSrc] = useState<string | undefined>(undefined);

  useEffect(() => {
    setCachedSrc(undefined);
    if (!entry?.previewUrl || !entry.contentHash) return;
    let cancelled = false;
    let objectUrl: string | undefined;
    readCachedFile(entry.previewUrl, entry.contentHash)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setCachedSrc(objectUrl);
      })
      .catch(() => {
        // Left as `undefined` - the caller's fallback (plain `previewUrl`,
        // see below) only applies to sourceless entries, so a fetch failure
        // here just means "no image yet" rather than a broken cache path.
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [entry?.id, entry?.previewUrl, entry?.contentHash]);

  return entry?.contentHash ? cachedSrc : entry?.previewUrl;
}

function PreviewDialog({
  entry,
  scope,
  onClose,
  onNavigate,
  onRename,
  onReplace,
  onCopy,
  onMove,
  onDelete,
}: PreviewDialogProps) {
  const ref = useDialogSync(entry !== null, onClose);
  const index = entry ? scope.findIndex((item) => item.id === entry.id) : -1;
  const [direction, setDirection] = useState<"prev" | "next">("next");
  const [zoom, setZoom] = useState(100);
  const [dragX, setDragX] = useState(0);
  const dragState = useRef<{ pointerId: number; startX: number } | null>(null);
  const canLoop = scope.length > 1;
  const previewSrc = usePreviewImageSrc(entry);
  const image = entry !== null && isImageEntry(entry) && !!previewSrc;

  useEffect(() => {
    setZoom(100);
    setDragX(0);
    dragState.current = null;
  }, [entry?.id]);

  const goPrev = () => {
    if (!canLoop || index < 0) return;
    setDirection("prev");
    onNavigate(scope[index === 0 ? scope.length - 1 : index - 1]!.id);
  };
  const goNext = () => {
    if (!canLoop || index < 0) return;
    setDirection("next");
    onNavigate(scope[index === scope.length - 1 ? 0 : index + 1]!.id);
  };

  /** Horizontal swipe/drag on the stage - previous on a rightward drag, next
   * on a leftward one, once past `SWIPE_THRESHOLD`. Pointer Events cover
   * touch and mouse alike, so this doubles as the carousel's swipe gesture. */
  const handleStagePointerDown = (event: PointerEvent) => {
    if (!canLoop) return;
    dragState.current = { pointerId: event.pointerId, startX: event.clientX };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  };
  const handleStagePointerMove = (event: PointerEvent) => {
    if (dragState.current?.pointerId !== event.pointerId) return;
    setDragX(event.clientX - dragState.current.startX);
  };
  const endStageDrag = (event: PointerEvent) => {
    if (dragState.current?.pointerId !== event.pointerId) return;
    const delta = event.clientX - dragState.current.startX;
    dragState.current = null;
    setDragX(0);
    if (delta > SWIPE_THRESHOLD) goPrev();
    else if (delta < -SWIPE_THRESHOLD) goNext();
  };

  useEffect(() => {
    if (!entry) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") goPrev();
      else if (event.key === "ArrowRight") goNext();
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry, index, scope]);

  const zoomBy = (delta: number) =>
    setZoom((current) =>
      Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, current + delta)),
    );

  return (
    <dialog ref={ref} class="file-preview" aria-label="File preview">
      {entry && (
        <>
          <header class="file-preview-header">
            <span class="file-preview-name">{entry.name}</span>
            <div class="row">
              <MoreMenu
                label={entry.name}
                onRename={onRename && (() => onRename(entry.id))}
                onReplace={onReplace && (() => onReplace(entry.id))}
                onCopy={onCopy && (() => onCopy(entry.id))}
                onMove={onMove && (() => onMove(entry.id))}
                onDelete={onDelete && (() => onDelete(entry.id))}
              />
              <button
                type="button"
                class="ghost icon sm"
                data-tooltip="Close"
                aria-label="Close preview"
                onClick={onClose}
              >
                <CloseIcon />
              </button>
            </div>
          </header>

          <div class="file-preview-body">
            <button
              type="button"
              class="file-preview-nav ghost icon lg prev"
              data-tooltip="Previous"
              aria-label="Previous file"
              disabled={!canLoop}
              onClick={goPrev}
            >
              <ArrowLeftIcon />
            </button>

            <div
              class={
                canLoop ? "file-preview-stage swipeable" : "file-preview-stage"
              }
              onWheel={
                image
                  ? (event) => {
                      event.preventDefault();
                      zoomBy(
                        event.deltaY > 0 ? -WHEEL_ZOOM_STEP : WHEEL_ZOOM_STEP,
                      );
                    }
                  : undefined
              }
              onPointerDown={handleStagePointerDown}
              onPointerMove={handleStagePointerMove}
              onPointerUp={endStageDrag}
              onPointerCancel={endStageDrag}
            >
              <div
                key={entry.id}
                class={
                  direction === "prev"
                    ? "file-preview-slide from-left"
                    : "file-preview-slide from-right"
                }
                style={
                  dragX ? { transform: `translateX(${dragX}px)` } : undefined
                }
              >
                {image ? (
                  <img
                    src={previewSrc}
                    alt={entry.name}
                    class="file-preview-image"
                    draggable={false}
                    style={{ transform: `scale(${zoom / 100})` }}
                  />
                ) : (
                  <div class="file-preview-card">
                    <img
                      src={thumbnailUrl(entry)}
                      alt=""
                      width={64}
                      height={64}
                    />
                    <dl class="file-preview-rows">
                      <div class="file-preview-row">
                        <dt>Name</dt>
                        <dd>{entry.name}</dd>
                      </div>
                      <div class="file-preview-row">
                        <dt>Size</dt>
                        <dd>{formatBytes(entry.size)}</dd>
                      </div>
                      <div class="file-preview-row">
                        <dt>Modified</dt>
                        <dd>{formatDate(entry.modifiedAt).date}</dd>
                      </div>
                      <div class="file-preview-row">
                        <dt>Type</dt>
                        <dd>
                          {entry.kind === "folder"
                            ? "folder"
                            : (entry.ext ?? "file")}
                        </dd>
                      </div>
                    </dl>
                  </div>
                )}
              </div>
            </div>

            <button
              type="button"
              class="file-preview-nav ghost icon lg next"
              data-tooltip="Next"
              aria-label="Next file"
              disabled={!canLoop}
              onClick={goNext}
            >
              <ArrowRightIcon />
            </button>
          </div>

          {image && (
            <div class="file-preview-zoom">
              <button
                type="button"
                class="ghost icon sm"
                data-tooltip="Zoom out"
                aria-label="Zoom out"
                onClick={() => zoomBy(-ZOOM_STEP)}
              >
                <MinusIcon />
              </button>
              <input
                type="text"
                inputMode="numeric"
                class="file-preview-zoom-input"
                aria-label="Zoom level"
                value={`${zoom}%`}
                onInput={(event) => {
                  const digits = (
                    event.currentTarget as HTMLInputElement
                  ).value.replace(/[^0-9]/g, "");
                  if (digits)
                    setZoom(
                      Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(digits))),
                    );
                }}
              />
              <button
                type="button"
                class="ghost icon sm"
                data-tooltip="Zoom in"
                aria-label="Zoom in"
                onClick={() => zoomBy(ZOOM_STEP)}
              >
                <PlusIcon />
              </button>
            </div>
          )}

          {scope.length > 1 && (
            <div
              class="file-preview-filmstrip"
              role="listbox"
              aria-label="Files in this folder"
            >
              {scope.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  class={
                    item.id === entry.id
                      ? "file-preview-filmstrip-item active"
                      : "file-preview-filmstrip-item"
                  }
                  aria-selected={item.id === entry.id}
                  onClick={() => onNavigate(item.id)}
                >
                  <img
                    src={item.previewUrl ?? thumbnailUrl(item)}
                    alt={item.name}
                    width={40}
                    height={40}
                  />
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </dialog>
  );
}

// ---------------------------------------------------------------- Main

/**
 * A browsable list/grid over `source`: navigating into a folder lazily calls
 * `source.list()` the first time it's visited, and move/copy/delete/rename/
 * replace/upload/createFolder each call the matching `source` method (hidden
 * from the UI entirely when `source` doesn't implement it) before
 * re-fetching whatever folder they touched - `source` is the single source
 * of truth, not a local copy. Also doubles as a file *picker* - the same
 * checkbox/radio selection that drives the bulk-action Snackbar is reported
 * through `value`/`onChange`, so dropping this inside a host dialog is
 * enough to let it pick file(s) for some other field.
 */
export default function FileManager({
  source,
  value,
  onChange,
  multiple = true,
  accept,
  defaultView = "list",
}: FileManagerProps) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(() =>
    readFolderFromUrl(),
  );
  // Establishes a baseline history entry for whatever folder we opened on
  // (root or one restored from the URL), so the very first back-button press
  // doesn't skip past it.
  useEffect(() => {
    writeFolderToUrl(currentFolderId, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Back/forward moves between folders the same way clicking into one does.
  useEffect(() => {
    const onPopState = (event: PopStateEvent) => {
      const state = event.state as { [FOLDER_QUERY_KEY]?: string | null } | null;
      const id =
        state && FOLDER_QUERY_KEY in state
          ? (state[FOLDER_QUERY_KEY] ?? null)
          : readFolderFromUrl();
      setCurrentFolderId(id);
      setQuery("");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  /** Centralizes the two user-driven navigations (opening a folder,
   * clicking a breadcrumb) so both stay in sync with browser history. */
  const goToFolder = (id: string | null) => {
    setCurrentFolderId(id);
    setQuery("");
    writeFolderToUrl(id, false);
  };
  const [loadedFolders, setLoadedFolders] = useState<Set<string | null>>(
    () => new Set(),
  );
  const [loadingFolders, setLoadingFolders] = useState<Set<string | null>>(
    () => new Set(),
  );
  /** Disables the buttons most likely to be double-clicked (dialog submits,
   * clipboard paste) while a `source` write is in flight. */
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<"list" | "grid">(() =>
    readStoredView(defaultView),
  );
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, view);
    } catch {
      // Storage unavailable (private browsing, quota, ...) - the choice just won't survive reload.
    }
  }, [view]);
  const [query, setQuery] = useState("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [uncontrolledSelected, setUncontrolledSelected] = useState<string[]>(
    [],
  );
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<MoveCopyState>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  /** ids currently being dragged (drag-to-move a file/folder into a folder),
   * and the id of the folder currently hovered as a drop target. */
  const [dragIds, setDragIds] = useState<string[] | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  /** Same idea for the breadcrumb, which can also be dropped onto. `null`
   * means "Root" is hovered - distinct from `undefined` (nothing hovered),
   * since a folder's own id can't stand in for "no target" the way it does
   * for `dragOverId` above. */
  const [breadcrumbDragOverId, setBreadcrumbDragOverId] = useState<
    string | null | undefined
  >(undefined);
  const [previewOn, setPreviewOn] = useState(() => readStoredPreview(false));
  useEffect(() => {
    try {
      localStorage.setItem(PREVIEW_STORAGE_KEY, String(previewOn));
    } catch {
      // Storage unavailable (private browsing, quota, ...) - the choice just won't survive reload.
    }
  }, [previewOn]);

  /** Fetches `folderId`'s children and replaces any entries already loaded
   * for it - called both by the lazy-load effect below (first visit) and
   * directly by mutation handlers (forced refresh after a write, since `id`
   * is a path and a move/copy/rename/upload/createFolder can change or add
   * ids that a local patch can't safely predict). */
  const loadFolder = async (folderId: string | null) => {
    setLoadingFolders((current) => new Set(current).add(folderId));
    try {
      const fresh = await source.list(folderId);
      setEntries((current) => [
        ...current.filter((entry) => entry.parentId !== folderId),
        ...fresh,
      ]);
      setLoadedFolders((current) => new Set(current).add(folderId));
    } catch {
      toast.add({ title: "Couldn't load this folder", type: "error" });
    } finally {
      setLoadingFolders((current) => {
        const next = new Set(current);
        next.delete(folderId);
        return next;
      });
    }
  };

  /** Invalidates `folderId`'s cached listing and immediately re-fetches it -
   * used where a write's result can't be predicted client-side (copy's
   * dedupe-suffixed destination name). */
  const refreshFolder = async (folderId: string | null) => {
    setLoadedFolders((current) => {
      const next = new Set(current);
      next.delete(folderId);
      return next;
    });
    await loadFolder(folderId);
  };

  /** Every mutation below applies its effect to `entries` optimistically,
   * *before* `source`'s write settles - the recovery path on failure is
   * always "invalidate and re-fetch the truth" for every folder the write
   * touched, never a blind revert to the pre-optimistic snapshot. That's
   * deliberate: `move`/`copy`/`remove` aren't atomic on every backend
   * (`github`'s each blob is its own commit; future R2/S3 is copy-then-delete
   * per key), so a failure can still have partially applied server-side - a
   * naive "undo my local guess" would then show something that doesn't match
   * the real server state. Re-fetching is correct either way: on a backend
   * where the write genuinely was all-or-nothing, it just confirms nothing
   * changed. */
  const revertAfterFailure = async (folderIds: (string | null)[]) => {
    const unique = [...new Set(folderIds)];
    setLoadedFolders((current) => {
      const next = new Set(current);
      for (const id of unique) next.delete(id);
      return next;
    });
    await Promise.all(unique.map((id) => loadFolder(id)));
  };

  /** `"pending"` until `source.listAll` (if present) settles - the lazy
   * per-folder effect below waits for this instead of racing it, so a
   * `listAll` source doesn't fire a redundant `list()` for whatever folder
   * happened to be open at mount before the full-tree prefetch lands.
   * `"unavailable"` covers both "no `listAll` on this source" and "this
   * backend doesn't support it" (a resolved `null`, or a rejected promise) -
   * either way, callers fall back to `list()` exactly as before. */
  const [treePrefetch, setTreePrefetch] = useState<"pending" | "unavailable" | "done">(
    () => (source.listAll ? "pending" : "unavailable"),
  );

  // Prefetches the whole tree once per `source`, when it supports one -
  // replaces the lazy per-folder loading entirely on success (every folder is
  // marked loaded up front), and defers to it untouched on failure/`null`.
  useEffect(() => {
    if (!source.listAll) {
      setTreePrefetch("unavailable");
      return;
    }
    let cancelled = false;
    setTreePrefetch("pending");
    source
      .listAll()
      .then((all) => {
        if (cancelled) return;
        if (all === null) {
          setTreePrefetch("unavailable");
          return;
        }
        setEntries(all);
        setLoadedFolders((current) => {
          const next = new Set(current);
          next.add(null);
          for (const entry of all) if (entry.kind === "folder") next.add(entry.id);
          return next;
        });
        setTreePrefetch("done");
      })
      .catch(() => {
        if (!cancelled) setTreePrefetch("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

  // Lazy-loads whatever folder is currently open, the first time it's
  // visited. Deliberately excludes `loadedFolders`/`loadingFolders` from the
  // deps - both are written by this same effect (via `loadFolder`), and
  // re-running on every write to them would refetch on a loop; it only needs
  // to react to *navigating somewhere new*, which `currentFolderId` already
  // captures. Mutation handlers force a refresh directly via `refreshFolder`
  // instead of going through this effect.
  useEffect(() => {
    if (treePrefetch === "pending") return;
    if (
      loadedFolders.has(currentFolderId) ||
      loadingFolders.has(currentFolderId)
    ) {
      return;
    }
    loadFolder(currentFolderId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFolderId, source, treePrefetch]);

  const selectedIds =
    value === undefined
      ? uncontrolledSelected
      : Array.isArray(value)
        ? value
        : value
          ? [value]
          : [];

  const setSelection = (ids: string[]) => {
    if (value === undefined) setUncontrolledSelected(ids);
    onChange?.(multiple ? ids : (ids[0] ?? ""));
  };

  const scoped = useMemo(
    () =>
      entries.filter(
        (entry) => entry.parentId === currentFolderId && !isHiddenEntry(entry),
      ),
    [entries, currentFolderId],
  );
  const searched = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle
      ? scoped.filter((entry) => entry.name.toLowerCase().includes(needle))
      : scoped;
  }, [scoped, query]);
  const visible = useMemo(
    () => sortEntries(searched, sortDir),
    [searched, sortDir],
  );
  const breadcrumb = useMemo(
    () => folderPath(entries, currentFolderId),
    [entries, currentFolderId],
  );

  /** Selection is frozen while there's something waiting to be pasted - browsing
   * to the destination shouldn't also let you pile more onto the clipboard. */
  const selectionLocked = clipboard !== null;
  const isDisabled = (entry: FileEntry) =>
    selectionLocked || !isAccepted(entry, accept);
  const selectableVisible = visible.filter((entry) => !isDisabled(entry));
  const allSelected =
    selectableVisible.length > 0 &&
    selectableVisible.every((entry) => selectedIds.includes(entry.id));
  const toggleAll = () =>
    setSelection(allSelected ? [] : selectableVisible.map((entry) => entry.id));

  const toggleSelect = (entry: FileEntry) => {
    if (isDisabled(entry)) return;
    const isSelected = selectedIds.includes(entry.id);
    if (multiple)
      setSelection(
        isSelected
          ? selectedIds.filter((id) => id !== entry.id)
          : [...selectedIds, entry.id],
      );
    else setSelection(isSelected ? [] : [entry.id]);
  };

  const openEntry = (entry: FileEntry, event?: MouseEvent) => {
    if (event && (event.metaKey || event.ctrlKey)) {
      toggleSelect(entry);
      return;
    }
    if (entry.kind === "folder") {
      goToFolder(entry.id);
    } else {
      setPreviewId(entry.id);
    }
  };

  /** Drag-to-move: whatever's dragged is either the whole current selection
   * (if the dragged entry is part of it) or just that one entry. */
  const canDrag = (entry: FileEntry) =>
    !!source.move && !isDisabled(entry) && !busy;
  /** Shared by the grid/list folder rows and the breadcrumb (incl. "Root",
   * `targetId === null`): can't drop onto the folder already open, onto one
   * of the dragged items itself, or onto one of their own descendants. */
  const canDropOnFolder = (targetId: string | null, ids: string[]) => {
    if (targetId === currentFolderId) return false;
    if (targetId !== null && ids.includes(targetId)) return false;
    return !(
      targetId !== null &&
      ids.some((id) => collectDescendantIds(entries, id).has(targetId))
    );
  };
  const canDropOn = (target: FileEntry, ids: string[]) =>
    target.kind === "folder" && canDropOnFolder(target.id, ids);
  const onDragStartEntry = (entry: FileEntry) => (event: DragEvent) => {
    if (!canDrag(entry)) {
      event.preventDefault();
      return;
    }
    const ids = selectedIds.includes(entry.id) ? selectedIds : [entry.id];
    setDragIds(ids);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", entry.id);
    }
  };
  const onDragEndEntry = () => {
    setDragIds(null);
    setDragOverId(null);
    setBreadcrumbDragOverId(undefined);
  };
  const onDragOverEntry = (entry: FileEntry) => (event: DragEvent) => {
    if (!dragIds || !canDropOn(entry, dragIds)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    setDragOverId(entry.id);
  };
  const onDragLeaveEntry = (entry: FileEntry) => () => {
    setDragOverId((current) => (current === entry.id ? null : current));
  };
  const onDropEntry = (entry: FileEntry) => (event: DragEvent) => {
    event.preventDefault();
    const ids = dragIds;
    setDragIds(null);
    setDragOverId(null);
    if (ids && canDropOn(entry, ids)) moveEntriesInto(ids, entry.id);
  };
  const onDragOverBreadcrumb = (targetId: string | null) => (event: DragEvent) => {
    if (!dragIds || !canDropOnFolder(targetId, dragIds)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    setBreadcrumbDragOverId(targetId);
  };
  const onDragLeaveBreadcrumb = (targetId: string | null) => () => {
    setBreadcrumbDragOverId((current) => (current === targetId ? undefined : current));
  };
  const onDropBreadcrumb = (targetId: string | null) => (event: DragEvent) => {
    event.preventDefault();
    const ids = dragIds;
    setDragIds(null);
    setBreadcrumbDragOverId(undefined);
    if (ids && canDropOnFolder(targetId, ids)) moveEntriesInto(ids, targetId);
  };

  /** Optimistically relocates each id into `targetId` (deterministic
   * destination: `target/basename`, matching what the server computes too),
   * then reconciles with the server's authoritative entries on success or
   * re-fetches every folder the move could have touched on failure - shared
   * by drag-and-drop (`moveEntriesInto`) and the clipboard's Move/Paste flow
   * (`pasteClipboard`). Returns whether it succeeded. */
  const performMove = async (ids: string[], targetId: string | null): Promise<boolean> => {
    if (!source.move) return false;
    const sourceFolderIds = ids.map((id) => entries.find((entry) => entry.id === id)?.parentId ?? null);
    const affectedFolderIds = [...sourceFolderIds, targetId, currentFolderId];

    setEntries((current) => {
      let next = current;
      for (const id of ids) {
        const entry = next.find((e) => e.id === id);
        if (entry) next = retargetSubtree(next, id, targetId, entry.name);
      }
      return next;
    });

    setBusy(true);
    try {
      const moved = await source.move(ids, targetId);
      // Descendants of a moved folder keep their optimistic (but
      // deterministic, so correct) path rewrite - only the top-level moved
      // ids get server-confirmed data back from a batch move.
      const byId = new Map(moved.map((entry) => [entry.id, entry]));
      setEntries((current) => current.map((entry) => byId.get(entry.id) ?? entry));
      return true;
    } catch {
      toast.add({ title: "Couldn't move - try again", type: "error" });
      await revertAfterFailure(affectedFolderIds);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const moveEntriesInto = async (ids: string[], targetId: string | null) => {
    if (!(await performMove(ids, targetId))) return;
    setSelection(selectedIds.filter((id) => !ids.includes(id)));
  };

  const navigateBreadcrumb = (id: string | null) => {
    goToFolder(id);
  };

  const deleteEntries = async (ids: string[]) => {
    if (!source.remove) return;
    const toRemove = new Set<string>();
    for (const id of ids)
      for (const descendant of collectDescendantIds(entries, id))
        toRemove.add(descendant);
    // Folders among the removed set: if the delete turns out to have failed,
    // these need re-fetching too (not just currentFolderId) - otherwise
    // navigating back into a wrongly-purged subfolder would show an
    // incorrect, empty cached listing instead of re-querying it.
    const removedFolderIds = entries
      .filter((entry) => toRemove.has(entry.id) && entry.kind === "folder")
      .map((entry) => entry.id);

    // Optimistic: reflect the delete immediately, before the request settles.
    setEntries((current) => current.filter((entry) => !toRemove.has(entry.id)));
    setSelection(selectedIds.filter((id) => !toRemove.has(id)));
    if (previewId && toRemove.has(previewId)) setPreviewId(null);

    setBusy(true);
    try {
      await source.remove(ids);
    } catch {
      toast.add({ title: "Couldn't delete - try again", type: "error" });
      await revertAfterFailure([currentFolderId, ...removedFolderIds]);
    } finally {
      setBusy(false);
    }
  };

  /* Clears the current selection so the (also sticky, bottom-of-screen)
   * selection bar hands off to the clipboard bar instead of stacking with it. */
  const requestMove = (ids: string[]) => {
    setClipboard({ mode: "move", ids });
    setSelection([]);
    toast.add({
      title: `${ids.length} item${ids.length === 1 ? "" : "s"} ready to paste`,
      type: "info",
    });
  };
  const requestCopy = (ids: string[]) => {
    setClipboard({ mode: "copy", ids });
    setSelection([]);
    toast.add({
      title: `${ids.length} item${ids.length === 1 ? "" : "s"} ready to paste`,
      type: "info",
    });
  };

  /** Self + every descendant of each clipboard item - can't paste a folder into itself or its own subtree. */
  const clipboardBlocked = useMemo(() => {
    const set = new Set<string>();
    if (!clipboard) return set;
    for (const id of clipboard.ids)
      for (const descendant of collectDescendantIds(entries, id))
        set.add(descendant);
    return set;
  }, [clipboard, entries]);
  const canPaste =
    clipboard !== null &&
    (currentFolderId === null || !clipboardBlocked.has(currentFolderId));

  const pasteClipboard = async () => {
    if (!clipboard || !canPaste) return;
    const { mode, ids } = clipboard;
    const targetId = currentFolderId;

    if (mode === "move") {
      if (!(await performMove(ids, targetId))) return;
      setSelection([]);
      setClipboard(null);
      return;
    }

    // Copy's destination name isn't predictable client-side (the server
    // auto-suffixes a collision - "name copy", "name copy 2", ... - and
    // duplicating that dedupe logic here could drift from what it actually
    // decides), so this stays "await once, then merge the real result"
    // rather than an optimistic guess.
    if (!source.copy) return;
    setBusy(true);
    try {
      await source.copy(ids, targetId);
    } catch {
      toast.add({ title: "Couldn't copy - try again", type: "error" });
      await revertAfterFailure([targetId]);
      return;
    } finally {
      setBusy(false);
    }

    await refreshFolder(targetId);
    setSelection([]);
    setClipboard(null);
  };

  const renameTargetEntry = renameId
    ? (entries.find((entry) => entry.id === renameId) ?? null)
    : null;
  const submitRename = async (name: string) => {
    if (!renameId || !source.rename) return;
    const oldId = renameId;
    const target = entries.find((entry) => entry.id === oldId);
    if (!target) return;
    const parentId = target.parentId;
    const guessedId = parentId ? `${parentId}/${name}` : name;

    // Optimistic: `id` is a path, so this hands back a *different* id -
    // carry the selection/preview over to the guessed one immediately rather
    // than waiting on the server to confirm it.
    setEntries((current) => retargetSubtree(current, oldId, parentId, name));
    setRenameId(null);
    if (selectedIds.includes(oldId)) {
      setSelection(selectedIds.map((id) => (id === oldId ? guessedId : id)));
    }
    if (previewId === oldId) setPreviewId(guessedId);

    setBusy(true);
    try {
      const updated = await source.rename(oldId, name);
      setEntries((current) => current.map((entry) => (entry.id === updated.id ? updated : entry)));
    } catch {
      toast.add({ title: "Couldn't rename - try again", type: "error" });
      if (selectedIds.includes(guessedId)) {
        setSelection(selectedIds.map((id) => (id === guessedId ? oldId : id)));
      }
      if (previewId === guessedId) setPreviewId(oldId);
      await revertAfterFailure([currentFolderId, parentId]);
    } finally {
      setBusy(false);
    }
  };

  const replaceInputRef = useRef<HTMLInputElement>(null);
  const replaceTargetId = useRef<string | null>(null);
  /** Only a file with the same extension as the target can replace it - the
   * picker is restricted via `accept` rather than just checked after the fact. */
  const requestReplace = (id: string) => {
    replaceTargetId.current = id;
    const target = entries.find((entry) => entry.id === id);
    if (replaceInputRef.current) {
      replaceInputRef.current.accept = target?.ext ? `.${target.ext}` : "";
    }
    replaceInputRef.current?.click();
  };
  const handleReplaceFile = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    const id = replaceTargetId.current;
    input.value = "";
    if (!file || !id || !source.replace) return;
    const target = entries.find((entry) => entry.id === id);
    const targetExt = target?.ext?.toLowerCase();
    const fileExt = file.name.includes(".")
      ? file.name.split(".").pop()!.toLowerCase()
      : undefined;
    // The `accept` filter on the input is a soft hint (some pickers still let
    // "All files" through), so the extension is re-checked here too.
    if (targetExt && fileExt !== targetExt) {
      toast.add({
        title: `Replacement must be a .${targetExt} file`,
        type: "error",
      });
      return;
    }

    // Replace overwrites bytes at the *same* path - `id` doesn't churn, so an
    // optimistic patch (client-known size + a real object URL for images)
    // can go straight into `entries` before the request even starts.
    const optimisticPreview = file.type.startsWith("image/")
      ? URL.createObjectURL(file)
      : target?.previewUrl;
    setEntries((current) =>
      current.map((entry) =>
        entry.id === id
          ? { ...entry, size: file.size, modifiedAt: new Date().toISOString(), previewUrl: optimisticPreview }
          : entry,
      ),
    );

    setBusy(true);
    try {
      const updated = await source.replace(id, file);
      setEntries((current) =>
        current.map((entry) => (entry.id === id ? { ...updated, previewUrl: optimisticPreview } : entry)),
      );
    } catch {
      toast.add({ title: "Couldn't replace - try again", type: "error" });
      await revertAfterFailure([currentFolderId]);
    } finally {
      setBusy(false);
    }
  };

  const submitUpload = async (files: File[]) => {
    if (!source.upload) return;
    const folderId = currentFolderId;
    // Optimistic placeholders, one per file, using client-known
    // name/size/(object-URL preview) - upload rejects on a name collision
    // rather than silently renaming (see `routes/storage.ts`), so unlike
    // `copy` the destination path here *is* predictable.
    const placeholders: FileEntry[] = files.map((file) => {
      const dot = file.name.lastIndexOf(".");
      return {
        id: folderId ? `${folderId}/${file.name}` : file.name,
        name: file.name,
        parentId: folderId,
        kind: "file",
        ext: dot > 0 ? file.name.slice(dot + 1).toLowerCase() : undefined,
        size: file.size,
        modifiedAt: new Date().toISOString(),
        previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
      };
    });
    setEntries((current) => [...current, ...placeholders]);
    setUploadOpen(false);

    setBusy(true);
    try {
      const uploaded = await source.upload(folderId, files);
      const placeholderIds = new Set(placeholders.map((entry) => entry.id));
      setEntries((current) => [...current.filter((entry) => !placeholderIds.has(entry.id)), ...uploaded]);
    } catch {
      toast.add({ title: "Couldn't upload - try again", type: "error" });
      // A batch upload isn't all-or-nothing (the route writes files one at a
      // time and stops at the first collision) - some may have actually
      // landed server-side, so recovery is a real re-fetch, not just
      // dropping the placeholders.
      await revertAfterFailure([folderId]);
    } finally {
      setBusy(false);
    }
  };

  const createFolder = async (name: string) => {
    if (!source.createFolder) return;
    const folderId = currentFolderId;
    const placeholder: FileEntry = {
      id: folderId ? `${folderId}/${name}` : name,
      name,
      parentId: folderId,
      kind: "folder",
      size: 0,
      fileCount: 0,
      modifiedAt: new Date().toISOString(),
    };
    setEntries((current) => [...current, placeholder]);
    setNewFolderOpen(false);

    setBusy(true);
    try {
      const created = await source.createFolder(folderId, name);
      setEntries((current) => current.map((entry) => (entry.id === placeholder.id ? created : entry)));
    } catch {
      toast.add({ title: "Couldn't create folder - try again", type: "error" });
      await revertAfterFailure([folderId]);
    } finally {
      setBusy(false);
    }
  };

  const previewEntry = previewId
    ? (entries.find((entry) => entry.id === previewId) ?? null)
    : null;
  const previewScope = useMemo(
    () => visible.filter((entry) => entry.kind === "file"),
    [visible],
  );
  const currentPathLabel =
    breadcrumb.length === 0
      ? "/"
      : `/${breadcrumb.map((entry) => entry.name).join("/")}`;

  const renderMore = (entry: FileEntry) => (
    <MoreMenu
      label={entry.name}
      onRename={source.rename ? () => setRenameId(entry.id) : undefined}
      onReplace={
        entry.kind === "folder" || !source.replace
          ? undefined
          : () => requestReplace(entry.id)
      }
      onCopy={source.copy ? () => requestCopy([entry.id]) : undefined}
      onMove={source.move ? () => requestMove([entry.id]) : undefined}
      onDelete={source.remove ? () => deleteEntries([entry.id]) : undefined}
    />
  );

  /** Drives the small spinner next to the view toggle - covers both the
   * first visit to a folder *and* the refetch every mutation triggers, so
   * the toolbar signals "working" without ever swapping `entries` out for
   * skeleton placeholders (the list/grid just keep showing what they had). */
  const folderLoading = treePrefetch === "pending" || loadingFolders.has(currentFolderId);

  return (
    <div class="file-manager">
      <input
        ref={replaceInputRef}
        type="file"
        hidden
        onChange={handleReplaceFile}
      />

      <Breadcrumb
        chain={breadcrumb}
        onNavigate={navigateBreadcrumb}
        dragOverId={breadcrumbDragOverId}
        onDragOver={onDragOverBreadcrumb}
        onDragLeave={onDragLeaveBreadcrumb}
        onDrop={onDropBreadcrumb}
      />
      <Toolbar
        query={query}
        onQuery={setQuery}
        view={view}
        onView={setView}
        onNewFolder={
          source.createFolder ? () => setNewFolderOpen(true) : undefined
        }
        onUpload={source.upload ? () => setUploadOpen(true) : undefined}
        previewOn={previewOn}
        onTogglePreview={() => setPreviewOn((current) => !current)}
        loading={folderLoading}
      />

      {view === "grid" &&
        (clipboard ? (
          <ClipboardBar
            mode={clipboard.mode}
            count={clipboard.ids.length}
            canPaste={canPaste && !busy}
            onPaste={pasteClipboard}
            onCancel={() => setClipboard(null)}
          />
        ) : (
          <SelectionBar
            count={selectedIds.length}
            multiple={multiple}
            allSelected={allSelected}
            locked={selectionLocked}
            onSelectAll={() =>
              setSelection(selectableVisible.map((entry) => entry.id))
            }
            onUnselectAll={() => setSelection([])}
            onMove={source.move ? () => requestMove(selectedIds) : undefined}
            onCopy={source.copy ? () => requestCopy(selectedIds) : undefined}
            onDelete={
              source.remove ? () => deleteEntries(selectedIds) : undefined
            }
          />
        ))}

      {view === "list" ? (
        <ListView
          entries={visible}
          selectedIds={selectedIds}
          clipboard={clipboard}
          isDisabled={isDisabled}
          sortDir={sortDir}
          onSort={() =>
            setSortDir((current) => (current === "asc" ? "desc" : "asc"))
          }
          onToggle={toggleSelect}
          onOpen={openEntry}
          more={renderMore}
          canDrag={canDrag}
          dragOverId={dragOverId}
          onDragStartEntry={onDragStartEntry}
          onDragEndEntry={onDragEndEntry}
          onDragOverEntry={onDragOverEntry}
          onDragLeaveEntry={onDragLeaveEntry}
          onDropEntry={onDropEntry}
          preview={previewOn}
          multiple={multiple}
          allSelected={allSelected}
          onToggleAll={toggleAll}
          onUnselect={() => setSelection([])}
          locked={selectionLocked}
          onMove={source.move ? () => requestMove(selectedIds) : undefined}
          onCopy={source.copy ? () => requestCopy(selectedIds) : undefined}
          onDelete={
            source.remove ? () => deleteEntries(selectedIds) : undefined
          }
          canPaste={canPaste && !busy}
          onPasteClipboard={pasteClipboard}
          onCancelClipboard={() => setClipboard(null)}
        />
      ) : (
        <GridView
          entries={visible}
          selectedIds={selectedIds}
          clipboard={clipboard}
          isDisabled={isDisabled}
          onToggle={toggleSelect}
          onOpen={openEntry}
          more={renderMore}
          canDrag={canDrag}
          dragOverId={dragOverId}
          onDragStartEntry={onDragStartEntry}
          onDragEndEntry={onDragEndEntry}
          onDragOverEntry={onDragOverEntry}
          onDragLeaveEntry={onDragLeaveEntry}
          onDropEntry={onDropEntry}
          preview={previewOn}
        />
      )}

      <RenameDialog
        target={renameTargetEntry}
        onClose={() => setRenameId(null)}
        onSubmit={submitRename}
        busy={busy}
      />
      <NewFolderDialog
        open={newFolderOpen}
        onClose={() => setNewFolderOpen(false)}
        onSubmit={createFolder}
        busy={busy}
      />
      <UploadDialog
        open={uploadOpen}
        folderPathLabel={currentPathLabel}
        onClose={() => setUploadOpen(false)}
        onSubmit={submitUpload}
        busy={busy}
      />
      <PreviewDialog
        entry={previewEntry}
        scope={previewScope}
        onClose={() => setPreviewId(null)}
        onNavigate={setPreviewId}
        onRename={source.rename ? (id) => setRenameId(id) : undefined}
        onReplace={source.replace ? requestReplace : undefined}
        onCopy={
          source.copy
            ? (id) => {
                requestCopy([id]);
                setPreviewId(null);
              }
            : undefined
        }
        onMove={
          source.move
            ? (id) => {
                requestMove([id]);
                setPreviewId(null);
              }
            : undefined
        }
        onDelete={source.remove ? (id) => deleteEntries([id]) : undefined}
      />
    </div>
  );
}
