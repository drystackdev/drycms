import dayjs from "dayjs";
import type { JSX } from "preact/jsx-runtime";
const { path } = window.__DRY_CONFIG__;
import { encodePath } from "../storage/http-source.js";
import { EyeIcon } from "./icons/index.js";
import type { QueryableColumn } from "../content-types/engine/entry-tree.js";

/**
 * Renders one entry field's read-only cell value, dispatching on the
 * column's `fieldType` (plus `fieldName`/`validation.format` for the couple
 * of cases that need finer detail than the type alone gives) - each field
 * type gets the display its data shape calls for, instead of one generic
 * stringify. Shared by `ContentEntryList.tsx`'s own table and
 * `FieldRenderer.tsx`'s relation-picker dialog table (`useRelationFieldSource`)
 * so both render the same way.
 */
export function renderEntryCellValue(
  column: QueryableColumn,
  value: unknown,
  onPreviewRichText: (label: string, html: string) => void,
): JSX.Element {
  const config = (column.fieldConfig ?? {}) as Record<string, unknown>;

  // Always has a value either way (see `field-registry.ts`'s `booleanFieldType`
  // doc), so this branch runs before the shared empty-value check below.
  if (column.fieldType === "boolean") {
    const on = !!value;
    return (
      <span class="row" style={{ gap: "0.375rem" }}>
        <input
          type="checkbox"
          role="switch"
          checked={on}
          disabled
          aria-label={on ? "On" : "Off"}
        />
        <span>{on ? "On" : "Off"}</span>
      </span>
    );
  }

  if (value === null || value === undefined || value === "")
    return (
      <small>
        <i>No value</i>
      </small>
    );

  // The system `slug` field (`features.slug` - see `system-fields.ts`) always
  // ships paired with a sibling `title` field; a manually `format: "slug"`
  // text field may not have one, so this still degrades to just the slug.
  if (
    column.fieldType === "text" &&
    (column.fieldName === "slug" || column.validation.format === "slug")
  ) {
    return <small class="hint">{String(value)}</small>;
  }

  if (column.validation.format === "email") {
    return <span class="badge secondary">{String(value)}</span>;
  }

  // Raw HTML string (see `field-registry.ts`'s `richTextFieldType`, `shape: "column"`
  // / `sqlType: () => "TEXT"`) - only `inline` richtext (short, text-like content per
  // `FieldDialog.tsx`'s three-way mode picker) is worth previewing as plain text right
  // in the cell; block-level richtext (paragraphs/headings/tables/grids) would just
  // dump tag soup into the cell, so it opens a dialog with the formatted HTML instead
  // (same `CodeBlock`/`formatHtml` combo `IconPreviewDialog.tsx` uses for its snippet).
  if (column.fieldType === "richtext") {
    if (config.inline) {
      return value ? (
        <p
          class="richtext-preview"
          dangerouslySetInnerHTML={{ __html: String(value) }}
        />
      ) : (
        <small>
          <i>No value</i>
        </small>
      );
    }
    return (
      <button
        type="button"
        class="outline sm"
        // Cell clicks otherwise bubble to the row's own click handler
        // (navigates the List page / toggles the picker row), which would
        // fire right alongside opening this dialog.
        onClick={(event) => {
          event.stopPropagation();
          onPreviewRichText(column.label, String(value));
        }}
      >
        <EyeIcon /> View HTML
      </button>
    );
  }

  if (column.fieldType === "date") {
    const parsed = dayjs(value as string);
    if (!parsed.isValid()) return <>{String(value)}</>;
    return (
      <span class="stack" style={{ gap: "0.125rem" }}>
        <span>{parsed.format("YYYY-MM-DD")}</span>
        <small class="hint">{parsed.format("HH:mm")}</small>
      </span>
    );
  }

  if (column.fieldType === "image") {
    // `config.multiple` stores a comma-joined id list (see `field-registry.ts`'s
    // `imageFieldType`), deserialized to a plain array by the time it gets here -
    // a bare non-multiple value renders identically to before via the 1-item array.
    const ids = Array.isArray(value) ? value : [value];
    const cellClass = config.isAvatar ? "cell-avatar" : "cell-image";
    const shown = ids.slice(0, 3);
    return (
      <span class="row" style={{ gap: "0.375rem" }}>
        {shown.map((id) => (
          <img
            key={String(id)}
            class={cellClass}
            src={`${path}/api/storage/${encodePath(String(id))}`}
            alt=""
          />
        ))}
        {ids.length > shown.length && (
          <small class="hint">+{ids.length - shown.length}</small>
        )}
      </span>
    );
  }

  // Unlike `image` above, the value itself IS the pixels (a
  // `data:image/webp;...` string - see `field-registry.ts`'s
  // `avatarFieldType`), so this renders it directly rather than resolving a
  // storage id through `/api/storage/...`.
  if (column.fieldType === "avatar") {
    return <img class="cell-avatar" src={String(value)} alt="" />;
  }

  if (column.fieldType === "select") {
    const values = Array.isArray(value) ? value : [value];
    return (
      <span class="row" style={{ gap: "0.375rem" }}>
        {values.map((v) => (
          <span class="badge outline lg" key={String(v)}>
            {String(v)}
          </span>
        ))}
      </span>
    );
  }

  if (Array.isArray(value)) return <>{value.join(", ")}</>;
  return <>{String(value)}</>;
}
