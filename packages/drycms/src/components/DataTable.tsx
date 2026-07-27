import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  ColumnsIcon,
} from "./icons.js";
import Popover from "./Popover.js";
import { useStore } from "../hooks/useStore.js";
import { useOverlayScrollbars } from "./overlayscrollbars.js";
import type { JSX } from "preact/jsx-runtime";
import CheckField from "./CheckField.js";

export interface DataTableColumn<Row> {
  key: string & keyof Row;
  label: string;
  numeric?: boolean;
  sortable?: boolean;
  render?: (value: Row[keyof Row], row: Row) => JSX.Element;
}

export type SortState = { key: string; direction: "asc" | "desc" } | null;

export interface DataTableServerQuery {
  /** Total row count across every page (not just the current one) - drives
   * the Prev/Next page count, since `rows` itself is only the current page. */
  total: number;
  page: number;
  onPageChange: (page: number) => void;
  sort: SortState;
  onSortChange: (sort: SortState) => void;
  /** Debounced (300ms) internally - server mode can't filter client-side, so
   * every distinct search value is pushed up instead of computed here. */
  onSearchChange?: (search: string) => void;
  loading?: boolean;
}

export interface DataTableColumnToggle {
  /** `useStore` key - persists which columns are visible across visits. */
  storageKey: string;
  /** Column `key`s visible the first time this table is ever shown. */
  defaultVisible: string[];
  /** Fires on mount and on every change, so a caller doing server-side
   * search (which can only search *some* columns) knows which ones are
   * currently toggled on. */
  onVisibleChange?: (visible: string[]) => void;
}

export interface DataTableProps<Row extends Record<string, unknown>> {
  columns: DataTableColumn<Row>[];
  rows: Row[];
  /** Rows per page. Pass `0` to disable pagination. @default 10 */
  pageSize?: number;
  /** Show the filter input. @default true */
  searchable?: boolean;
  searchPlaceholder?: string;
  emptyLabel?: string;
  /** When provided, each row becomes clickable (e.g. "click to edit") -
   * cell-level `render` buttons should still call `stopPropagation()` so
   * they don't also trigger the row click. */
  onRowClick?: (row: Row) => void;
  actions?: JSX.Element
  /** Stable identity for a row, so per-row UI state (an open menu, an
   * inline input from `render`) stays with the right row across
   * sort/filter/page instead of whatever row now occupies the same index.
   * Falls back to the row's index when omitted. */
  rowKey?: (row: Row) => string | number;
  /** When set, `rows` is treated as already-sorted/paginated/filtered by the
   * caller (e.g. a server query) - internal sort/paginate/slice is disabled
   * and delegated to this instead. Omit for the original fully-client-side
   * behavior. */
  serverQuery?: DataTableServerQuery;
  /** When set, adds a "Columns" toggle next to the search box so some
   * columns can be hidden - only toggled-on columns render, and (per the
   * content-entry list's requirement) only toggled-on columns are ever
   * offered as `serverQuery`'s search target. */
  columnToggle?: DataTableColumnToggle;
}

function toText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return toText(a).localeCompare(toText(b), undefined, { numeric: true });
}

const NO_COLUMN_TOGGLE_KEY = "datatable:unused-column-toggle";
/** At most this many columns can be visible at once - showing more starts
 * crowding the table, so past this the picker just disables the rest until
 * one is unchecked first. */
const MAX_VISIBLE_COLUMNS = 5;

/**
 * Sortable, filterable, paginated table. Renders plain `<table>` markup so the
 * drycms stylesheet does all the styling. Fully client-side (in-memory) by
 * default; pass `serverQuery` to instead delegate sort/page/search to a
 * caller-owned server request, and/or `columnToggle` to let some columns be
 * hidden (persisted via `useStore`).
 */
export default function DataTable<Row extends Record<string, unknown>>({
  columns,
  rows,
  pageSize = 10,
  searchable = true,
  searchPlaceholder = "Filter…",
  emptyLabel = "No results.",
  onRowClick,
  actions,
  rowKey,
  serverQuery,
  columnToggle,
}: DataTableProps<Row>) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState>(null);
  const [page, setPage] = useState(0);
  const { ref: scroll } = useOverlayScrollbars<HTMLDivElement>();
  const searchDebounce = useRef<ReturnType<typeof setTimeout>>();

  const allKeys = columns.map((c) => c.key);
  // When `columnToggle` is omitted, this still calls `useStore` (hooks must
  // run unconditionally) but under a fixed, never-read-back key - `storedVisible`
  // itself is ignored below in that case, so it's at most one harmless,
  // write-once entry in the shared `drycms:store` blob for the whole app.
  const [storedVisible, setStoredVisible] = useStore<string[]>(
    columnToggle?.storageKey ?? NO_COLUMN_TOGGLE_KEY,
    columnToggle?.defaultVisible ?? allKeys,
  );
  const visibleKeys = columnToggle ? (storedVisible ?? allKeys) : allKeys;
  const visibleColumns = columns.filter((c) => visibleKeys.includes(c.key));

  useEffect(() => {
    columnToggle?.onVisibleChange?.(visibleKeys);
    // Only the visible SET matters here, not the caller's callback identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columnToggle && visibleKeys.join(",")]);

  useEffect(() => () => clearTimeout(searchDebounce.current), []);

  function toggleColumnVisible(key: string) {
    setStoredVisible((current) => {
      const set = new Set(current ?? allKeys);
      if (set.has(key)) {
        if (set.size <= 1) return current; // always keep at least one column visible.
        set.delete(key);
      } else {
        if (set.size >= MAX_VISIBLE_COLUMNS) return current; // capped - see MAX_VISIBLE_COLUMNS.
        set.add(key);
      }
      return allKeys.filter((k) => set.has(k)); // stable, declared column order.
    });
  }

  function handleSearchInput(value: string) {
    setQuery(value);
    setPage(0);
    if (!serverQuery) return;
    clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => serverQuery.onSearchChange?.(value), 300);
  }

  const filtered = useMemo(() => {
    if (serverQuery) return rows; // already filtered server-side.
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      visibleColumns.some((column) =>
        toText(row[column.key]).toLowerCase().includes(needle),
      ),
    );
  }, [rows, visibleColumns, query, serverQuery]);

  const sorted = useMemo(() => {
    if (serverQuery || !sort) return filtered; // server mode: already sorted.
    const direction = sort.direction === "asc" ? 1 : -1;
    return [...filtered].sort(
      (a, b) => compare(a[sort.key], b[sort.key]) * direction,
    );
  }, [filtered, sort, serverQuery]);

  const perPage = pageSize > 0 ? pageSize : sorted.length || 1;
  const totalRows = serverQuery ? serverQuery.total : sorted.length;
  const pageCount = Math.max(1, Math.ceil(totalRows / perPage));
  const current = serverQuery ? serverQuery.page : Math.min(page, pageCount - 1);
  const visible = serverQuery ? sorted : sorted.slice(current * perPage, current * perPage + perPage);
  const activeSort = serverQuery ? serverQuery.sort : sort;

  const toggleSort = (key: string) => {
    const nextSort = (previous: SortState): SortState => {
      if (previous?.key !== key) return { key, direction: "asc" };
      if (previous.direction === "asc") return { key, direction: "desc" };
      return null;
    };
    if (serverQuery) {
      serverQuery.onPageChange(0);
      serverQuery.onSortChange(nextSort(serverQuery.sort));
    } else {
      setPage(0);
      setSort(nextSort);
    }
  };

  const goToPage = (nextPage: number) => (serverQuery ? serverQuery.onPageChange(nextPage) : setPage(nextPage));

  return (
    <div class="stack">
      {searchable && (
        <div class="row" style={{gap: '0.5rem'}}>
          <input
            type="search"
            value={query}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            style="max-width: 18rem"
            onInput={(event) => handleSearchInput((event.currentTarget as HTMLInputElement).value)}
          />
          {columnToggle && (
            <Popover
              label="Choose visible columns"
              trigger={(onClick) => (
                <button class="outline lg" onClick={onClick}>
                  <ColumnsIcon />
                  Column
                  <span class="badge sm outline">{visibleKeys.length}</span>
                </button>
              )}
            >
              {columns.map((column) => {
                const checked = visibleKeys.includes(column.key);
                const disabled = !checked && visibleKeys.length >= MAX_VISIBLE_COLUMNS;
                return (
                  <li key={column.key}>
                    <CheckField
                      label={column.label}
                      value={checked}
                      disabled={disabled}
                      onChange={() => toggleColumnVisible(column.key)}
                    />
                  </li>
                );
              })}
            </Popover>
          )}
          <span class="spacer" />
          <small>{serverQuery?.loading ? "Loading…" : `${totalRows} of ${serverQuery ? serverQuery.total : rows.length}`}</small>
          {actions}
        </div>
      )}

      <div class="scroll" ref={scroll}>
        <table>
          <thead>
            <tr>
              {visibleColumns.map((column) => {
                const sortable = column.sortable !== false;
                const active = activeSort?.key === column.key;
                return (
                  <th
                    key={column.key}
                    class={column.numeric ? "numeric" : undefined}
                    aria-sort={
                      active
                        ? activeSort!.direction === "asc"
                          ? "ascending"
                          : "descending"
                        : "none"
                    }
                  >
                    {sortable ? (
                      <button
                        type="button"
                        class="link sm"
                        onClick={() => toggleSort(column.key)}
                      >
                        {column.label}
                        {active &&
                          (activeSort!.direction === "asc" ? (
                            <ArrowUpIcon />
                          ) : (
                            <ArrowDownIcon />
                          ))}
                      </button>
                    ) : (
                      column.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={visibleColumns.length}>
                  <div class="empty">{emptyLabel}</div>
                </td>
              </tr>
            ) : (
              visible.map((row, index) => (
                <tr
                  key={rowKey ? rowKey(row) : index}
                  style={onRowClick ? { cursor: "pointer" } : undefined}
                  onClick={() => onRowClick?.(row)}
                >
                  {visibleColumns.map((column) => (
                    <td
                      key={column.key}
                      class={column.numeric ? "numeric" : undefined}
                    >
                      {column.render
                        ? column.render(row[column.key], row)
                        : (row[column.key] as never)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pageSize > 0 && pageCount > 1 && (
        <div class="row justify-between">
          <small>
            Page {current + 1} of {pageCount}
          </small>
          <div class="row">
            <button
              type="button"
              class="outline sm"
              disabled={current === 0}
              onClick={() => goToPage(current - 1)}
            >
              <ArrowLeftIcon />
              Previous
            </button>
            <button
              type="button"
              class="outline sm"
              disabled={current >= pageCount - 1}
              onClick={() => goToPage(current + 1)}
            >
              Next
              <ArrowRightIcon />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
