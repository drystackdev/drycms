import { useEffect, useId, useState } from "preact/hooks";
import type { FieldProps } from "./field-common.js";
import EntryScopedPicker from "../FileManager/EntryScopedPicker.js";
import type { FileEntry, FileManagerSource } from "../../storage/entry-types.js";
import { parentFolderOf, thumbnailUrl } from "../../storage/entry-utils.js";
import { AddIcon, CloseIcon, DragHandleIcon, MediaIcon, TrashIcon, UploadIcon } from "../icons/index.js";
import { useDialogSync } from "../../hooks/list-nav.js";
import { useOverlayScrollbars } from "../../hooks/overlayscrollbars.js";
import { useSortableList } from "../../lib/dnd/useSortableList.js";

/** A picked id is either a `source` path (resolved through `FileManager`) or
 * a URL - either typed into the picker's "Link" tab, or a caller that has no
 * `source` of its own to resolve an id back through later (a richtext
 * component's `props`, see `dry-component-props-form.tsx`) pre-resolving a
 * pick to `FileEntry.previewUrl` before it ever reaches this field's own
 * `value` - the two live side by side in the same `value`/`pending` array
 * and are told apart by shape alone, no separate flag. A leading `/` counts
 * as a URL alongside `https?://` since a real `source` id (see
 * `FileManagerSource`'s own doc comment) is always a bare relative path,
 * never rooted - only a resolved `previewUrl` (root-relative, e.g. `/dry/api/
 * storage/...`) or an `https://` link ever starts with one. */
function isLinkValue(id: string): boolean {
  return /^(https?:\/\/|\/)/i.test(id);
}

export interface ImageFieldMultipleConfig {
  min?: number;
  max?: number;
}

export interface ImageFieldProps extends FieldProps<string | string[]> {
  /** Where the picker dialog's `FileManager` reads its files from. */
  source: FileManagerSource;
  /** Sandboxed to the current entry's own media folder - shows a first
   * "Entry" tab inside the picker's File panel when present
   * (`EntryScopedPicker`). Omitted entirely outside a slug-enabled entry
   * form. */
  entrySource?: FileManagerSource;
  /** Pick more than one image. `true` for no count limit, or `{ min, max }`
   * to require/cap a count (enforced by disabling the picker dialog's Select
   * button, same as the single-value min-1 `required` case below). Selected
   * images render as a reorderable list under the picker - drag a row's
   * handle to reorder. `value`/`onChange` become `string[]` either way.
   * @default false */
  multiple?: boolean | ImageFieldMultipleConfig;
  disabled?: boolean;
  name?: string;
  id?: string;
  required?: boolean;
  description?: string;
}

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "gif", "svg", "webp"];

/**
 * Image picker: a 4:3 frame that opens a `FileManager`-backed dialog on
 * click. Single mode (`multiple` off, the default) - once a file is chosen
 * the frame shows its thumbnail under a name + remove overlay; clicking the
 * overlay reopens the dialog scoped to that file's folder with it already
 * checked, so re-picking starts right where the current selection lives
 * instead of wherever the picker was last left. Multi mode - the frame stays
 * a plain "Add images" trigger and every picked file renders as its own row
 * in a reorderable list underneath (drag the handle to reorder, `useSortableList`
 * - see `lib/dnd/useSortableList.ts`). Non-image files are still browsable in
 * the dialog (folders may hold a mix) but shown disabled and dimmed, via
 * `FileManager`'s own `accept` handling.
 */
export default function ImageField({
  source,
  entrySource,
  value,
  onChange,
  label,
  helperText,
  error = false,
  multiple = false,
  disabled = false,
  name,
  id,
  required = false,
  description,
  class: className,
  style,
}: ImageFieldProps) {
  const reactId = useId();
  const fieldId = id ?? `image-field-${reactId}`;
  const isMultiple = !!multiple;
  const multipleConfig = typeof multiple === "object" ? multiple : undefined;

  const selectedIds: string[] = isMultiple
    ? Array.isArray(value)
      ? value
      : []
    : value
      ? [value as string]
      : [];

  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | string[]>(value);
  /** Raw URLs typed into the picker's "Link" tab - kept separate from `pending`
   * (which only ever holds `source` ids, same as before this tab existed) so
   * a blank in-progress row doesn't get treated as a real selection. The two
   * lists share one combined count/footer and both feed the same `onChange`
   * on confirm, so picks made in either tab survive switching to the other. */
  const [pendingLinks, setPendingLinks] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<"file" | "link">("file");
  const [entriesById, setEntriesById] = useState<Record<string, FileEntry>>({});
  const dialogRef = useDialogSync(open, () => setOpen(false));
  // Deps include `open`: the body only mounts once the dialog opens, so the
  // ref is still null on `ImageField`'s own first render.
  const { ref: pickerBody } = useOverlayScrollbars<HTMLDivElement>([open]);

  const sortableList = useSortableList<string>({
    items: selectedIds,
    getId: (imageId) => imageId,
    onReorder: (next) => onChange(next),
    disabled: !isMultiple || disabled,
  });

  /** The file pick(s) currently staged in `pending`, while the dialog's still
   * open and pending confirm - the Link tab mirrors each as its own read-only
   * row (see `pendingFileUrls` below) so picking a file in the File tab shows
   * its equivalent URL on the Link side, the two tabs staying in sync instead
   * of the Link tab just going blank (single mode) or showing nothing for a
   * multi pick the way leaving this to `pendingLinks` alone would otherwise
   * look like. */
  const pendingFileIds = isMultiple
    ? Array.isArray(pending)
      ? pending
      : []
    : typeof pending === "string" && pending
      ? [pending]
      : [];

  // Resolves `selectedIds` (+ `pendingFileIds` above) to the `FileEntry`s
  // behind them, for thumbnails + names - re-lists on every change since a
  // rename/move elsewhere in `source` can leave a stale id. Link ids
  // (Link-tab entries) aren't `source` paths, so they're skipped here and
  // rendered straight from the id itself below. Only the first *file* id's
  // folder is used as the fallback scope when `source` can't `listAll` -
  // multi-folder selections aren't expected from sources without it.
  useEffect(() => {
    const fileIds = selectedIds.filter((id) => !isLinkValue(id));
    for (const pendingId of pendingFileIds) {
      if (!fileIds.includes(pendingId)) fileIds.push(pendingId);
    }
    if (fileIds.length === 0) {
      setEntriesById({});
      return;
    }
    let cancelled = false;
    (async () => {
      const all = (await source.listAll?.()) ?? null;
      const list = all ?? (await source.list(parentFolderOf(fileIds[0]!)));
      if (cancelled) return;
      const map: Record<string, FileEntry> = {};
      for (const imageId of fileIds) {
        const found = list.find((item) => item.id === imageId);
        if (found) map[imageId] = found;
      }
      setEntriesById(map);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds.join(","), pendingFileIds.join(","), source]);

  const pendingFileUrls = pendingFileIds.map((fid) => entriesById[fid]?.previewUrl ?? fid);

  const firstSelectedId = selectedIds[0];
  const entry = !isMultiple && firstSelectedId ? (entriesById[firstSelectedId] ?? null) : null;
  const isSingleLink = !isMultiple && !entry && !!firstSelectedId && isLinkValue(firstSelectedId);

  const firstSelectedFileId = selectedIds.find((sid) => !isLinkValue(sid));

  const openPicker = () => {
    if (disabled) return;
    const fileIds = selectedIds.filter((id) => !isLinkValue(id));
    const linkIds = selectedIds.filter(isLinkValue);
    setPending(isMultiple ? fileIds : (fileIds[0] ?? ""));
    setPendingLinks(linkIds);
    setActiveTab(fileIds.length === 0 && linkIds.length > 0 ? "link" : "file");
    setOpen(true);
  };

  /** `FileManager`'s own onChange - only clears out any picked link in single
   * mode, where at most one of (file, link) can be "the" selection at a
   * time and picking a file supersedes whatever link was there. */
  const handleFileChange = (next: string | string[]) => {
    setPending(next);
    if (!isMultiple && (Array.isArray(next) ? next.length > 0 : !!next)) {
      setPendingLinks([]);
    }
  };

  /** The Link tab's own delete button on a synced file row (see
   * `pendingFileUrls` above) - deselects that file back on the File tab
   * side, the two staying in sync in both directions rather than this row
   * being pure readout. */
  const removePendingFile = (fileId: string) => {
    setPending((current) =>
      isMultiple
        ? (Array.isArray(current) ? current.filter((id) => id !== fileId) : current)
        : current === fileId
          ? ""
          : current,
    );
  };

  const updateLink = (index: number, url: string) => {
    setPendingLinks((links) => links.map((link, i) => (i === index ? url : link)));
    if (!isMultiple && url.trim()) setPending("");
  };

  const addLink = () => {
    setPendingLinks((links) => [...links, ""]);
    if (!isMultiple) setPending("");
  };

  const removeLink = (index: number) => {
    setPendingLinks((links) => links.filter((_, i) => i !== index));
  };

  const cleanPendingLinks = pendingLinks.map((url) => url.trim()).filter(Boolean);

  const confirm = () => {
    if (isMultiple) {
      onChange([...(Array.isArray(pending) ? pending : []), ...cleanPendingLinks]);
    } else {
      onChange((pending as string) || cleanPendingLinks[0] || "");
    }
    setOpen(false);
  };

  const removeAt = (imageId: string) => {
    onChange(selectedIds.filter((sid) => sid !== imageId));
  };

  const pendingCount =
    (Array.isArray(pending) ? pending.length : pending ? 1 : 0) + cleanPendingLinks.length;
  const min = multipleConfig?.min;
  const max = multipleConfig?.max;
  const withinBounds =
    (min === undefined || pendingCount >= min) && (max === undefined || pendingCount <= max);
  const canConfirm = isMultiple ? withinBounds : !!pending || cleanPendingLinks.length > 0;
  const canAddLink = isMultiple || (pendingLinks.length === 0 && !pending);

  return (
    <div class={`field${className ? ` ${className}` : ""}`} style={style}>
      <label for={fieldId}>{label}{required && <span class="required-asterisk">*</span>}</label>
      {description && <small>{description}</small>}
      <div class="image-field-box">
        {!isMultiple && (entry || isSingleLink) ? (
          <>
            <img
              class="image-field-thumb"
              src={entry ? (entry.previewUrl ?? thumbnailUrl(entry)) : firstSelectedId}
              alt=""
            />
            <button
              id={fieldId}
              type="button"
              class="image-field-overlay"
              disabled={disabled}
              aria-label={`Change ${entry ? entry.name : firstSelectedId}`}
              onClick={openPicker}
            >
              <span class="image-field-name">{entry ? entry.name : firstSelectedId}</span>
            </button>
            <button
              type="button"
              class="image-field-remove ghost icon sm"
              disabled={disabled}
              aria-label="Remove image"
              onClick={(event) => {
                event.stopPropagation();
                onChange("");
              }}
            >
              <CloseIcon />
            </button>
          </>
        ) : (
          <button
            id={fieldId}
            type="button"
            class="image-field-empty"
            disabled={disabled}
            aria-haspopup="dialog"
            onClick={openPicker}
          >
            <MediaIcon />
            <span>{isMultiple && selectedIds.length > 0 ? "Add images" : "Choose image"}</span>
          </button>
        )}
      </div>

      {isMultiple && selectedIds.length > 0 && (
        <ul class="image-field-list" {...sortableList.containerProps}>
          {selectedIds.map((imageId) => {
            const item = entriesById[imageId];
            const src = item ? (item.previewUrl ?? thumbnailUrl(item)) : isLinkValue(imageId) ? imageId : undefined;
            return (
              <li key={imageId} data-sortable-id={imageId} class="image-field-list-item">
                <button
                  type="button"
                  class="ghost icon sm"
                  disabled={disabled}
                  {...sortableList.getHandleProps(imageId)}
                >
                  <DragHandleIcon />
                </button>
                <img class="image-field-list-thumb" src={src} alt="" />
                <span class="image-field-list-name">{item?.name ?? imageId}</span>
                <button
                  type="button"
                  class="ghost icon sm"
                  disabled={disabled}
                  aria-label={`Remove ${item?.name ?? imageId}`}
                  onClick={() => removeAt(imageId)}
                >
                  <CloseIcon />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {name && (
        <input
          type="hidden"
          name={name}
          value={isMultiple ? selectedIds.join(",") : (value as string)}
        />
      )}
      {helperText && <span class={error ? "error" : "hint"}>{helperText}</span>}

      <dialog
        ref={dialogRef}
        class="file-dialog image-picker-dialog"
        aria-label={isMultiple ? "Choose images" : "Choose image"}
      >
        {open && (
          <>
            <header>
              <h3>{isMultiple ? "Choose images" : "Choose image"}</h3>
            </header>
            <div class="image-picker-body" ref={pickerBody}>
              <div role="tablist">
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "file"}
                  aria-controls={`${fieldId}-tab-file`}
                  onClick={() => setActiveTab("file")}
                >
                  File
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={activeTab === "link"}
                  aria-controls={`${fieldId}-tab-link`}
                  onClick={() => setActiveTab("link")}
                >
                  Link
                </button>
              </div>
              <div role="tabpanel" id={`${fieldId}-tab-file`} hidden={activeTab !== "file"}>
                <EntryScopedPicker
                  fullSource={source}
                  entrySource={entrySource}
                  value={pending}
                  onChange={handleFileChange}
                  multiple={isMultiple}
                  accept={IMAGE_EXTENSIONS}
                  initialFolderId={
                    firstSelectedFileId ? parentFolderOf(firstSelectedFileId) : undefined
                  }
                  syncUrl={false}
                />
              </div>
              <div role="tabpanel" id={`${fieldId}-tab-link`} hidden={activeTab !== "link"}>
                <ul class="image-field-link-list">
                  {pendingFileIds.map((fileId, index) => (
                    <li key={`file-${index}`} class="row">
                      <input type="url" readOnly value={pendingFileUrls[index]} />
                      <button
                        type="button"
                        class="ghost icon sm"
                        aria-label="Remove link"
                        onClick={() => removePendingFile(fileId)}
                      >
                        <TrashIcon />
                      </button>
                    </li>
                  ))}
                  {pendingFileUrls.length === 0 && pendingLinks.length === 0 && (
                    <li class="hint">No links yet.</li>
                  )}
                  {pendingLinks.map((url, index) => (
                    <li key={index} class="row">
                      <input
                        type="url"
                        placeholder="https://example.com/image.jpg"
                        value={url}
                        onInput={(event) =>
                          updateLink(index, (event.currentTarget as HTMLInputElement).value)
                        }
                      />
                      <button
                        type="button"
                        class="ghost icon sm"
                        aria-label="Remove link"
                        onClick={() => removeLink(index)}
                      >
                        <TrashIcon />
                      </button>
                    </li>
                  ))}
                </ul>
                <button type="button" class="outline" disabled={!canAddLink} onClick={addLink}>
                  <AddIcon /> Add link
                </button>
              </div>
            </div>
            <footer class={isMultiple ? "row justify-between" : undefined}>
              {isMultiple && (
                <small class={withinBounds ? "hint" : "error"}>
                  {pendingCount} selected
                  {(min !== undefined || max !== undefined) &&
                    ` (${min ?? 0}–${max ?? "∞"})`}
                </small>
              )}
              <div class="row">
                <button type="button" class="outline" onClick={() => setOpen(false)}>
                  Cancel
                </button>
                <button type="button" disabled={!canConfirm} onClick={confirm}>
                  Select
                </button>
              </div>
            </footer>
          </>
        )}
      </dialog>
    </div>
  );
}
