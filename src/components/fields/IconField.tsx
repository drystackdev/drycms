import { useEffect, useId, useMemo, useState } from "preact/hooks";
import type { FieldProps } from "./field-common.js";
import IconGlyph from "../IconGlyph.js";
import { createIconsApi, type IconEntry } from "../../icons/icons-http-api.js";
import { adminPath } from "../../storage/admin-path.js";
import { iconTagHtml, resolveIconSrc } from "../../storage/http-source.js";
import { toast } from "../Toast.js";
import { CloseIcon, IconFieldTypeIcon } from "../icons/index.js";
import { useDialogSync } from "../../hooks/list-nav.js";
import { useOverlayScrollbars } from "../../hooks/overlayscrollbars.js";

const PAGE_SIZE = 48;
const SEARCH_DEBOUNCE_MS = 300;

/** Icons physically live in a `dry-icons/` subfolder of the storage root
 * (`options.ts`'s `resolveIconsOption`) - the field stores that full
 * relative path, same "store the subfolder-prefixed id whole" convention
 * `field-registry.ts`'s `avatarFieldType` uses for `.avatar/<id>`, rather
 * than splitting folder+name. `createIconsApi` (Icon Management's own
 * library listing) only knows the bare filename within its own root, so
 * these two convert between the two shapes. */
const ICONS_FOLDER = "dry-icons";

function toStorageId(name: string): string {
  return `${ICONS_FOLDER}/${name}`;
}

function iconLabelOf(storageId: string): string {
  const name = storageId.startsWith(`${ICONS_FOLDER}/`) ? storageId.slice(ICONS_FOLDER.length + 1) : storageId;
  return name.replace(/\.svg$/i, "");
}

export interface IconFieldProps extends FieldProps<string> {
  disabled?: boolean;
  name?: string;
  id?: string;
  required?: boolean;
  description?: string;
}

/**
 * Icon picker: a small square tile (mirroring `AvatarField`'s box, sized for
 * a glyph rather than a photo) that opens a dialog listing icons already
 * imported into the local library (Icon Management's own storage, browsed
 * here read-only via `createIconsApi().list()` - importing new ones stays on
 * `IconSearchAdd`, linked from the dialog's empty state). Stores the picked
 * icon's full storage id; `resolveIconSrc`/`iconTagHtml` (`storage/http-source.ts`)
 * turn that into a usable mask-image URL or a copy-pasteable `<i style="...">`
 * snippet, both reachable from the field itself once something's picked.
 */
export default function IconField({
  value,
  onChange,
  label,
  helperText,
  error = false,
  disabled = false,
  name,
  id,
  required = false,
  description,
  class: className,
  style,
}: IconFieldProps) {
  const reactId = useId();
  const fieldId = id ?? `icon-field-${reactId}`;
  const base = adminPath();
  const iconsApi = useMemo(() => createIconsApi(`${base}/api/icons`), [base]);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [entries, setEntries] = useState<IconEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const dialogRef = useDialogSync(open, () => setOpen(false));
  const { ref: pickerBody } = useOverlayScrollbars<HTMLDivElement>([open]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    const trimmed = query.trim();
    const handle = setTimeout(
      () => {
        iconsApi
          .list({ page, pageSize: PAGE_SIZE, search: trimmed || undefined })
          .then((result) => {
            setEntries(result.entries);
            setTotal(result.total);
          })
          .catch(() => {
            setEntries([]);
            setTotal(0);
          })
          .finally(() => setLoading(false));
      },
      trimmed ? SEARCH_DEBOUNCE_MS : 0,
    );
    return () => clearTimeout(handle);
  }, [open, iconsApi, query, page]);

  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const glyphSrc = value ? resolveIconSrc(value) : "";

  const openPicker = () => {
    if (disabled) return;
    setQuery("");
    setPage(0);
    setOpen(true);
  };

  const pick = (entry: IconEntry) => {
    onChange(toStorageId(entry.name));
    setOpen(false);
  };

  const copySnippet = (event: MouseEvent) => {
    event.stopPropagation();
    if (!value) return;
    navigator.clipboard.writeText(iconTagHtml(value)).then(
      () => toast.add({ type: "success", title: "<i> tag copied to clipboard." }),
      () => toast.add({ type: "error", title: "Could not copy to clipboard." }),
    );
  };

  return (
    <div class={`field${className ? ` ${className}` : ""}`} style={style}>
      <label for={fieldId}>
        {label}
        {required && <span class="required-asterisk">*</span>}
      </label>
      {description && <small>{description}</small>}
      <div class="row" style={{ alignItems: "flex-start", gap: "0.75rem" }}>
        <div class="icon-field-box">
          {value ? (
            <>
              <span class="icon-field-thumb">
                <IconGlyph src={glyphSrc} size={28} />
              </span>
              <button
                id={fieldId}
                type="button"
                class="icon-field-overlay"
                disabled={disabled}
                aria-label={`Change ${iconLabelOf(value)}`}
                onClick={openPicker}
              />
              <button
                type="button"
                class="icon-field-remove ghost icon sm"
                disabled={disabled}
                aria-label="Remove icon"
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
              class="icon-field-empty"
              disabled={disabled}
              aria-haspopup="dialog"
              aria-label="Choose icon"
              onClick={openPicker}
            >
              <IconFieldTypeIcon />
            </button>
          )}
        </div>
        {value && (
          <div class="stack" style={{ gap: "0.25rem" }}>
            <span class="mono">{iconLabelOf(value)}</span>
            <button type="button" class="outline sm" onClick={copySnippet}>
              Copy &lt;i&gt; tag
            </button>
          </div>
        )}
      </div>

      {name && <input type="hidden" name={name} value={value} />}
      {helperText && <span class={error ? "error" : "hint"}>{helperText}</span>}

      <dialog ref={dialogRef} class="file-dialog icon-picker-dialog" aria-label="Choose icon">
        {open && (
          <>
            <header>
              <h3>Choose icon</h3>
            </header>
            <div class="icon-picker-body" ref={pickerBody}>
              <input
                value={query}
                onInput={(event) => {
                  setPage(0);
                  setQuery((event.currentTarget as HTMLInputElement).value);
                }}
                placeholder="e.g. home, arrow, user"
              />
              {loading ? (
                <p class="hint">Loading...</p>
              ) : entries.length === 0 ? (
                <p class="hint">
                  No icons found.{" "}
                  <a href={`${base}/icon-management`} target="_blank" rel="noreferrer">
                    Add more in Icon Management
                  </a>
                  .
                </p>
              ) : (
                <div class="icon-grid">
                  {entries.map((entry) => (
                    <button type="button" key={entry.name} class="ghost icon-cell" onClick={() => pick(entry)}>
                      <IconGlyph src={resolveIconSrc(toStorageId(entry.name))} size={24} />
                      <small class="mono">{entry.name.replace(/\.svg$/i, "")}</small>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {pageCount > 1 && (
              <div class="row justify-between">
                <small>
                  Page {page + 1} of {pageCount}
                </small>
                <div class="row">
                  <button type="button" class="outline sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
                    Previous
                  </button>
                  <button
                    type="button"
                    class="outline sm"
                    disabled={page >= pageCount - 1}
                    onClick={() => setPage(page + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
            <footer>
              <button type="button" class="outline" onClick={() => setOpen(false)}>
                Cancel
              </button>
            </footer>
          </>
        )}
      </dialog>
    </div>
  );
}
