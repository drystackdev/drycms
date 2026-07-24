import { useMemo, useState } from "preact/hooks";
import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon
} from "./icons.js";
import type { JSX } from "preact/jsx-runtime";

export interface DataTableColumn<Row> {
  key: string & keyof Row;
  label: string;
  numeric?: boolean;
  sortable?: boolean;
  render?: (value: Row[keyof Row], row: Row) => JSX.Element;
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
}

type SortState = { key: string; direction: "asc" | "desc" } | null;

function toText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return toText(a).localeCompare(toText(b), undefined, { numeric: true });
}

/**
 * Sortable, filterable, paginated table. Renders plain `<table>` markup so the
 * drycms stylesheet does all the styling.
 */
export default function DataTable<Row extends Record<string, unknown>>({
  columns,
  rows,
  pageSize = 10,
  searchable = true,
  searchPlaceholder = "Filter…",
  emptyLabel = "No results.",
}: DataTableProps<Row>) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortState>(null);
  const [page, setPage] = useState(0);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) =>
      columns.some((column) =>
        toText(row[column.key]).toLowerCase().includes(needle),
      ),
    );
  }, [rows, columns, query]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const direction = sort.direction === "asc" ? 1 : -1;
    return [...filtered].sort(
      (a, b) => compare(a[sort.key], b[sort.key]) * direction,
    );
  }, [filtered, sort]);

  const perPage = pageSize > 0 ? pageSize : sorted.length || 1;
  const pageCount = Math.max(1, Math.ceil(sorted.length / perPage));
  const current = Math.min(page, pageCount - 1);
  const visible = sorted.slice(current * perPage, current * perPage + perPage);

  const toggleSort = (key: string) => {
    setPage(0);
    setSort((previous) => {
      if (previous?.key !== key) return { key, direction: "asc" };
      if (previous.direction === "asc") return { key, direction: "desc" };
      return null;
    });
  };

  return (
    <div class="stack">
      {searchable && (
        <div class="row">
          <input
            type="search"
            value={query}
            placeholder={searchPlaceholder}
            aria-label={searchPlaceholder}
            style="max-width: 18rem"
            onInput={(event) => {
              setQuery((event.currentTarget as HTMLInputElement).value);
              setPage(0);
            }}
          />
          <span class="spacer" />
          <small>
            {sorted.length} of {rows.length}
          </small>
        </div>
      )}

      <div class="scroll">
        <table>
          <thead>
            <tr>
              {columns.map((column) => {
                const sortable = column.sortable !== false;
                const active = sort?.key === column.key;
                return (
                  <th
                    key={column.key}
                    class={column.numeric ? "numeric" : undefined}
                    aria-sort={
                      active
                        ? sort.direction === "asc"
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
                          (sort.direction === "asc" ? (
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
                <td colSpan={columns.length}>
                  <div class="empty">{emptyLabel}</div>
                </td>
              </tr>
            ) : (
              visible.map((row, index) => (
                <tr key={index}>
                  {columns.map((column) => (
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
              onClick={() => setPage(current - 1)}
            >
              <ArrowLeftIcon />
              Previous
            </button>
            <button
              type="button"
              class="outline sm"
              disabled={current >= pageCount - 1}
              onClick={() => setPage(current + 1)}
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
