import { useEffect, useId, useState } from "preact/hooks";
import type { FieldProps } from "./field-common.js";
import DataTable, { type DataTableColumn, type SortState } from "./DataTable.js";
import { useDialogSync } from "./list-nav.js";

export interface RelationFieldQuery {
  page: number;
  pageSize: number;
  sortField?: string;
  sortDir?: "asc" | "desc";
  search?: string;
}

/** Abstracts the picker dialog's data away from any particular backend -
 * `content-entry-editor/FieldRenderer.tsx` builds one from
 * `createContentEntriesApi`/a target `ContentTypeDefinition`; a demo (see
 * `pages/Showcase.tsx`) can build one from an in-memory array instead. */
export interface RelationFieldSource<Row extends { id: string }> {
  /** Columns shown in the picker's table, target-specific - a select
   * (radio/checkbox) column is injected automatically, don't include one. */
  columns: DataTableColumn<Row>[];
  fetchRows(query: RelationFieldQuery): Promise<{ rows: Row[]; total: number }>;
  /** Resolves ids to display labels for the trigger card's chip list -
   * batched, called whenever a not-yet-resolved id shows up in `value`. */
  resolveLabels(ids: string[]): Promise<Record<string, string>>;
}

export interface RelationFieldProps extends FieldProps<string | string[]> {
  /** @default false */
  multiple?: boolean;
  source: RelationFieldSource<any>;
  /** Dialog header, e.g. "Choose Author". */
  pickerTitle: string;
  disabled?: boolean;
  name?: string;
  id?: string;
  required?: boolean;
  description?: string;
}

const PAGE_SIZE = 8;

/**
 * Pick-one-or-many-rows field: a card showing the chosen rows' labels that
 * opens a searchable/paginated `DataTable` dialog on click - same
 * trigger+dialog shape as `ImageField`'s picker, just backed by an arbitrary
 * `RelationFieldSource` instead of a `FileManagerSource`. Empty is `""` when
 * `multiple` is off (same "no value" convention as `TextField`/`ImageField`),
 * `[]` when it's on.
 */
export default function RelationField({
  value,
  onChange,
  label,
  helperText,
  error = false,
  multiple = false,
  source,
  pickerTitle,
  disabled = false,
  name,
  id,
  required = false,
  description,
  class: className,
  style,
}: RelationFieldProps) {
  const reactId = useId();
  const fieldId = id ?? `relation-field-${reactId}`;

  const selectedIds: string[] = multiple
    ? Array.isArray(value)
      ? value
      : []
    : value
      ? [value as string]
      : [];

  const [open, setOpen] = useState(false);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const dialogRef = useDialogSync(open, () => setOpen(false));

  const [draftSelected, setDraftSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<SortState>(null);
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<{ id: string }[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // Resolves chip labels for the trigger card - re-runs whenever the
  // selected id SET changes, not on every render.
  useEffect(() => {
    const missing = selectedIds.filter((sid) => !(sid in labels));
    if (missing.length === 0) return;
    let cancelled = false;
    source.resolveLabels(missing).then((resolved) => {
      if (!cancelled) setLabels((current) => ({ ...current, ...resolved }));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, selectedIds.join(",")]);

  useEffect(() => {
    if (open) setDraftSelected(new Set(selectedIds));
    // Only re-stage when the dialog opens, not on every `value` change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    source
      .fetchRows({
        page,
        pageSize: PAGE_SIZE,
        sortField: sort?.key,
        sortDir: sort?.direction,
        search: search || undefined,
      })
      .then((result) => {
        if (cancelled) return;
        setRows(result.rows);
        setTotal(result.total);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, source, page, sort, search]);

  function toggle(rowId: string) {
    setDraftSelected((current) => {
      if (!multiple) return current.has(rowId) ? new Set() : new Set([rowId]);
      const next = new Set(current);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }

  const columns: DataTableColumn<{ id: string }>[] = [
    {
      key: "id",
      label: "",
      sortable: false,
      render: (_value, row) => (
        <input
          type={multiple ? "checkbox" : "radio"}
          checked={draftSelected.has(row.id)}
          onClick={(event) => event.stopPropagation()}
          onChange={() => toggle(row.id)}
        />
      ),
    },
    ...source.columns,
  ];

  return (
    <div class={`field${className ? ` ${className}` : ""}`} style={style}>
      <label for={fieldId}>
        {label}
        {required && <span class="required-asterisk">*</span>}
      </label>
      {description && <small>{description}</small>}
      <button
        id={fieldId}
        type="button"
        class="entry-relation-card"
        aria-haspopup="dialog"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {selectedIds.length === 0 ? (
          <span class="hint">Click to choose.</span>
        ) : (
          <ul class="entry-relation-card-list">
            {selectedIds.map((sid) => (
              <li key={sid}>{labels[sid] ?? "…"}</li>
            ))}
          </ul>
        )}
      </button>
      {name && (
        <input type="hidden" name={name} value={selectedIds.join(",")} />
      )}
      {helperText && <span class={error ? "error" : "hint"}>{helperText}</span>}

      <dialog ref={dialogRef} class="xl ref-picker-dialog" aria-label={pickerTitle}>
        {open && (
          <>
            <header>
              <h3>{pickerTitle}</h3>
            </header>
            <div class="ref-picker-body">
              <DataTable
                columns={columns}
                rows={rows}
                rowKey={(row) => row.id}
                onRowClick={(row) => toggle(row.id)}
                emptyLabel="No entries found."
                serverQuery={{
                  total,
                  page,
                  onPageChange: setPage,
                  sort,
                  onSortChange: setSort,
                  onSearchChange: setSearch,
                  loading,
                }}
              />
            </div>
            <footer class="row justify-between">
              <small>{draftSelected.size} selected</small>
              <div class="row">
                <button type="button" class="outline" onClick={() => setOpen(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const ids = [...draftSelected];
                    onChange(multiple ? ids : (ids[0] ?? ""));
                    setOpen(false);
                  }}
                >
                  Save
                </button>
              </div>
            </footer>
          </>
        )}
      </dialog>
    </div>
  );
}
