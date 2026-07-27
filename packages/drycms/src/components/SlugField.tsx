import { useId, useState } from "preact/hooks";
import TextField from "./TextField.js";
import { slugify } from "../lib/slugify.js";

export interface SlugFieldProps {
  /** Top input - the human label the slug is derived from (e.g. Title). */
  value: string;
  /** Bottom input - the derived/editable slug. */
  slug: string;
  onChange: (value: string, slug: string) => void;
  label?: string;
  slugLabel?: string;
  placeholder?: string;
  slugPlaceholder?: string;
  helperText?: string;
  error?: boolean;
  disabled?: boolean;
  name?: string;
  id?: string;
  required?: boolean;
  /** Overrides how the slug is derived from `value` (initial + "regenerate"
   * button). Defaults to `slugify` (hyphen-joined); pass `slugifyIdentifier`
   * when the slug must be a bare identifier, e.g. a content-type field name. */
  toSlug?: (text: string) => string;
}

/** `solar:refresh-square-linear`-style regenerate icon, hand-written from the
 * exact markup requested rather than routed through the generated icon
 * pipeline (icons.tsx) - this one glyph needs to match verbatim, not the
 * closest iconify approximation. */
function RegenerateSlugIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      class="select-caret"
      aria-hidden="true"
    >
      <path d="M0 0h24v24H0z" fill="none" />
      <path
        fill="currentColor"
        fill-rule="evenodd"
        d="m18.94 6.5l-2.97-2.97l1.06-1.06l3.897 3.896a1.25 1.25 0 0 1 0 1.768L17.03 12.03l-1.06-1.06L18.94 8H5.75c-.69 0-1.25.56-1.25 1.25V11H3V9.25A2.75 2.75 0 0 1 5.75 6.5zm-13.88 11l2.97 2.97l-1.06 1.06l-3.897-3.896a1.25 1.25 0 0 1 0-1.768L6.97 11.97l1.06 1.06L5.06 16h13.19c.69 0 1.25-.56 1.25-1.25V13H21v1.75a2.75 2.75 0 0 1-2.75 2.75z"
        clip-rule="evenodd"
      />
    </svg>
  );
}

/**
 * Like `TextField`, but pairs a human label (top input) with a derived,
 * editable slug (bottom input) - Keystatic-style. Auto-derives the slug from
 * the label via `slugify()` until the user edits the slug input directly, at
 * which point auto-derivation stops; the trailing icon button re-syncs it
 * from the current label on demand.
 */
export default function SlugField({
  value,
  slug,
  onChange,
  label = "Title",
  slugLabel = "Slug",
  placeholder,
  slugPlaceholder,
  helperText,
  error = false,
  disabled = false,
  name,
  id,
  required = false,
  toSlug = slugify,
}: SlugFieldProps) {
  const [slugTouched, setSlugTouched] = useState(false);
  const reactId = useId();
  const slugFieldId = id ?? `slug-field-${reactId}`;

  return (
    <div class="stack">
      <TextField
        label={label}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(nextValue) => {
          onChange(nextValue, slugTouched ? slug : toSlug(nextValue));
        }}
        required={required}
        error={error}
      />
      <div class="field">
        <label for={slugFieldId}>{slugLabel}</label>
        <div class="select">
          <input
            id={slugFieldId}
            type="text"
            name={name}
            value={slug}
            placeholder={slugPlaceholder}
            disabled={disabled}
            aria-invalid={error || undefined}
            onInput={(event) => {
              setSlugTouched(true);
              onChange(value, (event.target as HTMLInputElement).value);
            }}
          />
          <button
            type="button"
            class="select-trailing"
            disabled={disabled}
            aria-label="Regenerate slug from title"
            onClick={() => {
              setSlugTouched(false);
              onChange(value, toSlug(value));
            }}
          >
            <RegenerateSlugIcon />
          </button>
        </div>
        {helperText && (
          <small class={error ? "error" : "hint"}>{helperText}</small>
        )}
      </div>
    </div>
  );
}
