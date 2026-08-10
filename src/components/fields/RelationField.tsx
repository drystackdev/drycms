import { useEffect, useId, useState } from "preact/hooks";
import type { JSX } from "preact/jsx-runtime";
import type { FieldProps } from "./field-common.js";
import DataTable, { type DataTableColumn, type SortState } from "../DataTable.js";
import EntrySummaryLines from "../EntrySummaryLines.js";
import { DragHandleIcon, EditIcon, PlusIcon } from "../icons/index.js";
import { useDialogSync } from "../../hooks/list-nav.js";
import { useOverlayScrollbars } from "../../hooks/overlayscrollbars.js";
import { useSortableList } from "../../lib/dnd/useSortableList.js";
import type { SummaryLine } from "../../content-types/engine/entry-summary.js";

export interface RelationFieldQuery {
  page: number;
  pageSize: number;
  sortField?: string;
  sortDir?: "asc" | "desc";
  search?: string;
}

/** Abstracts the picker dialog's data away from any particular backend -
 * `content-entry-editor/FieldRenderer.tsx` builds one from
 * `createContentEntriesApi`/a target `ContentTypeDefinition`; a test can
 * build one from an in-memory array instead. */
export interface RelationFieldSource<Row extends { id: string }> {
  /** Columns shown in the picker's table, target-specific - a select
   * (radio/checkbox) column is injected automatically, don't include one. */
  columns: DataTableColumn<Row>[];
  /** Lets the picker's table offer a "Columns" toggle (same feature
   * `ContentEntryList.tsx`'s own List page table has) so a target with many
   * queryable columns doesn't cram all of them into this compact dialog by
   * default - omit to always show every column in `columns` above. */
  columnToggle?: { storageKey: string; defaultVisible: string[] };
  fetchRows(query: RelationFieldQuery): Promise<{ rows: Row[]; total: number }>;
  /** Resolves ids to display labels for the trigger card's chip list -
   * batched, called whenever a not-yet-resolved id shows up in `value`. Only
   * still used as the accessible name once `resolveSummaries` below is
   * provided - see its own doc comment. */
  resolveLabels(ids: string[]): Promise<Record<string, string>>;
  /** Richer, possibly multi-line summary for the trigger card's chosen-item
   * list (typically `EntrySummaryLines.tsx` fed by `entry-summary.ts`'s
   * `buildEntrySummary`) - rendered INSTEAD of `resolveLabels`' plain string
   * when provided. Optional so a caller with nothing richer than a single
   * label field can skip it entirely. */
  resolveSummaries?(ids: string[]): Promise<Record<string, SummaryLine[]>>;
  /** Optional "create a new row without leaving this picker" escape hatch
   * (`status/relation-quick-create.md`) - absent when the caller doesn't
   * support it, or the current user lacks permission to create in the
   * target collection. `render` mounts the create UI (a nested dialog in
   * practice) driven by `open`, calling `onCreated`/`onCancel` when done -
   * same "caller owns the UI, this just wires callbacks" shape the rest of
   * this interface already uses. */
  createTarget?: {
    /** e.g. "Author" - used as "+ New Author". */
    label: string;
    render: (props: {
      open: boolean;
      onCreated: (id: string) => void;
      onCancel: () => void;
    }) => JSX.Element;
  };
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
  const [summaries, setSummaries] = useState<Record<string, SummaryLine[]>>({});
  const dialogRef = useDialogSync(open, () => setOpen(false));
  const { ref: bodyScroll } = useOverlayScrollbars<HTMLDivElement>([open]);

  const [draftSelected, setDraftSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<SortState>(null);
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<{ id: string }[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  // Bumped after a successful create so the `fetchRows` effect below
  // reloads the current query even though `page`/`sort`/`search` didn't
  // themselves change - lets a freshly-created row show up (and appear
  // checked) without the admin having to re-search/re-page manually.
  const [refreshToken, setRefreshToken] = useState(0);

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

  // Same "resolve whatever's newly missing" shape as the `labels` effect
  // above, just for the richer multi-line summary - only runs at all once
  // `source.resolveSummaries` exists (see its doc comment).
  useEffect(() => {
    if (!source.resolveSummaries) return;
    const missing = selectedIds.filter((sid) => !(sid in summaries));
    if (missing.length === 0) return;
    let cancelled = false;
    source.resolveSummaries(missing).then((resolved) => {
      if (!cancelled) setSummaries((current) => ({ ...current, ...resolved }));
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
  }, [open, source, page, sort, search, refreshToken]);

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

  /** A single-select field has nothing left to pick once a new row exists -
   * commits and closes the whole picker immediately, same as clicking Save
   * right after checking a radio. A multi-select field instead just checks
   * the new row and leaves the picker open, so the admin can keep adding
   * more (existing or freshly created) before committing via Save. */
  function handleCreated(newId: string) {
    setShowCreate(false);
    if (!multiple) {
      onChange(newId);
      setOpen(false);
      return;
    }
    setDraftSelected((current) => new Set(current).add(newId));
    setPage(0);
    setRefreshToken((t) => t + 1);
  }

  // A pinned `leadingColumn` (see `DataTable.tsx`'s own doc comment) rather
  // than folded into `columns` below - unlike `source.columns`, the select
  // control should never be hideable via that table's own `columnToggle`.

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
                {source.resolveSummaries ? (
                  summaries[sid] ? (
                    <EntrySummaryLines lines={summaries[sid]} />
                  ) : (
                    <span class="hint">…</span>
                  )
                ) : (
                  <span>{labels[sid] ?? "…"}</span>
                )}
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
            <div class="ref-picker-body" ref={bodyScroll}>
              <DataTable
                columns={source.columns}
                columnToggle={source.columnToggle}
                leadingColumn={{
                  render: (row) => (
                    <input
                      type={multiple ? "checkbox" : "radio"}
                      checked={draftSelected.has(row.id)}
                      onClick={(event) => event.stopPropagation()}
                      onChange={() => toggle(row.id)}
                    />
                  ),
                }}
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
              <div class="row" style={{ alignItems: "center" }}>
                {source.createTarget && (
                  <button
                    type="button"
                    class="outline"
                    onClick={() => setShowCreate(true)}
                  >
                    <PlusIcon /> New {source.createTarget.label}
                  </button>
                )}
                <small>{draftSelected.size} selected</small>
              </div>
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
      {source.createTarget?.render({
        open: showCreate,
        onCreated: handleCreated,
        onCancel: () => setShowCreate(false),
      })}
    </div>
  );
}
