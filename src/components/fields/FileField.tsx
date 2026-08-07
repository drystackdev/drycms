import { useEffect, useId, useState } from "preact/hooks";
import type { FieldProps } from "./field-common.js";
import EntryScopedPicker from "../FileManager/EntryScopedPicker.js";
import type { FileEntry, FileManagerSource } from "../../storage/entry-types.js";
import { parentFolderOf, thumbnailUrl } from "../../storage/entry-utils.js";
import { CloseIcon, ContentIcon, DragHandleIcon } from "../icons/index.js";
import { useDialogSync } from "../../hooks/list-nav.js";
import { useOverlayScrollbars } from "../../hooks/overlayscrollbars.js";
import { useSortableList } from "../../lib/dnd/useSortableList.js";

export interface FileFieldMultipleConfig {
  min?: number;
  max?: number;
}

export interface FileFieldProps extends FieldProps<string | string[]> {
  /** Where the picker dialog's `FileManager` reads its files from. */
  source: FileManagerSource;
  /** Sandboxed to the current entry's own media folder - shows a first
   * "Entry" tab in the picker dialog when present (`EntryScopedPicker`).
   * Omitted entirely outside a slug-enabled entry form. */
  entrySource?: FileManagerSource;
  /** Extensions (no dot) a file must match to be selectable. Omit to allow any file type. */
  accept?: string[];
  /** Pick more than one file. `true` for no count limit, or `{ min, max }` to
   * require/cap a count. Selected files render as a reorderable list under
   * the trigger - drag a row's handle to reorder. `value`/`onChange` become
   * `string[]` either way. @default false */
  multiple?: boolean | FileFieldMultipleConfig;
  disabled?: boolean;
  name?: string;
  id?: string;
  required?: boolean;
  description?: string;
}

/**
 * File picker: a plain "Choose file" trigger that opens a `FileManager`-
 * backed dialog, same mechanism as `ImageField` minus the thumbnail preview/
 * Link-tab machinery a generic (often non-image) file has no use for - the
 * picked file's icon (via `thumbnailUrl`'s extension lookup, not an actual
 * preview) and name replace the trigger once something's chosen. Single mode
 * (`multiple` off, the default) shows one row; multi mode shows a "Add
 * files" trigger plus every picked file as its own reorderable row
 * underneath (drag the handle to reorder, `useSortableList`).
 */
export default function FileField({
  source,
  entrySource,
  value,
  onChange,
  label,
  helperText,
  error = false,
  accept,
  multiple = false,
  disabled = false,
  name,
  id,
  required = false,
  description,
  class: className,
  style,
}: FileFieldProps) {
  const reactId = useId();
  const fieldId = id ?? `file-field-${reactId}`;
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
  const { ref: pickerBody } = useOverlayScrollbars<HTMLDivElement>([open]);

  const sortableList = useSortableList<string>({
    items: selectedIds,
    getId: (fileId) => fileId,
    onReorder: (next) => onChange(next),
    disabled: !isMultiple || disabled,
  });

  const pendingIds = isMultiple
    ? Array.isArray(pending)
      ? pending
      : []
    : typeof pending === "string" && pending
      ? [pending]
      : [];

  // Resolves `selectedIds` (+ `pendingIds`) to the `FileEntry`s behind them,
  // for icon + name - re-lists on every change since a rename/move elsewhere
  // in `source` can leave a stale id.
  useEffect(() => {
    const ids = [...selectedIds];
    for (const pendingId of pendingIds) {
      if (!ids.includes(pendingId)) ids.push(pendingId);
    }
    if (ids.length === 0) {
      setEntriesById({});
      return;
    }
    let cancelled = false;
    (async () => {
      const all = (await source.listAll?.()) ?? null;
      const list = all ?? (await source.list(parentFolderOf(ids[0]!)));
      if (cancelled) return;
      const map: Record<string, FileEntry> = {};
      for (const fileId of ids) {
        const found = list.find((item) => item.id === fileId);
        if (found) map[fileId] = found;
      }
      setEntriesById(map);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedIds.join(","), pendingIds.join(","), source]);

  const firstSelectedId = selectedIds[0];
  const entry = !isMultiple && firstSelectedId ? (entriesById[firstSelectedId] ?? null) : null;

  const openPicker = () => {
    if (disabled) return;
    setPending(isMultiple ? selectedIds : (firstSelectedId ?? ""));
    setOpen(true);
  };

  const confirm = () => {
    if (isMultiple) {
      onChange(Array.isArray(pending) ? pending : []);
    } else {
      onChange((pending as string) || "");
    }
    setOpen(false);
  };

  const removeAt = (fileId: string) => {
    onChange(selectedIds.filter((sid) => sid !== fileId));
  };

  const pendingCount = Array.isArray(pending) ? pending.length : pending ? 1 : 0;
  const min = multipleConfig?.min;
  const max = multipleConfig?.max;
  const withinBounds = (min === undefined || pendingCount >= min) && (max === undefined || pendingCount <= max);
  const canConfirm = isMultiple ? withinBounds : !!pending;

  return (
    <div class={`field${className ? ` ${className}` : ""}`} style={style}>
      <label for={fieldId}>{label}{required && <span class="required-asterisk">*</span>}</label>
      {description && <small>{description}</small>}

      {!isMultiple && entry ? (
        <div class="file-field-selected">
          <img class="file-field-icon" src={thumbnailUrl(entry)} alt="" />
          <button
            id={fieldId}
            type="button"
            class="file-field-name"
            disabled={disabled}
            onClick={openPicker}
          >
            {entry.name}
          </button>
          <button
            type="button"
            class="ghost icon sm"
            disabled={disabled}
            aria-label={`Remove ${entry.name}`}
            onClick={() => onChange("")}
          >
            <CloseIcon />
          </button>
        </div>
      ) : (
        <button
          id={fieldId}
          type="button"
          class="file-field-empty"
          disabled={disabled}
          aria-haspopup="dialog"
          onClick={openPicker}
        >
          <ContentIcon />
          <span>{isMultiple && selectedIds.length > 0 ? "Add files" : "Choose file"}</span>
        </button>
      )}

      {isMultiple && selectedIds.length > 0 && (
        <ul class="file-field-list" {...sortableList.containerProps}>
          {selectedIds.map((fileId) => {
            const item = entriesById[fileId];
            return (
              <li key={fileId} data-sortable-id={fileId} class="file-field-list-item">
                <button
                  type="button"
                  class="ghost icon sm"
                  disabled={disabled}
                  {...sortableList.getHandleProps(fileId)}
                >
                  <DragHandleIcon />
                </button>
                {item && <img class="file-field-list-icon" src={thumbnailUrl(item)} alt="" />}
                <span class="file-field-list-name">{item?.name ?? fileId}</span>
                <button
                  type="button"
                  class="ghost icon sm"
                  disabled={disabled}
                  aria-label={`Remove ${item?.name ?? fileId}`}
                  onClick={() => removeAt(fileId)}
                >
                  <CloseIcon />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {name && (
        <input type="hidden" name={name} value={isMultiple ? selectedIds.join(",") : (value as string)} />
      )}
      {helperText && <span class={error ? "error" : "hint"}>{helperText}</span>}

      <dialog
        ref={dialogRef}
        class="file-dialog image-picker-dialog"
        aria-label={isMultiple ? "Choose files" : "Choose file"}
      >
        {open && (
          <>
            <header>
              <h3>{isMultiple ? "Choose files" : "Choose file"}</h3>
            </header>
            <div class="image-picker-body" ref={pickerBody}>
              <EntryScopedPicker
                fullSource={source}
                entrySource={entrySource}
                value={pending}
                onChange={setPending}
                multiple={isMultiple}
                accept={accept}
                initialFolderId={firstSelectedId ? parentFolderOf(firstSelectedId) : undefined}
                syncUrl={false}
              />
            </div>
            <footer class={isMultiple ? "row justify-between" : undefined}>
              {isMultiple && (
                <small class={withinBounds ? "hint" : "error"}>
                  {pendingCount} selected
                  {(min !== undefined || max !== undefined) && ` (${min ?? 0}–${max ?? "∞"})`}
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
