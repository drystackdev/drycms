import { useEffect, useId, useState } from "preact/hooks";
import type { FieldProps } from "./field-common.js";
import FileManager from "./FileManager.js";
import type { FileEntry, FileManagerSource } from "./file-manager-types.js";
import { thumbnailUrl } from "./file-manager-utils.js";
import { CloseIcon, MediaIcon, UploadIcon } from "./icons.js";
import { useDialogSync } from "./list-nav.js";
import { useOverlayScrollbars } from "./overlayscrollbars.js";

export interface ImageFieldProps extends FieldProps<string> {
  /** Where the picker dialog's `FileManager` reads its files from. */
  source: FileManagerSource;
  disabled?: boolean;
  name?: string;
  id?: string;
  description?: string;
}

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "gif", "svg", "webp"];

/** `id`s are paths (see `FileManagerSource`) - the folder containing one is
 * everything before its last `/`, root when there isn't one. */
function parentFolderOf(id: string): string | null {
  const slash = id.lastIndexOf("/");
  return slash === -1 ? null : id.slice(0, slash);
}

/**
 * Single-image picker: a 4:3 frame that opens a `FileManager`-backed dialog
 * on click. Once a file is chosen the frame shows its thumbnail under a
 * name + remove overlay; clicking the overlay reopens the dialog scoped to
 * that file's folder with it already checked, so re-picking starts right
 * where the current selection lives instead of wherever the picker was last
 * left. Non-image files are still browsable there (folders may hold a mix)
 * but shown disabled and dimmed, via `FileManager`'s own `accept` handling.
 */
export default function ImageField({
  source,
  value,
  onChange,
  label,
  helperText,
  error = false,
  disabled = false,
  name,
  id,
  description,
  class: className,
  style,
}: ImageFieldProps) {
  const reactId = useId();
  const fieldId = id ?? `image-field-${reactId}`;

  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(value);
  const [entry, setEntry] = useState<FileEntry | null>(null);
  const dialogRef = useDialogSync(open, () => setOpen(false));
  // Deps include `open`: the body only mounts once the dialog opens, so the
  // ref is still null on `ImageField`'s own first render.
  const { ref: pickerBody } = useOverlayScrollbars<HTMLDivElement>([open]);

  // Resolves `value` (just an id) to the `FileEntry` behind it, for the
  // frame's thumbnail + name - re-lists on every change since a rename/move
  // elsewhere in `source` can leave a stale id.
  useEffect(() => {
    if (!value) {
      setEntry(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const all = (await source.listAll?.()) ?? null;
      const list = all ?? (await source.list(parentFolderOf(value)));
      if (!cancelled) setEntry(list.find((item) => item.id === value) ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [value, source]);

  const openPicker = () => {
    if (disabled) return;
    setPending(value);
    setOpen(true);
  };

  const confirm = () => {
    onChange(pending);
    setOpen(false);
  };

  return (
    <div class={`field${className ? ` ${className}` : ""}`} style={style}>
      <label for={fieldId}>{label}</label>
      {description && <small>{description}</small>}
      <div class="image-field-box">
        {entry ? (
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
            <span>Choose image</span>
          </button>
        )}
      </div>
      {name && <input type="hidden" name={name} value={value} />}
      {helperText && <span class={error ? "error" : "hint"}>{helperText}</span>}

      <dialog
        ref={dialogRef}
        class="file-dialog image-picker-dialog"
        aria-label="Choose image"
      >
        {open && (
          <>
            <header>
              <h3>Choose image</h3>
            </header>
            <div class="image-picker-body" ref={pickerBody}>
              <FileManager
                source={source}
                value={pending}
                onChange={(next) => setPending(next as string)}
                multiple={false}
                accept={IMAGE_EXTENSIONS}
                initialFolderId={value ? parentFolderOf(value) : undefined}
                syncUrl={false}
              />
            </div>
            <footer>
              <button type="button" class="outline" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button type="button" disabled={!pending} onClick={confirm}>
                Select
              </button>
            </footer>
          </>
        )}
      </dialog>
    </div>
  );
}
