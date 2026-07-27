import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { path } from "virtual:drycms/config";
import DataTable, { type DataTableColumn, type SortState } from "../components/DataTable.js";
import { ArrowLeftIcon, PlusIcon } from "../components/icons.js";
import { flattenQueryableColumns, buildEntryFieldTree } from "../content-types/engine/entry-tree.js";
import { createContentEntriesApi } from "../content-types/entries-http-api.js";
import { createContentTypesApi } from "../content-types/http-api.js";
import type { ContentTypeDefinition } from "../content-types/types.js";
import type { MaskedValue } from "../content-types/engine/entry-codec.js";
import ContentEntryEditor from "./ContentEntryEditor.js";
import { useDocumentTitle } from "./page-common.js";

interface Props {
  typeSlug: string;
}

interface Row extends Record<string, unknown> {
  id: string;
}

const DEFAULT_PAGE_SIZE = 10;

function isMaskedValue(value: unknown): value is MaskedValue {
  return typeof value === "object" && value !== null && "hasExisting" in (value as Record<string, unknown>);
}

function renderCellValue(fieldType: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (isMaskedValue(value)) return value.hasExisting ? "••••••••" : "—";
  if (fieldType === "boolean") return value ? "Yes" : "No";
  if (fieldType === "date") {
    const parsed = dayjs(value as string);
    return parsed.isValid() ? parsed.format("YYYY-MM-DD HH:mm") : String(value);
  }
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

export default function ContentEntryList({ typeSlug }: Props) {
  const { route } = useLocation();
  const typesApi = useMemo(() => createContentTypesApi(`${path}/api/content-types`), []);

  const [allTypes, setAllTypes] = useState<ContentTypeDefinition[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    typesApi
      .list()
      .then(setAllTypes)
      .catch((error) => setLoadError(error instanceof Error ? error.message : "Failed to load content types."));
  }, [typesApi]);

  const type = allTypes?.find((t) => t.name === typeSlug && t.kind !== "component");

  useDocumentTitle(type ? `${type.label} entries` : "Content");

  if (loadError) return <span class="error">{loadError}</span>;
  if (allTypes === null) return <span class="hint">Loading…</span>;
  if (!type) return <span class="error">Content type "{typeSlug}" not found.</span>;

  // A singleton has at most one row - there's nothing to list, so this route
  // renders the entry editor directly instead of a DataTable.
  if (type.kind === "singleton") {
    return <ContentEntryEditor typeSlug={typeSlug} />;
  }

  return <ContentEntryListCollection type={type} allTypes={allTypes} route={route} />;
}

function ContentEntryListCollection({
  type,
  allTypes,
  route,
}: {
  type: ContentTypeDefinition;
  allTypes: ContentTypeDefinition[];
  route: (path: string) => void;
}) {
  const entriesApi = useMemo(() => createContentEntriesApi(`${path}/api/content`, type.name), [type.name]);
  const queryableColumns = useMemo(() => flattenQueryableColumns(buildEntryFieldTree(type, allTypes)), [type, allTypes]);

  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<SortState>(null);
  const [search, setSearch] = useState("");
  const [searchableFields, setSearchableFields] = useState<string[]>(queryableColumns.slice(0, 5).map((c) => c.fieldName));
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    entriesApi
      .list({
        page,
        pageSize: DEFAULT_PAGE_SIZE,
        sortField: sort?.key,
        sortDir: sort?.direction,
        search: search || undefined,
        searchableFields,
      })
      .then((result) => {
        if (cancelled) return;
        setRows(result.rows.map((r) => ({ id: r.id, ...r.value })));
        setTotal(result.total);
        setLoadError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setLoadError(error instanceof Error ? error.message : "Failed to load entries.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entriesApi, page, sort, search, searchableFields]);

  const columns: DataTableColumn<Row>[] = [
    { key: "id", label: "ID", sortable: false },
    ...queryableColumns.map(
      (column): DataTableColumn<Row> => ({
        key: column.fieldName,
        label: column.label,
        numeric: column.fieldType === "number",
        render: (value) => <>{renderCellValue(column.fieldType, value)}</>,
      }),
    ),
  ];

  return (
    <>
      <div class="page-header">
        <a role="button" href={`${path}/content`} class="icon ghost">
          <ArrowLeftIcon />
        </a>
        <div style={{ flex: 1 }}>
          <h1>{type.label}</h1>
          <p>{type.description || "Entries in this collection."}</p>
        </div>
      </div>

      {loadError && <span class="error">{loadError}</span>}

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        emptyLabel="No entries yet."
        onRowClick={(row) => route(`${path}/content/${type.name}/${row.id}`)}
        columnToggle={{
          storageKey: `contentList:${type.name}:columns`,
          defaultVisible: queryableColumns.slice(0, 5).map((c) => c.fieldName),
          onVisibleChange: (visible) => setSearchableFields(visible.filter((k) => k !== "id")),
        }}
        serverQuery={{
          total,
          page,
          onPageChange: setPage,
          sort,
          onSortChange: setSort,
          onSearchChange: setSearch,
          loading,
        }}
        actions={
          <button type="button" onClick={() => route(`${path}/content/${type.name}/new`)}>
            <PlusIcon /> Add
          </button>
        }
      />
    </>
  );
}
