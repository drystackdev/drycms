import { useEffect, useMemo, useState } from "preact/hooks";
import { path } from "virtual:drycms/config";
import DataTable, { type DataTableColumn, type SortState } from "../../components/DataTable.js";
import { useDialogSync } from "../../components/list-nav.js";
import { createContentEntriesApi } from "../../content-types/entries-http-api.js";
import { buildEntryFieldTree, flattenQueryableColumns } from "../../content-types/engine/entry-tree.js";
import type { ContentTypeDefinition } from "../../content-types/types.js";

interface Row extends Record<string, unknown> {
  id: string;
}

interface Props {
  open: boolean;
  multiple: boolean;
  targetType: ContentTypeDefinition;
  allTypes: ContentTypeDefinition[];
  /** Already-hashed ids (see `lib/id-hash.ts`). */
  selectedIds: string[];
  onCancel: () => void;
  onSave: (ids: string[]) => void;
}

const PAGE_SIZE = 8;

/** A dialog for picking one (`manyToOne`) or several (`oneToMany`/`manyToMany`)
 * rows of a `relation` field's target collection - reuses the same paginated/
 * searchable `DataTable` the List page uses, in a checkbox/radio-per-row mode,
 * following `FieldDialog.tsx`'s header/scroll-body/footer chrome. Selection is
 * staged locally (`draftSelected`) and only committed via `onSave` - Cancel
 * discards it. */
export default function RefPickerDialog({ open, multiple, targetType, allTypes, selectedIds, onCancel, onSave }: Props) {
  const dialogRef = useDialogSync(open, onCancel);
  const entriesApi = useMemo(() => createContentEntriesApi(`${path}/api/content`, targetType.name), [targetType.name]);
  const queryableColumns = useMemo(
    () => flattenQueryableColumns(buildEntryFieldTree(targetType, allTypes)).slice(0, 3),
    [targetType, allTypes],
  );

  const [draftSelected, setDraftSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<SortState>(null);
  const [search, setSearch] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (open) setDraftSelected(new Set(selectedIds));
  }, [open, selectedIds]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    entriesApi
      .list({
        page,
        pageSize: PAGE_SIZE,
        sortField: sort?.key,
        sortDir: sort?.direction,
        search: search || undefined,
        searchableFields: queryableColumns.map((c) => c.fieldName),
      })
      .then((result) => {
        if (cancelled) return;
        setRows(result.rows.map((r) => ({ id: r.id, ...r.value })));
        setTotal(result.total);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, entriesApi, page, sort, search, queryableColumns]);

  function toggle(id: string) {
    setDraftSelected((current) => {
      if (!multiple) return current.has(id) ? new Set() : new Set([id]);
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const columns: DataTableColumn<Row>[] = [
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
    ...queryableColumns.map(
      (column): DataTableColumn<Row> => ({
        key: column.fieldName,
        label: column.label,
        render: (value) => <>{value === null || value === undefined || value === "" ? "—" : String(value)}</>,
      }),
    ),
  ];

  return (
    <dialog ref={dialogRef} aria-label={`Choose ${targetType.label}`} class="xl ref-picker-dialog">
      {open && (
        <>
          <header>
            <h3>Choose {targetType.label}</h3>
          </header>
          <div class="ref-picker-body">
            <DataTable
              columns={columns}
              rows={rows}
              rowKey={(row) => row.id}
              onRowClick={(row) => toggle(row.id)}
              emptyLabel="No entries found."
              serverQuery={{ total, page, onPageChange: setPage, sort, onSortChange: setSort, onSearchChange: setSearch, loading }}
            />
          </div>
          <footer class="row justify-between">
            <small>{draftSelected.size} selected</small>
            <div class="row">
              <button type="button" class="outline" onClick={onCancel}>
                Cancel
              </button>
              <button type="button" onClick={() => onSave([...draftSelected])}>
                Save
              </button>
            </div>
          </footer>
        </>
      )}
    </dialog>
  );
}
