import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ComponentChildren, CSSProperties } from "preact";
import { readCachedFile } from "./file-manager-blob-cache.js";
import {
  canOptimizeStoredImage,
  canOptimizeUploadImage,
  optimizedUploadName,
  optimizeUploadImage,
  OPTIMIZE_QUALITY_MIN,
  OPTIMIZE_QUALITY_MAX,
  OPTIMIZED_IMAGE_QUALITY,
  readImageDimensions,
  renderResizedImage,
} from "./file-manager-image-optimize.js";
import type { FileEntry, FileManagerSource } from "../../storage/entry-types.js";
import NumberField from "../fields/NumberField.js";
import TextField from "../fields/TextField.js";
import { useDialogSync } from "../../hooks/list-nav.js";
import { useOverlayScrollbars } from "../../hooks/overlayscrollbars.js";
import { useStore } from "../../hooks/useStore.js";
import {
  collectDescendantIds,
  folderPath,
  formatBytes,
  formatDate,
  isAccepted,
  isHiddenEntry,
  isImageEntry,
  isSvgEntry,
  namesEqual,
  retargetSubtree,
  sortEntries,
  thumbnailUrl,
} from "../../storage/entry-utils.js";
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
  LockIcon,
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
  type IconProps,
} from "../icons/index.js";
import { toast } from "../Toast.js";
import ConfirmDialog from "../ConfirmDialog.js";
import FileManagerUploadArtwork from "./FileManagerUploadArtwork.js";
import Popover, { type PopoverMenuEntry } from "../Popover.js";
import Search from "../Search.js";

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
  /** Seeds the folder open on mount, taking priority over the URL-restored
   * one (`?dry_folder=`). For a host that remounts `FileManager` fresh each
   * time it's shown inside a picker dialog - e.g. reopening at whatever
   * folder the current selection already lives in, instead of wherever the
   * page's URL happens to say. */
  initialFolderId?: string | null;
  /** Whether folder navigation reads/writes the host page's URL and
   * browser history. Set `false` for a `FileManager` embedded in a picker
   * dialog (e.g. `ImageField`) - otherwise browsing folders in the dialog
   * pushes history entries onto the page behind it. @default true */
  syncUrl?: boolean;
}

type MoveCopyState = { mode: "move" | "copy"; ids: string[] } | null;

const FOLDER_QUERY_KEY = "dry_folder";

/** Renders an SVG preview (see `isSvgEntry`) as a `currentColor`-tinted CSS
 * mask instead of a plain `<img>` - same technique as `IconGlyph`, just
 * sized through `class`/`style` (the caller's existing thumbnail box)
 * instead of a fixed square, since these previews land in four differently
 * shaped contexts (list row, grid card, filmstrip, full-size dialog) rather
 * than one icon slot. */
function SvgMaskPreview({
  src,
  class: className,
  style,
}: {
  src: string;
  class?: string;
  style?: CSSProperties;
}) {
  const mask = `url('${src}') no-repeat center / contain`;
  return (
    <span
      aria-hidden="true"
      class={className}
      style={{ display: "block", backgroundColor: "currentColor", WebkitMask: mask, mask, ...style }}
    />
  );
}

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

/** Gates the "Optimize" action to entries `renderResizedImage` can actually
 * decode/re-encode - the same extension allowlist upload's own optimize step
 * uses (`canOptimizeStoredImage`), plus the `file` kind check folders don't
 * carry an `ext` to test in the first place. */
function canOptimizeEntry(entry: FileEntry): boolean {
  return entry.kind === "file" && canOptimizeStoredImage(entry.ext);
}

/** Not part of the generated `icons/index.tsx` set (`scripts/build-icons.mjs`
 * only pulls from Solar/Lucide) - a one-off "shrink" glyph used solely for
 * the Optimize menu item below, so it's kept local instead. */
function OptimizeIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 20 20" width="1em" height="1em" aria-hidden="true" {...props}>
      <path
        fill="currentColor"
        d="M8.5 3H6a3 3 0 0 0-3 3v.5a.5.5 0 0 0 1 0V6a2 2 0 0 1 2-2h2.5a.5.5 0 0 0 0-1M3 14a3 3 0 0 0 3 3h3a3 3 0 0 0 3-3v-3a3 3 0 0 0-3-3H6a3 3 0 0 0-3 3zm10.5 3a.5.5 0 0 1 0-1h.5a2 2 0 0 0 2-2v-2.5a.5.5 0 0 1 1 0V14a3 3 0 0 1-3 3zM17 8.5a.5.5 0 0 1-1 0V6a2 2 0 0 0-2-2h-2.5a.5.5 0 0 1 0-1H14a3 3 0 0 1 3 3z"
      />
    </svg>
  );
}

// --------------------------------------------------------------- More menu

interface MoreMenuProps {
  label: string;
  /** Every action is optional - omitted when `source` doesn't support it (see
   * `FileManagerSource`), the same way `onReplace` was already conditionally
   * omitted for folders. Renders nothing if every action ends up omitted. */
  onRename?: () => void;
  onReplace?: () => void;
  /** Omitted for non-optimizable entries (folders, and any file extension
   * outside `OPTIMIZABLE_IMAGE_EXTENSIONS`) as well as when `source` supports
   * neither `replace` nor `upload` - see `canOptimizeStoredImage`. */
  onOptimize?: () => void;
  onCopy?: () => void;
  onMove?: () => void;
  onDelete?: () => void;
}

/** Row-level equivalent of the selection bar's Copy/Move/Delete trio - picking
 * one here acts on just this entry (it's put in the clipboard, or deleted,
 * on its own) without requiring the row's checkbox to be ticked first. Thin
 * wrapper around the generic `Popover`. */
function MoreMenu({
  label,
  onRename,
  onReplace,
  onOptimize,
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
  if (onOptimize)
    items.push({
      type: "item",
      label: "Optimize",
      icon: <OptimizeIcon />,
      onClick: onOptimize,
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
      <Search
        value={query}
        onChange={onQuery}
        placeholder="Search this folder…"
        style={{ maxWidth: "18rem" }}
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
  /** Wrong file type per `accept` - dimmed with low opacity, distinct from `isDisabled`'s other reasons (see the main component's comment). */
  isNotAccepted: (entry: FileEntry) => boolean;
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
  isNotAccepted,
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
  const { ref: scroll } = useOverlayScrollbars<HTMLDivElement>();
  return (
    <div class="scroll" ref={scroll}>
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
                <div class="center" style={{ height: 200 }}>
                  No files.
                </div>
              </td>
            </tr>
          ) : (
            entries.map((entry) => {
              const selected = selectedIds.includes(entry.id);
              const pending = clipboard?.ids.includes(entry.id) ?? false;
              const disabled = isDisabled(entry);
              const notAccepted = isNotAccepted(entry);
              const { date, time } = formatDate(entry.modifiedAt);
              const isDropTarget = entry.kind === "folder";
              return (
                <tr
                  key={entry.id}
                  class={
                    [
                      pending ? "pending" : selected ? "selected" : null,
                      notAccepted ? "not-accepted" : null,
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
                        isSvgEntry(entry) && entry.previewUrl ? (
                          <SvgMaskPreview
                            class="file-thumb-preview"
                            src={entry.previewUrl}
                          />
                        ) : (
                          <img
                            class="file-thumb-preview"
                            src={entry.previewUrl ?? thumbnailUrl(entry)}
                            alt=""
                          />
                        )
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
  isNotAccepted,
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
        const notAccepted = isNotAccepted(entry);
        const isDropTarget = entry.kind === "folder";
        const showMedia = preview && isImageEntry(entry);
        return (
          <div
            key={entry.id}
            class={[
              "file-card",
              showMedia ? "file-card-media" : null,
              pending ? "pending" : null,
              notAccepted ? "not-accepted" : null,
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
                {isSvgEntry(entry) && entry.previewUrl ? (
                  <SvgMaskPreview
                    class="file-card-media-image"
                    src={entry.previewUrl}
                  />
                ) : (
                  <img
                    class="file-card-media-image"
                    src={entry.previewUrl ?? thumbnailUrl(entry)}
                    alt=""
                  />
                )}
                <div class="file-card-media-overlay">
                  <label
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
                  </label>
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
  existingNames,
  onClose,
  onSubmit,
  busy,
}: {
  target: FileEntry | null;
  /** Sibling names in the same folder (the target itself excluded) - used to
   * catch a duplicate before it round-trips to the server as an
   * `already_exists` error. */
  existingNames: string[];
  onClose: () => void;
  onSubmit: (name: string) => void;
  busy: boolean;
}) {
  const ref = useDialogSync(target !== null, onClose);
  const [name, setName] = useState("");

  useEffect(() => {
    if (target) setName(target.name);
  }, [target]);

  const trimmed = name.trim();
  const duplicate =
    trimmed !== "" &&
    existingNames.some((existing) => namesEqual(existing, trimmed));

  return (
    <dialog ref={ref} aria-label="Rename">
      {target && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (trimmed && !duplicate) onSubmit(trimmed);
          }}
        >
          <header>
            <h3>Rename</h3>
          </header>
          <div class="field">
            <input
              type="text"
              value={name}
              aria-invalid={duplicate || undefined}
              onInput={(event) =>
                setName((event.currentTarget as HTMLInputElement).value)
              }
            />
            {duplicate && (
              <span class="error">"{trimmed}" already exists here.</span>
            )}
          </div>
          <footer>
            <button type="button" class="outline" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" disabled={busy || !trimmed || duplicate}>
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

interface UploadFileItem {
  id: string;
  file: File;
  canOptimize: boolean;
  optimize: boolean;
}

let uploadFileItemCounter = 0;

function createUploadFileItem(file: File): UploadFileItem {
  const canOptimize = canOptimizeUploadImage(file);
  uploadFileItemCounter += 1;
  return {
    id: `upload-file-${uploadFileItemCounter}`,
    file,
    canOptimize,
    optimize: canOptimize,
  };
}

async function prepareUploadFiles(
  items: UploadFileItem[],
): Promise<{ files: File[]; skippedOptimization: boolean }> {
  const files: File[] = [];
  let skippedOptimization = false;

  for (const item of items) {
    if (!item.canOptimize || !item.optimize) {
      files.push(item.file);
      continue;
    }
    try {
      files.push(await optimizeUploadImage(item.file));
    } catch {
      skippedOptimization = true;
      files.push(item.file);
    }
  }

  return { files, skippedOptimization };
}

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
  onSubmit: (files: UploadFileItem[]) => void;
  busy: boolean;
}) {
  const ref = useDialogSync(open, onClose);
  const [files, setFiles] = useState<UploadFileItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setFiles([]);
  }, [open]);

  const addFiles = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setFiles((current) => [
      ...current,
      ...Array.from(list).map(createUploadFileItem),
    ]);
  };

  const toggleOptimize = (id: string) => {
    setFiles((current) =>
      current.map((item) =>
        item.id === id ? { ...item, optimize: !item.optimize } : item,
      ),
    );
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
              {files.map((item, index) => (
                <li key={item.id}>
                  <div class="upload-file-info">
                    <span>{item.file.name}</span>
                    <small class="muted">
                      {formatBytes(item.file.size)}
                      {item.canOptimize && item.optimize
                        ? ` → ${optimizedUploadName(item.file.name)}`
                        : ""}
                    </small>
                  </div>
                  {item.canOptimize && (
                    <div class="toggle upload-file-optimize">
                      <input
                        id={`${item.id}-optimize`}
                        type="checkbox"
                        role="switch"
                        checked={item.optimize}
                        disabled={busy}
                        onChange={() => toggleOptimize(item.id)}
                      />
                      <label for={`${item.id}-optimize`}>Optimize</label>
                    </div>
                  )}
                  <button
                    type="button"
                    class="ghost icon sm"
                    data-tooltip="Remove"
                    aria-label={`Remove ${item.file.name}`}
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
              Upload
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
  /** Further gated on `canOptimizeEntry(entry)` below - unlike `onReplace`,
   * this doesn't make sense for every file type. */
  onOptimize?: (id: string) => void;
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
 * `contentHash` (future R2/S3 - see `StorageStatEntry.contentHash`)
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
  onOptimize,
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
  // Deps match the filmstrip's own mount condition (`entry && scope.length >
  // 1`) - the ref is still null until both are true.
  const { ref: filmstrip } = useOverlayScrollbars<HTMLDivElement>([
    entry !== null,
    scope.length > 1,
  ]);
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
                onOptimize={
                  onOptimize && canOptimizeEntry(entry)
                    ? () => onOptimize(entry.id)
                    : undefined
                }
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
                  isSvgEntry(entry) ? (
                    <SvgMaskPreview
                      src={previewSrc!}
                      class="file-preview-image"
                      style={{
                        width: "min(60vmin, 480px)",
                        height: "min(60vmin, 480px)",
                        transform: `scale(${zoom / 100})`,
                      }}
                    />
                  ) : (
                    <img
                      src={previewSrc}
                      alt={entry.name}
                      class="file-preview-image"
                      draggable={false}
                      style={{ transform: `scale(${zoom / 100})` }}
                    />
                  )
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
              ref={filmstrip}
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
                  {isSvgEntry(item) && item.previewUrl ? (
                    <SvgMaskPreview
                      src={item.previewUrl}
                      style={{ width: "100%", height: "100%" }}
                    />
                  ) : (
                    <img
                      src={item.previewUrl ?? thumbnailUrl(item)}
                      alt={item.name}
                      width={40}
                      height={40}
                    />
                  )}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </dialog>
  );
}

// ------------------------------------------------------------- Optimize

interface OptimizeImageDialogProps {
  entry: FileEntry | null;
  onClose: () => void;
  /** Overwrites `entry`'s own bytes at its current path - keeping its
   * existing name/extension even if the working bytes ended up WebP.
   * Omitted when `source.replace` isn't available. */
  onSave?: (id: string, file: File) => Promise<boolean>;
  /** Uploads the result as a new file in the current folder. Omitted when
   * `source.upload` isn't available. */
  onSaveAs?: (file: File) => Promise<boolean>;
}

/** Fetches `entry`'s current bytes, lets the user resize it (width/height,
 * optionally locked to its original aspect ratio - same UX as
 * `RichTextField/image-menu.tsx`'s "Edit image" dialog) and re-encode to
 * WebP at a chosen quality, then either overwrites the original in place or
 * saves the result as a new file. Built on the same decode/resize/encode
 * primitives (`renderResizedImage`) the upload flow's own optimize step
 * uses (`file-manager-image-optimize.ts`), just targeting an exact
 * width/height instead of a max-width to scale down to. */
function OptimizeImageDialog({ entry, onClose, onSave, onSaveAs }: OptimizeImageDialogProps) {
  const ref = useDialogSync(entry !== null, onClose);
  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  const [lock, setLock] = useState(true);
  const [quality, setQuality] = useState(OPTIMIZED_IMAGE_QUALITY);
  /** Set once "Optimize → WebP" has rendered a working result at the
   * *current* width/height/quality - cleared the moment any of those change,
   * so it never gets used stale (see the effect below). */
  const [preview, setPreview] = useState<{ blob: Blob; url: string } | null>(null);
  const [optimizing, setOptimizing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveAsName, setSaveAsName] = useState("");
  const naturalRatioRef = useRef<number | null>(null);
  const originalSizeRef = useRef(0);

  // Loads `entry`'s actual bytes (its `previewUrl` is the raw, full-res
  // download URL for any non-svg image entry - see `withPreview` in
  // `routes/storage.ts`) and reads its natural size to seed width/height.
  useEffect(() => {
    setSourceFile(null);
    setLoadError(false);
    setPreview((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
    setQuality(OPTIMIZED_IMAGE_QUALITY);
    setSaveAsName("");
    naturalRatioRef.current = null;
    if (!entry) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(entry.previewUrl ?? "");
        if (!response.ok) throw new Error("load failed");
        const blob = await response.blob();
        const file = new File([blob], entry.name, { type: blob.type || undefined });
        const dims = await readImageDimensions(file);
        if (cancelled) return;
        originalSizeRef.current = file.size;
        naturalRatioRef.current = dims.height ? dims.width / dims.height : null;
        setSourceFile(file);
        setWidth(dims.width);
        setHeight(dims.height);
      } catch {
        if (!cancelled) setLoadError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entry?.id]);

  useEffect(() => {
    setPreview((current) => {
      if (current) URL.revokeObjectURL(current.url);
      return null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, quality]);

  const onWidth = (value: number) => {
    setWidth(value);
    if (lock && naturalRatioRef.current) {
      setHeight(Math.max(1, Math.round(value / naturalRatioRef.current)));
    }
  };
  const onHeight = (value: number) => {
    setHeight(value);
    if (lock && naturalRatioRef.current) {
      setWidth(Math.max(1, Math.round(value * naturalRatioRef.current)));
    }
  };
  const onLockToggle = () => {
    const next = !lock;
    setLock(next);
    if (next && naturalRatioRef.current) {
      setHeight(Math.max(1, Math.round(width / naturalRatioRef.current)));
    }
  };

  const handleOptimize = async () => {
    if (!sourceFile) return;
    setOptimizing(true);
    try {
      const blob = await renderResizedImage(sourceFile, { width, height, format: "webp", quality });
      setPreview((current) => {
        if (current) URL.revokeObjectURL(current.url);
        return { blob, url: URL.createObjectURL(blob) };
      });
    } catch {
      toast.add({ title: "Couldn't optimize this image", type: "error" });
    } finally {
      setOptimizing(false);
    }
  };

  /** What Save/Save As actually write: the last "Optimize" result if it's
   * still current (matches this render's width/height/quality - see the
   * invalidation effect above), otherwise a plain resize in the source's
   * own format, computed fresh. */
  const resolveFinalBlob = async (): Promise<Blob> => {
    if (preview) return preview.blob;
    if (!sourceFile) throw new Error("Image not loaded yet.");
    return renderResizedImage(sourceFile, { width, height });
  };

  /** A non-empty "Save as new file" name means the user already told us
   * where the result goes - no separate button needed to confirm that a
   * second time. Blank name = overwrite the original in place. */
  const handleSave = async () => {
    if (!entry) return;
    const trimmed = saveAsName.trim();
    setSaving(true);
    try {
      const blob = await resolveFinalBlob();
      if (trimmed) {
        if (!onSaveAs) return;
        const ext =
          blob.type === "image/webp" ? "webp" : blob.type === "image/png" ? "png" : blob.type === "image/jpeg" ? "jpg" : (entry.ext ?? "png");
        const finalName = trimmed.toLowerCase().endsWith(`.${ext}`) ? trimmed : `${trimmed}.${ext}`;
        const file = new File([blob], finalName, { type: blob.type });
        if (await onSaveAs(file)) onClose();
      } else {
        if (!onSave) return;
        const file = new File([blob], entry.name, { type: blob.type });
        if (await onSave(entry.id, file)) onClose();
      }
    } catch {
      toast.add({ title: "Couldn't process this image", type: "error" });
    } finally {
      setSaving(false);
    }
  };

  const busy = optimizing || saving;
  const qualityPercent = Math.round(
    ((quality - OPTIMIZE_QUALITY_MIN) / (OPTIMIZE_QUALITY_MAX - OPTIMIZE_QUALITY_MIN)) * 100,
  );

  return (
    <dialog ref={ref} class="md file-optimize-dialog" aria-label="Optimize image">
      {entry && (
        <>
          <header>
            <h3>Optimize image</h3>
            <p>{entry.name}</p>
          </header>

          {loadError ? (
            <p class="error">Couldn't load this image - try again.</p>
          ) : !sourceFile ? (
            <p class="muted">Loading…</p>
          ) : (
            <div class="stack">
              <div class="file-optimize-preview">
                <img src={preview?.url ?? entry.previewUrl} alt="" />
              </div>

              <div class="row" style={{ alignItems: "flex-end" }}>
                <NumberField
                  label="Width"
                  value={width}
                  onChange={onWidth}
                  min={1}
                  placeholder="e.g. 1024"
                  disabled={busy}
                  style={{ flex: 1, minWidth: 0 }}
                />
                <NumberField
                  label="Height"
                  value={height}
                  onChange={onHeight}
                  min={1}
                  placeholder="e.g. 768"
                  disabled={busy}
                  style={{ flex: 1, minWidth: 0 }}
                />
                <button
                  type="button"
                  class="outline icon lg"
                  aria-label={lock ? "Unlock aspect ratio" : "Lock aspect ratio"}
                  data-tooltip={lock ? "Unlock aspect ratio" : "Lock aspect ratio"}
                  aria-pressed={lock}
                  disabled={busy}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={onLockToggle}
                >
                  <LockIcon />
                </button>
              </div>

              <div class="field">
                <label for="file-optimize-quality">
                  WebP quality{preview ? ` — applied at ${quality.toFixed(2)}` : ""}
                </label>
                <input
                  id="file-optimize-quality"
                  type="range"
                  min={OPTIMIZE_QUALITY_MIN}
                  max={OPTIMIZE_QUALITY_MAX}
                  step={0.01}
                  value={quality}
                  disabled={busy}
                  style={{ "--value": qualityPercent }}
                  onInput={(event) => setQuality(Number((event.currentTarget as HTMLInputElement).value))}
                />
              </div>

              <div class="row file-optimize-actions">
                <button
                  type="button"
                  class="outline"
                  disabled={busy}
                  aria-busy={optimizing}
                  onClick={handleOptimize}
                >
                  Optimize → WebP
                </button>
                {preview && (
                  <small class="muted">
                    {formatBytes(originalSizeRef.current)} → {formatBytes(preview.blob.size)}
                  </small>
                )}
              </div>

              {onSaveAs && (
                <TextField
                  label="Save as new file"
                  value={saveAsName}
                  onChange={setSaveAsName}
                  placeholder={preview ? optimizedUploadName(entry.name) : entry.name}
                  helperText={
                    saveAsName.trim()
                      ? "Saves as a new file instead of overwriting the original."
                      : "Leave blank to overwrite the original."
                  }
                  disabled={busy}
                />
              )}
            </div>
          )}

          <footer>
            <button type="button" class="outline" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              disabled={busy || !sourceFile || (saveAsName.trim() ? !onSaveAs : !onSave)}
              aria-busy={saving}
              onClick={handleSave}
            >
              Save
            </button>
          </footer>
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
  initialFolderId,
  syncUrl = true,
}: FileManagerProps) {
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(() =>
    initialFolderId !== undefined
      ? initialFolderId
      : syncUrl
        ? readFolderFromUrl()
        : null,
  );
  // Establishes a baseline history entry for whatever folder we opened on
  // (root or one restored from the URL), so the very first back-button press
  // doesn't skip past it.
  useEffect(() => {
    if (!syncUrl) return;
    writeFolderToUrl(currentFolderId, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Back/forward moves between folders the same way clicking into one does.
  useEffect(() => {
    if (!syncUrl) return;
    const onPopState = (event: PopStateEvent) => {
      const state = event.state as {
        [FOLDER_QUERY_KEY]?: string | null;
      } | null;
      const id =
        state && FOLDER_QUERY_KEY in state
          ? (state[FOLDER_QUERY_KEY] ?? null)
          : readFolderFromUrl();
      setCurrentFolderId(id);
      setQuery("");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /** Centralizes the two user-driven navigations (opening a folder,
   * clicking a breadcrumb) so both stay in sync with browser history. */
  const goToFolder = (id: string | null) => {
    setCurrentFolderId(id);
    setQuery("");
    if (syncUrl) writeFolderToUrl(id, false);
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
  /** Last-used list/grid choice - shared across every `FileManager` on the
   * page, same as any other persisted user preference. */
  const [view, setView] = useStore<"list" | "grid">(
    "file-manager-view",
    defaultView,
  );
  const [query, setQuery] = useState("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [uncontrolledSelected, setUncontrolledSelected] = useState<string[]>(
    [],
  );
  const [previewId, setPreviewId] = useState<string | null>(null);
  // Mirrors the latest render's value for reads *after* an `await` inside an
  // event handler - `selectedIds`/`previewId` themselves are closed over at
  // call time and go stale if the user changes selection while the request
  // is in flight (see `moveEntriesInto`/`submitRename`).
  const previewIdRef = useRef(previewId);
  previewIdRef.current = previewId;
  const [renameId, setRenameId] = useState<string | null>(null);
  const [optimizeId, setOptimizeId] = useState<string | null>(null);
  const [clipboard, setClipboard] = useState<MoveCopyState>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [pendingDeleteIds, setPendingDeleteIds] = useState<string[] | null>(
    null,
  );
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
  const [previewOn, setPreviewOn] = useStore("file-manager-preview", false);

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
   * deliberate: `move`/`copy`/`remove` aren't atomic on every future backend
   * (R2/S3 is copy-then-delete
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
  const [treePrefetch, setTreePrefetch] = useState<
    "pending" | "unavailable" | "done"
  >(() => (source.listAll ? "pending" : "unavailable"));

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
          for (const entry of all)
            if (entry.kind === "folder") next.add(entry.id);
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
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;

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
  /** `isAccepted` itself always passes folders through (they're containers,
   * not a file type to accept/reject - a folder must stay dimmed-free and
   * navigable even in a `accept`-restricted picker). But a *restricted*
   * picker (`accept` set - always an `ImageField`/`image-menu.tsx`/
   * `image-insert-button.tsx` single-type dialog, never the plain `/dry/media`
   * browser, which never passes `accept`) has nothing
   * sensible to do with a folder as "the" selected value - checking one there
   * would let a folder id end up picked as if it were an image. Selection
   * (checkbox + drag) is disabled for folders in that case; opening one by
   * clicking the row is untouched (`onOpen` below doesn't gate on this). */
  const isDisabled = (entry: FileEntry) =>
    selectionLocked ||
    !isAccepted(entry, accept) ||
    (entry.kind === "folder" && !!accept && accept.length > 0);
  /** Distinct from `isDisabled` above: only the "wrong file type" reason gets
   * dimmed, not a transient clipboard lock - that already reads as disabled
   * via the checkbox itself, and dimming every row for it would make the
   * clipboard flow look like the whole browser went inert. Folders are never
   * dimmed either way (see `isDisabled`'s own comment on why they still need
   * their checkbox disabled in a restricted picker without looking dimmed). */
  const isNotAccepted = (entry: FileEntry) => !isAccepted(entry, accept);
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
  const onDragOverBreadcrumb =
    (targetId: string | null) => (event: DragEvent) => {
      if (!dragIds || !canDropOnFolder(targetId, dragIds)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      setBreadcrumbDragOverId(targetId);
    };
  const onDragLeaveBreadcrumb = (targetId: string | null) => () => {
    setBreadcrumbDragOverId((current) =>
      current === targetId ? undefined : current,
    );
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
  const performMove = async (
    ids: string[],
    targetId: string | null,
  ): Promise<boolean> => {
    if (!source.move) return false;
    const sourceFolderIds = ids.map(
      (id) => entries.find((entry) => entry.id === id)?.parentId ?? null,
    );
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
      setEntries((current) =>
        current.map((entry) => byId.get(entry.id) ?? entry),
      );
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
    // Read the live selection via the ref, not the `selectedIds` closed over
    // when this call started - it may have changed while the move was in flight.
    setSelection(selectedIdsRef.current.filter((id) => !ids.includes(id)));
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

  const pendingDeleteEntries = useMemo(
    () => entries.filter((entry) => pendingDeleteIds?.includes(entry.id)),
    [entries, pendingDeleteIds],
  );

  const confirmDelete = () => {
    if (!pendingDeleteIds) return;
    const ids = pendingDeleteIds;
    setPendingDeleteIds(null);
    deleteEntries(ids);
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
  const renameExistingNames = useMemo(
    () =>
      renameTargetEntry
        ? entries
            .filter(
              (entry) =>
                entry.parentId === renameTargetEntry.parentId &&
                entry.id !== renameTargetEntry.id &&
                !isHiddenEntry(entry),
            )
            .map((entry) => entry.name)
        : [],
    [entries, renameTargetEntry],
  );
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
      setEntries((current) =>
        current.map((entry) => (entry.id === updated.id ? updated : entry)),
      );
    } catch {
      toast.add({ title: "Couldn't rename - try again", type: "error" });
      // Same rationale as `moveEntriesInto`: read the live selection/preview
      // via ref, not the values closed over before the `await`.
      if (selectedIdsRef.current.includes(guessedId)) {
        setSelection(
          selectedIdsRef.current.map((id) => (id === guessedId ? oldId : id)),
        );
      }
      if (previewIdRef.current === guessedId) setPreviewId(oldId);
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
  /** Overwrites `id`'s bytes at its *same* path with `file` - shared by the
   * hidden-input Replace flow below (`handleReplaceFile`) and the Optimize
   * dialog's "Save" action. Returns whether it succeeded, same convention as
   * `performMove`, so a caller that renders its own dialog (Optimize) can
   * decide whether to close it rather than getting a thrown exception. */
  const performReplace = async (id: string, file: File): Promise<boolean> => {
    if (!source.replace) return false;
    const target = entries.find((entry) => entry.id === id);
    // Replace overwrites bytes at the *same* path - `id` doesn't churn, so an
    // optimistic patch (client-known size + a real object URL for images)
    // can go straight into `entries` before the request even starts.
    const optimisticPreview = file.type.startsWith("image/")
      ? URL.createObjectURL(file)
      : target?.previewUrl;
    setEntries((current) =>
      current.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              size: file.size,
              modifiedAt: new Date().toISOString(),
              previewUrl: optimisticPreview,
            }
          : entry,
      ),
    );

    setBusy(true);
    try {
      const updated = await source.replace(id, file);
      // Use the server's own `previewUrl`, not the local blob URL - the
      // optimistic one is only a stand-in until the real upload lands.
      setEntries((current) =>
        current.map((entry) => (entry.id === id ? updated : entry)),
      );
      return true;
    } catch {
      toast.add({ title: "Couldn't replace - try again", type: "error" });
      await revertAfterFailure([currentFolderId]);
      return false;
    } finally {
      setBusy(false);
      if (optimisticPreview?.startsWith("blob:"))
        URL.revokeObjectURL(optimisticPreview);
    }
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
    await performReplace(id, file);
  };

  /** Uploads `file` into the current folder as a brand-new entry - backs the
   * Optimize dialog's "Save As" action. Same boolean-return convention as
   * `performReplace`/`performMove`; surfaces the server's own message (e.g.
   * an `already_exists` collision) rather than a generic one, since unlike
   * `submitUpload`'s batch flow there's exactly one file and one likely
   * failure mode worth naming. */
  const performSaveAs = async (file: File): Promise<boolean> => {
    if (!source.upload) return false;
    const folderId = currentFolderId;
    setBusy(true);
    try {
      const uploaded = await source.upload(folderId, [file]);
      setEntries((current) => [...current, ...uploaded]);
      return true;
    } catch (error) {
      toast.add({
        title: error instanceof Error ? error.message : "Couldn't save - try again",
        type: "error",
      });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submitUpload = async (items: UploadFileItem[]) => {
    if (!source.upload) return;
    const folderId = currentFolderId;
    setBusy(true);
    let placeholders: FileEntry[] = [];
    try {
      const { files, skippedOptimization } = await prepareUploadFiles(items);
      // Two files sharing a final name would collide on the same optimistic
      // placeholder id below (and on the server's target path) - reject
      // up front with a clear message instead of a confusing partial upload.
      const names = new Set<string>();
      for (const file of files) {
        if (names.has(file.name)) {
          toast.add({
            title: `Duplicate filename "${file.name}" in this upload`,
            type: "error",
          });
          return;
        }
        names.add(file.name);
      }
      if (skippedOptimization) {
        toast.add({
          title: "Some images couldn't be optimized",
          description: "They will be uploaded as originals.",
          type: "warning",
        });
      }

      // Optimistic placeholders, one per final file, using client-known
      // name/size/(object-URL preview) - upload rejects on a name collision
      // rather than silently renaming (see `routes/storage.ts`), so unlike
      // `copy` the destination path here *is* predictable.
      placeholders = files.map((file) => {
        const dot = file.name.lastIndexOf(".");
        return {
          id: folderId ? `${folderId}/${file.name}` : file.name,
          name: file.name,
          parentId: folderId,
          kind: "file",
          ext: dot > 0 ? file.name.slice(dot + 1).toLowerCase() : undefined,
          size: file.size,
          modifiedAt: new Date().toISOString(),
          previewUrl: file.type.startsWith("image/")
            ? URL.createObjectURL(file)
            : undefined,
        };
      });
      setEntries((current) => [...current, ...placeholders]);
      setUploadOpen(false);

      const uploaded = await source.upload(folderId, files);
      const placeholderIds = new Set(placeholders.map((entry) => entry.id));
      setEntries((current) => [
        ...current.filter((entry) => !placeholderIds.has(entry.id)),
        ...uploaded,
      ]);
    } catch {
      toast.add({ title: "Couldn't upload - try again", type: "error" });
      // A batch upload isn't all-or-nothing (the route writes files one at a
      // time and stops at the first collision) - some may have actually
      // landed server-side, so recovery is a real re-fetch, not just
      // dropping the placeholders.
      await revertAfterFailure([folderId]);
    } finally {
      setBusy(false);
      for (const placeholder of placeholders) {
        if (placeholder.previewUrl?.startsWith("blob:"))
          URL.revokeObjectURL(placeholder.previewUrl);
      }
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
      setEntries((current) =>
        current.map((entry) => (entry.id === placeholder.id ? created : entry)),
      );
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

  const optimizeEntry = optimizeId
    ? (entries.find((entry) => entry.id === optimizeId) ?? null)
    : null;

  const renderMore = (entry: FileEntry) => (
    <MoreMenu
      label={entry.name}
      onRename={source.rename ? () => setRenameId(entry.id) : undefined}
      onReplace={
        entry.kind === "folder" || !source.replace
          ? undefined
          : () => requestReplace(entry.id)
      }
      onOptimize={
        canOptimizeEntry(entry) && (source.replace || source.upload)
          ? () => setOptimizeId(entry.id)
          : undefined
      }
      onCopy={source.copy ? () => requestCopy([entry.id]) : undefined}
      onMove={source.move ? () => requestMove([entry.id]) : undefined}
      onDelete={
        source.remove ? () => setPendingDeleteIds([entry.id]) : undefined
      }
    />
  );

  /** Drives the small spinner next to the view toggle - covers both the
   * first visit to a folder *and* the refetch every mutation triggers, so
   * the toolbar signals "working" without ever swapping `entries` out for
   * skeleton placeholders (the list/grid just keep showing what they had). */
  const folderLoading =
    treePrefetch === "pending" || loadingFolders.has(currentFolderId);

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
              source.remove ? () => setPendingDeleteIds(selectedIds) : undefined
            }
          />
        ))}

      {view === "list" ? (
        <ListView
          entries={visible}
          selectedIds={selectedIds}
          clipboard={clipboard}
          isDisabled={isDisabled}
          isNotAccepted={isNotAccepted}
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
            source.remove ? () => setPendingDeleteIds(selectedIds) : undefined
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
          isNotAccepted={isNotAccepted}
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
        existingNames={renameExistingNames}
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
        onOptimize={
          source.replace || source.upload
            ? (id) => {
                setOptimizeId(id);
                setPreviewId(null);
              }
            : undefined
        }
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
        onDelete={source.remove ? (id) => setPendingDeleteIds([id]) : undefined}
      />

      <OptimizeImageDialog
        entry={optimizeEntry}
        onClose={() => setOptimizeId(null)}
        onSave={source.replace ? performReplace : undefined}
        onSaveAs={source.upload ? performSaveAs : undefined}
      />

      <ConfirmDialog
        open={pendingDeleteIds !== null}
        title={
          pendingDeleteIds && pendingDeleteIds.length === 1
            ? `Delete "${pendingDeleteEntries[0]?.name ?? ""}"?`
            : `Delete ${pendingDeleteIds?.length ?? 0} items?`
        }
        message={
          <p>
            {pendingDeleteEntries.some((entry) => entry.kind === "folder") &&
              "This also deletes everything inside the selected folder(s). "}
            This cannot be undone.
          </p>
        }
        confirmLabel="Delete"
        destructive
        onConfirm={confirmDelete}
        onCancel={() => setPendingDeleteIds(null)}
      />
    </div>
  );
}
