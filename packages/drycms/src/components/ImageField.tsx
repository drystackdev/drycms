import { useEffect, useId, useState } from "preact/hooks";
import type { FieldProps } from "./field-common.js";
import FileManager from "./FileManager.js";
import type { FileEntry, FileManagerSource } from "./file-manager-types.js";
import { parentFolderOf, thumbnailUrl } from "./file-manager-utils.js";
import { CloseIcon, DragHandleIcon, MediaIcon, UploadIcon } from "./icons.js";
import { useDialogSync } from "./list-nav.js";
import { useOverlayScrollbars } from "./overlayscrollbars.js";
import { useSortableList } from "../lib/dnd/useSortableList.js";

export interface ImageFieldMultipleConfig {
  min?: number;
  max?: number;
}

export interface ImageFieldProps extends FieldProps<string | string[]> {
  /** Where the picker dialog's `FileManager` reads its files from. */
  source: FileManagerSource;
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

  // Resolves `selectedIds` to the `FileEntry`s behind them, for thumbnails +
  // names - re-lists on every change since a rename/move elsewhere in
  // `source` can leave a stale id. Only the first id's folder is used as the
  // fallback scope when `source` can't `listAll` - multi-folder selections
  // aren't expected from sources without it.
  useEffect(() => {
    if (selectedIds.length === 0) {
      setEntriesById({});
      return;
    }
    let cancelled = false;
    (async () => {
      const all = (await source.listAll?.()) ?? null;
      const list = all ?? (await source.list(parentFolderOf(selectedIds[0]!)));
      if (cancelled) return;
      const map: Record<string, FileEntry> = {};
      for (const imageId of selectedIds) {
        const found = list.find((item) => item.id === imageId);
        if (found) map[imageId] = found;
      }
      setEntriesById(map);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds.join(","), source]);

  const entry = !isMultiple ? (entriesById[selectedIds[0]!] ?? null) : null;

  const openPicker = () => {
    if (disabled) return;
    setPending(isMultiple ? selectedIds : value);
    setOpen(true);
  };

  const confirm = () => {
    onChange(pending);
    setOpen(false);
  };

  const removeAt = (imageId: string) => {
    onChange(selectedIds.filter((sid) => sid !== imageId));
  };

  const pendingCount = Array.isArray(pending) ? pending.length : pending ? 1 : 0;
  const min = multipleConfig?.min;
  const max = multipleConfig?.max;
  const withinBounds =
    (min === undefined || pendingCount >= min) && (max === undefined || pendingCount <= max);

  return (
    <div class={`field${className ? ` ${className}` : ""}`} style={style}>
      <label for={fieldId}>{label}{required && <span class="required-asterisk">*</span>}</label>
      {description && <small>{description}</small>}
      <div class="image-field-box">
        {!isMultiple && entry ? (
          <>
            <img
              class="image-field-thumb"
              src={entry.previewUrl ?? thumbnailUrl(entry)}
              alt=""
            />
            <button
              id={fieldId}
              type="button"
              class="image-field-overlay"
              disabled={disabled}
              aria-label={`Change ${entry.name}`}
              onClick={openPicker}
            >
              <span class="image-field-name">{entry.name}</span>
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
                <img
                  class="image-field-list-thumb"
                  src={item ? (item.previewUrl ?? thumbnailUrl(item)) : undefined}
                  alt=""
                />
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
              <FileManager
                source={source}
                value={pending}
                onChange={setPending}
                multiple={isMultiple}
                accept={IMAGE_EXTENSIONS}
                initialFolderId={selectedIds[0] ? parentFolderOf(selectedIds[0]) : undefined}
                syncUrl={false}
              />
            </div>
            <footer class={isMultiple ? "row justify-between" : undefined}>
              {isMultiple && (
                <small class={withinBounds ? "hint" : "error"}>
                  {pendingCount} selected
                  {(min !== undefined || max !== undefined) &&
                    ` (${min ?? 0}–${max ?? "∞"})`}
                </small>
              )}
              <div class={isMultiple ? "row" : undefined}>
                <button type="button" class="outline" onClick={() => setOpen(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isMultiple ? !withinBounds : !pending}
                  onClick={confirm}
                >
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
