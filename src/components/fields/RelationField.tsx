import { useEffect, useId, useState } from "preact/hooks";
import type { FieldProps } from "./field-common.js";
import DataTable, { type DataTableColumn, type SortState } from "../DataTable.js";
import { DragHandleIcon, EditIcon } from "../icons/index.js";
import { useDialogSync } from "../../hooks/list-nav.js";
import { useSortableList } from "../../lib/dnd/useSortableList.js";

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
  /** Lets the chosen-items list be manually drag-reordered (via
   * `useSortableList`, same as `ComponentField`'s `sortable`) - only ever
   * meaningful alongside `multiple` (a single value has nothing to reorder).
   * Order is just `value`'s own array order, nothing extra to persist.
   * @default false */
  sortable?: boolean;
}

const PAGE_SIZE = 8;

/**
 * Pick-one-or-many-rows field: a card showing the chosen rows' labels, with a
 * separate "Edit" button that opens a searchable/paginated `DataTable`
 * dialog - the picker dialog itself is the same trigger+dialog shape
 * `ImageField`'s picker uses, just backed by an arbitrary `RelationFieldSource`
 * instead of a `FileManagerSource`. The Edit button is deliberately its own
 * control rather than the whole card being clickable (as it used to be):
 * when `sortable` is on, the chip list's rows carry a drag handle
 * (`useSortableList`, same as `ComponentField`), and a native `<button>`
 * can't cleanly host that without a pointerdown on the handle also firing the
 * card's own click. Empty is `""` when `multiple` is off (same "no value"
 * convention as `TextField`/`ImageField`), `[]` when it's on.
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
  sortable = false,
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

  const dnd = useSortableList<{ id: string }>({
    items: selectedIds.map((sid) => ({ id: sid })),
    getId: (row) => row.id,
    onReorder: (next) => onChange(multiple ? next.map((row) => row.id) : (next[0]?.id ?? "")),
    disabled: disabled || !sortable || !multiple,
  });

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
      <div style={{ marginTop: "0.5rem" }}>
        <button
          id={fieldId}
          type="button"
          class="outline"
          aria-haspopup="dialog"
          disabled={disabled}
          onClick={() => setOpen(true)}
        >
          <EditIcon /> Edit
        </button>
      </div>
      <div class="entry-relation-card">
        {selectedIds.length === 0 ? (
          <div style={{ textAlign: "center", paddingBlock: "1.5rem" }}>
            <span class="hint">No items selected.</span>
          </div>
        ) : (
          <ul class="entry-relation-card-list" {...dnd.containerProps}>
            {selectedIds.map((sid) => (
              <li
                key={sid}
                data-sortable-id={sortable && multiple ? sid : undefined}
                class={dnd.draggingId === sid ? "dnd-drag-placeholder" : undefined}
              >
                {sortable && multiple && (
                  <button
                    type="button"
                    class="ghost icon sm"
                    disabled={disabled}
                    {...(disabled ? {} : dnd.getHandleProps(sid))}
                  >
                    <DragHandleIcon />
                  </button>
                )}
                <span>{labels[sid] ?? "…"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
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
