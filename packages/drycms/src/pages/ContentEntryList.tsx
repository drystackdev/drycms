import dayjs from "dayjs";
import { useEffect, useMemo, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import type { JSX } from "preact/jsx-runtime";
import { path } from "virtual:drycms/config";
import DataTable, { type DataTableColumn, type SortState } from "../components/DataTable.js";
import { pinnedContentTypeSlugs } from "../components/DryLayout.js";
import { encodePath } from "../components/file-manager-http-source.js";
import { ArrowDownIcon, ArrowLeftIcon, PlusIcon } from "../components/icons.js";
import {
  flattenDisplayColumns,
  flattenQueryableColumns,
  buildEntryFieldTree,
  type QueryableColumn,
} from "../content-types/engine/entry-tree.js";
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

/**
 * Renders one List page cell, dispatching on the column's `fieldType` (plus
 * `fieldName`/`validation.format` for the couple of cases that need finer
 * detail than the type alone gives) - each field type gets the read-only
 * treatment its data shape calls for, instead of one generic stringify.
 */
function renderCell(column: QueryableColumn, value: unknown, row: Row): JSX.Element {
  const config = (column.fieldConfig ?? {}) as Record<string, unknown>;

  // Never a real value client-side (see `entry-codec.ts`'s `MASKED_FIELD_TYPES`)
  // - only whether one is currently set, so this is purely decorative.
  if (column.fieldType === "secretkey") {
    const hasValue = isMaskedValue(value) ? value.hasExisting : !!value;
    if (!hasValue) return <>—</>;
    return (
      <span class="secret-dots" aria-label="Secret key set" title="Secret key set">
        {Array.from({ length: 6 }, (_, index) => (
          <span key={index} />
        ))}
      </span>
    );
  }

  // Always has a value either way (see `field-registry.ts`'s `booleanFieldType`
  // doc), so this branch runs before the shared empty-value check below.
  if (column.fieldType === "boolean") {
    const on = !!value;
    return (
      <span class="row" style={{ gap: "0.375rem" }}>
        <input type="checkbox" role="switch" checked={on} disabled aria-label={on ? "On" : "Off"} />
        <span>{on ? "On" : "Off"}</span>
      </span>
    );
  }

  if (value === null || value === undefined || value === "") return <>—</>;

  // The system `slug` field (`features.slug` - see `system-fields.ts`) always
  // ships paired with a sibling `title` field; a manually `format: "slug"`
  // text field may not have one, so this still degrades to just the slug.
  if (column.fieldType === "text" && (column.fieldName === "slug" || column.validation.format === "slug")) {
    const title = row.title;
    return (
      <span class="stack" style={{ gap: "0.125rem" }}>
        {title !== null && title !== undefined && title !== "" && <span>{String(title)}</span>}
        <small class="hint">{String(value)}</small>
      </span>
    );
  }

  if (column.validation.format === "email") {
    return <span class="badge secondary">{String(value)}</span>;
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
    const src = `${path}/api/storage/${encodePath(String(value))}`;
    return config.isAvatar ? <img class="cell-avatar" src={src} alt="" /> : <img class="cell-image" src={src} alt="" />;
  }

  if (column.fieldType === "select") {
    const values = Array.isArray(value) ? value : [value];
    return (
      <span class="badge outline lg">
        {values.join(", ")}
        <ArrowDownIcon />
      </span>
    );
  }

  if (Array.isArray(value)) return <>{value.join(", ")}</>;
  return <>{String(value)}</>;
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
  const fieldTree = useMemo(() => buildEntryFieldTree(type, allTypes), [type, allTypes]);
  // `displayColumns` is what the table shows (includes a masked `secretkey`
  // placeholder column); `queryableFieldNames` is the narrower subset a
  // sort/search request may actually target - see `entry-tree.ts`'s doc
  // comments on `flattenDisplayColumns`/`flattenQueryableColumns`.
  const displayColumns = useMemo(() => flattenDisplayColumns(fieldTree), [fieldTree]);
  const queryableFieldNames = useMemo(
    () => new Set(flattenQueryableColumns(fieldTree).map((c) => c.fieldName)),
    [fieldTree],
  );
  const defaultVisible = useMemo(() => displayColumns.slice(0, 5).map((c) => c.fieldName), [displayColumns]);

  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<SortState>(null);
  const [search, setSearch] = useState("");
  const [searchableFields, setSearchableFields] = useState<string[]>(
    defaultVisible.filter((key) => queryableFieldNames.has(key)),
  );
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

  const isPinned = pinnedContentTypeSlugs.has(type.name);

  const columns: DataTableColumn<Row>[] = displayColumns.map(
    (column): DataTableColumn<Row> => ({
      key: column.fieldName,
      label: column.label,
      numeric: column.fieldType === "number",
      // `image` is technically queryable (it's a plain TEXT column of file
      // paths), but sorting by that path is meaningless for a thumbnail cell.
      sortable: queryableFieldNames.has(column.fieldName) && column.fieldType !== "image",
      render: (value, row) => renderCell(column, value, row),
    }),
  );

  return (
    <>
      <div class="page-header">
        {!isPinned && (
          <a role="button" href={`${path}/content`} class="icon ghost">
            <ArrowLeftIcon />
          </a>
        )}
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
          defaultVisible,
          onVisibleChange: (visible) => setSearchableFields(visible.filter((key) => queryableFieldNames.has(key))),
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
