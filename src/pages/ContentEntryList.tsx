import dayjs from "dayjs";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import type { JSX } from "preact/jsx-runtime";
import { contentEngine, path } from "virtual:drycms/config";
import DataTable, { type DataTableColumn, type SortState } from "../components/DataTable.js";
import { pinnedContentTypeSlugs } from "../components/DryLayout.js";
import { encodePath } from "../components/file-manager-http-source.js";
import { ArrowDownIcon, ArrowLeftIcon, ComponentIcon, PlusIcon } from "../components/icons.js";
import { toast } from "../components/Toast.js";
import {
  flattenQueryableColumns,
  buildEntryFieldTree,
  type EntryFieldNode,
  type QueryableColumn,
} from "../content-types/engine/entry-tree.js";
import { createContentEntriesApi, type EntryListResult } from "../content-types/entries-http-api.js";
import type { RelationCardinality } from "../content-types/field-registry.js";
import { createContentTypesApi } from "../content-types/http-api.js";
import type { ContentTypeDefinition } from "../content-types/types.js";
import type { MaskedValue } from "../content-types/engine/entry-codec.js";
import { useFetch } from "../hooks/useFetch.js";
import ContentEntryEditor from "./ContentEntryEditor.js";
import { useDocumentTitle } from "./page-common.js";

interface Props {
  typeSlug: string;
}

interface Row extends Record<string, unknown> {
  id: string;
}

const DEFAULT_PAGE_SIZE = 10;

/**
 * Not a real page size - just large enough that a typical collection's
 * entries all come back in one request when `useClientSearch` is true.
 */
const CLIENT_SEARCH_FETCH_ALL_SIZE = 10_000;

function isMaskedValue(value: unknown): value is MaskedValue {
  return typeof value === "object" && value !== null && "hasExisting" in (value as Record<string, unknown>);
}

/** Flattens a nested `flatten`-component entry value (e.g. `{ seo: { metaTitle:
 * ... } }`, see `FieldRenderer.tsx`'s `flatten` case) into the same dotted-path
 * keys `collectListCells` gives those fields' columns (e.g. `"seo.metaTitle"`,
 * matching `entry-tree.ts`'s `flattenDisplayColumns` convention) - `DataTable`
 * looks values up by a flat `row[column.key]`, so nested values need this
 * before they're usable as row data. Only descends into plain objects: arrays
 * (relation id lists, repeatable-component rows, neither of which get a
 * dotted-path column here) and other value types are left as-is. */
function flattenRowValue(value: Record<string, unknown>, prefix = ""): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    const fieldName = prefix ? `${prefix}.${key}` : key;
    if (val !== null && typeof val === "object" && !Array.isArray(val) && !isMaskedValue(val)) {
      Object.assign(out, flattenRowValue(val as Record<string, unknown>, fieldName));
    } else {
      out[fieldName] = val;
    }
  }
  return out;
}

/**
 * Renders one List page cell, dispatching on the column's `fieldType` (plus
 * `fieldName`/`validation.format` for the couple of cases that need finer
 * detail than the type alone gives) - each field type gets the read-only
 * treatment its data shape calls for, instead of one generic stringify.
 */
function renderCell(column: QueryableColumn, value: unknown, row: Row): JSX.Element {
  const config = (column.fieldConfig ?? {}) as Record<string, unknown>;

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

  if (value === null || value === undefined || value === "") return <small><i>No value</i></small>;

  // The system `slug` field (`features.slug` - see `system-fields.ts`) always
  // ships paired with a sibling `title` field; a manually `format: "slug"`
  // text field may not have one, so this still degrades to just the slug.
  if (column.fieldType === "text" && (column.fieldName === "slug" || column.validation.format === "slug")) {
    return (
      <small class="hint">{String(value)}</small>
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
    // `config.multiple` stores a comma-joined id list (see `field-registry.ts`'s
    // `imageFieldType`), deserialized to a plain array by the time it gets here -
    // a bare non-multiple value renders identically to before via the 1-item array.
    const ids = Array.isArray(value) ? value : [value];
    const cellClass = config.isAvatar ? "cell-avatar" : "cell-image";
    const shown = ids.slice(0, 3);
    return (
      <span class="row" style={{ gap: "0.375rem" }}>
        {shown.map((id) => (
          <img key={String(id)} class={cellClass} src={`${path}/api/storage/${encodePath(String(id))}`} alt="" />
        ))}
        {ids.length > shown.length && <small class="hint">+{ids.length - shown.length}</small>}
      </span>
    );
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

interface RelationColumn {
  fieldName: string;
  label: string;
  targetTypeId: string;
  cardinality: RelationCardinality;
}

type ListCell = { kind: "field"; column: QueryableColumn } | { kind: "relation"; column: RelationColumn };

/** Mirrors `entry-tree.ts`'s own `UNDISPLAYABLE_FIELD_TYPES` (kept private
 * there) - `password` and `secretkey` never round-trip a real value to the
 * client (see `entry-codec.ts`'s `MASKED_FIELD_TYPES`), so neither is worth
 * a List column, even masked. */
const UNDISPLAYABLE_FIELD_TYPES = new Set(["password", "secretkey"]);

/**
 * A List page's own walk of the entry field tree - unlike `entry-tree.ts`'s
 * `flattenDisplayColumns` (`column`/`flatten` kinds only), this ALSO keeps
 * `relation` nodes of every cardinality, in the same true schema order they'd
 * appear in the entry editor. Kept local rather than folded into
 * `entry-tree.ts` itself: that file is mid-flight on the `relationmirror`
 * feature elsewhere in the repo, and this walk doesn't need touching it -
 * `relation-mirror`/`component-repeat` nodes are silently skipped, same as
 * `flattenDisplayColumns` already does.
 */
function collectListCells(nodes: EntryFieldNode[], pathPrefix = "", labelPrefix = ""): ListCell[] {
  const out: ListCell[] = [];
  for (const node of nodes) {
    const fieldName = pathPrefix ? `${pathPrefix}.${node.fieldName}` : node.fieldName;
    const label = labelPrefix ? `${labelPrefix} / ${node.label}` : node.label;
    if (node.kind === "column") {
      if (UNDISPLAYABLE_FIELD_TYPES.has(node.fieldType)) continue;
      out.push({
        kind: "field",
        column: {
          fieldName,
          columnName: node.columnName,
          label,
          fieldType: node.fieldType,
          fieldConfig: node.fieldConfig,
          validation: node.validation,
        },
      });
    } else if (node.kind === "flatten") {
      out.push(...collectListCells(node.children, fieldName, label));
    } else if (node.kind === "relation") {
      out.push({ kind: "relation", column: { fieldName, label, targetTypeId: node.targetTypeId, cardinality: node.cardinality } });
    }
  }
  return out;
}

/**
 * `manyToOne`'s target id rides along as a plain value on the row itself
 * (see `entry-codec.ts`'s `rowToValue`) - `ids` arrives already resolved,
 * either `[]` or `[thatId]`. `oneToMany`/`manyToMany` need a per-row fetch
 * instead (`listEntries` doesn't run the child-table query a paginated List
 * page would need) - `ids` is `undefined` while that fetch is still in
 * flight, so this can tell "not loaded yet" apart from "genuinely none".
 * No icon in `icons.tsx` reads as "relation" specifically - `ComponentIcon`
 * (already used for the schema editor's Component field type) doubles as a
 * generic "structured/linked data" marker here too.
 */
function renderRelationCell(ids: string[] | undefined, lookupLabel: (id: string) => string | undefined): JSX.Element {
  if (ids === undefined) return <>…</>;
  if (ids.length === 0) return <>—</>;
  return (
    <span class="badge lg info">
      <ComponentIcon />
      {ids.map((id) => lookupLabel(id) ?? "…").join(", ")}
    </span>
  );
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
  const isSortable = !!type.features?.sortable;
  // `engine: "file"`'s `listEntries` re-scans every record on each call (see
  // `entries-file.ts`) rather than running a SQL query, so round-tripping
  // search/sort/pagination per keystroke would re-scan the whole collection
  // repeatedly - rows are fetched once instead and `DataTable`'s existing
  // fully-client-side mode (triggered below by omitting `serverQuery`) does
  // search/sort/pagination in memory. A `sortable` collection needs the same
  // "fetch everything up front" treatment regardless of engine: dragging a
  // row only makes sense against the WHOLE order, never just the current
  // page/search-filtered slice.
  const useClientSearch = contentEngine === "file" || isSortable;
  const fieldTree = useMemo(() => buildEntryFieldTree(type, allTypes), [type, allTypes]);
  // `queryableFieldNames` is the subset a sort/search request may actually
  // target - see `entry-tree.ts`'s doc comments on `flattenQueryableColumns`.
  const queryableFieldNames = useMemo(
    () => new Set(flattenQueryableColumns(fieldTree).map((c) => c.fieldName)),
    [fieldTree],
  );
  // `listCells` is what the table shows, in true schema order - plain
  // columns interleaved with relation columns of every cardinality, unlike
  // `entry-tree.ts`'s own `flattenDisplayColumns` (which only has the former).
  const listCells = useMemo(() => collectListCells(fieldTree), [fieldTree]);
  const relationColumns = useMemo(() => listCells.filter((c) => c.kind === "relation").map((c) => c.column), [listCells]);
  const defaultVisible = useMemo(() => listCells.slice(0, 5).map((c) => c.column.fieldName), [listCells]);
  // One `entriesApi`/label field per relation column's target type - reused
  // across every row instead of rebuilt per cell.
  const relationTargets = useMemo(() => {
    const map = new Map<string, { entriesApi: ReturnType<typeof createContentEntriesApi>; labelField?: string }>();
    for (const column of relationColumns) {
      const targetType = allTypes.find((t) => t.id === column.targetTypeId);
      if (!targetType) continue;
      map.set(column.fieldName, {
        entriesApi: createContentEntriesApi(`${path}/api/content`, targetType.name),
        labelField: flattenQueryableColumns(buildEntryFieldTree(targetType, allTypes))[0]?.fieldName,
      });
    }
    return map;
  }, [relationColumns, allTypes]);

  const [page, setPage] = useState(0);
  const [sort, setSort] = useState<SortState>(null);
  const [search, setSearch] = useState("");
  const [searchableFields, setSearchableFields] = useState<string[]>(
    defaultVisible.filter((key) => queryableFieldNames.has(key)),
  );
  const [visibleKeys, setVisibleKeys] = useState<string[]>(defaultVisible);

  // Cache key must cover everything that affects the response (mục 24) - the
  // `useClientSearch` mode always fetches the same unfiltered/unpaginated
  // query, so it gets one fixed key; the server-query mode's key mirrors
  // every param the query below actually sends.
  const listCacheKey = useClientSearch
    ? `entries:${type.name}:all`
    : `entries:${type.name}:list:${page}:${sort?.key ?? ""}:${sort?.direction ?? ""}:${search}:${searchableFields.join(",")}`;
  const listFetcher = useCallback(
    (ifVersion: number | undefined, signal: AbortSignal) =>
      entriesApi.listVersioned(
        // See `useClientSearch` above - `engine: "file"`/`sortable` fetch
        // once, unfiltered/unpaginated, and let `DataTable`'s own
        // client-side mode (triggered below by omitting `serverQuery`) do
        // the rest in memory. A `sortable` collection additionally requests
        // `sortIndex asc` explicitly - no engine defaults to that order on
        // its own (see `entries-sqlite.ts`/`entries-d1.ts`/`entries-file.ts`'s
        // shared "no `sortField` -> id desc" fallback), so without this the
        // drag list would start in an arbitrary, not-yet-dragged order.
        useClientSearch
          ? {
              page: 0,
              pageSize: CLIENT_SEARCH_FETCH_ALL_SIZE,
              ...(isSortable ? { sortField: "sortIndex", sortDir: "asc" as const } : {}),
            }
          : { page, pageSize: DEFAULT_PAGE_SIZE, sortField: sort?.key, sortDir: sort?.direction, search: search || undefined, searchableFields },
        ifVersion,
        signal,
      ),
    [entriesApi, page, sort, search, searchableFields, isSortable],
  );
  const { data: listData, loading, error: listError, reload } = useFetch<EntryListResult>(listCacheKey, listFetcher);
  const rows: Row[] = useMemo(() => (listData?.rows ?? []).map((r) => ({ id: r.id, ...flattenRowValue(r.value) })), [listData]);
  const total = listData?.total ?? 0;
  const loadError = listError ? (listError instanceof Error ? listError.message : "Failed to load entries.") : null;

  // The in-progress drag order, pending a Save - `null` means "unchanged
  // from the fetched order". Reset whenever a fresh `rows` lands (initial
  // load, or the `reload()` a successful Save triggers below): `rows` only
  // ever changes via a version-bumped refetch (see `useFetch`'s data-version
  // protocol), never spontaneously mid-drag, so this can't clobber unsaved
  // work.
  const [dragOrder, setDragOrder] = useState<Row[] | null>(null);
  useEffect(() => setDragOrder(null), [rows]);
  const [savingOrder, setSavingOrder] = useState(false);
  const displayRows = isSortable ? (dragOrder ?? rows) : rows;

  async function handleSaveOrder() {
    if (!dragOrder) return;
    setSavingOrder(true);
    try {
      await entriesApi.reorder(dragOrder.map((row, index) => ({ id: row.id, sortIndex: index })));
      await reload();
      toast.add({ type: "success", title: "Order saved." });
    } catch (error) {
      toast.add({
        type: "error",
        title: "Failed to save the new order.",
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setSavingOrder(false);
    }
  }

  // fieldName -> target id -> resolved label. Only fetched for relation
  // columns the user actually has visible (`visibleKeys`) - `entriesApi.get`
  // is one request per distinct id, not worth paying for a hidden column.
  const [relationLabels, setRelationLabels] = useState<Record<string, Record<string, string>>>({});
  // row id -> fieldName -> resolved target ids, for `oneToMany`/`manyToMany`
  // relation columns only - `manyToOne`'s id is already on the row itself,
  // no need for this extra step (see `renderRelationCell`'s doc).
  const [rowRelationValues, setRowRelationValues] = useState<Record<string, Record<string, string[]>>>({});

  // Populates `rowRelationValues`: one `entriesApi.get(row.id)` per row still
  // missing a visible multi-cardinality column's value - `listEntries` (the
  // paginated query `rows` came from) doesn't run the child-table query a
  // `oneToMany`/`manyToMany` value needs, but the single-entry `get` already
  // does (see `entries-sqlite.ts`'s `populateChildFields`), so this reuses
  // that instead of touching the paginated query itself.
  useEffect(() => {
    let cancelled = false;
    const multiColumns = relationColumns.filter((c) => c.cardinality !== "manyToOne" && visibleKeys.includes(c.fieldName));
    if (multiColumns.length === 0) return;
    const missingRows = rows.filter((row) => multiColumns.some((c) => rowRelationValues[row.id]?.[c.fieldName] === undefined));
    if (missingRows.length === 0) return;
    Promise.all(
      missingRows.map((row) =>
        entriesApi
          .get(row.id)
          .then((entry): [string, Record<string, string[]>] => [
            row.id,
            Object.fromEntries(multiColumns.map((c) => [c.fieldName, (entry.value[c.fieldName] as string[] | undefined) ?? []])),
          ])
          .catch((): [string, Record<string, string[]>] => [row.id, Object.fromEntries(multiColumns.map((c) => [c.fieldName, []]))]),
      ),
    ).then((pairs) => {
      if (cancelled) return;
      setRowRelationValues((current) => {
        const next = { ...current };
        for (const [rowId, values] of pairs) next[rowId] = { ...next[rowId], ...values };
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `rowRelationValues` deliberately excluded: read only to skip rows already resolved, not to retrigger this effect.
  }, [rows, relationColumns, visibleKeys, entriesApi]);

  useEffect(() => {
    let cancelled = false;
    const idsForRow = (column: RelationColumn, row: Row): string[] => {
      if (column.cardinality === "manyToOne") {
        const value = row[column.fieldName];
        return typeof value === "string" && value !== "" ? [value] : [];
      }
      return rowRelationValues[row.id]?.[column.fieldName] ?? [];
    };
    for (const column of relationColumns) {
      if (!visibleKeys.includes(column.fieldName)) continue;
      const target = relationTargets.get(column.fieldName);
      if (!target) continue;
      const known = relationLabels[column.fieldName] ?? {};
      const ids = [...new Set(rows.flatMap((row) => idsForRow(column, row)).filter((id) => !(id in known)))];
      if (ids.length === 0) continue;
      Promise.all(
        ids.map((id) =>
          target.entriesApi
            .get(id)
            .then((entry): [string, string] => [id, target.labelField ? String(entry.value[target.labelField] ?? id) : id])
            .catch((): [string, string] => [id, id]),
        ),
      ).then((pairs) => {
        if (cancelled) return;
        setRelationLabels((current) => ({
          ...current,
          [column.fieldName]: { ...current[column.fieldName], ...Object.fromEntries(pairs) },
        }));
      });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `relationLabels` deliberately excluded: it's read to skip refetching, not to retrigger this effect (that update comes back through `rows`/`rowRelationValues`/`visibleKeys` instead).
  }, [rows, relationColumns, relationTargets, visibleKeys, rowRelationValues]);

  const isPinned = pinnedContentTypeSlugs.has(type.name);

  const columns: DataTableColumn<Row>[] = listCells.map((cell): DataTableColumn<Row> => {
    if (cell.kind === "field") {
      const column = cell.column;
      return {
        key: column.fieldName,
        label: column.label,
        numeric: column.fieldType === "number",
        // `image` is technically queryable (it's a plain TEXT column of file
        // paths), but sorting by that path is meaningless for a thumbnail cell.
        sortable: queryableFieldNames.has(column.fieldName) && column.fieldType !== "image",
        render: (value, row) => renderCell(column, value, row),
      };
    }
    const column = cell.column;
    return {
      key: column.fieldName,
      label: column.label,
      sortable: false,
      render: (value, row) => {
        const ids =
          column.cardinality === "manyToOne"
            ? typeof value === "string" && value !== ""
              ? [value]
              : []
            : rowRelationValues[row.id]?.[column.fieldName];
        return renderRelationCell(ids, (id) => relationLabels[column.fieldName]?.[id]);
      },
    };
  });

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
      {/* See `useClientSearch` above - `serverQuery` below carries its own
          `loading` readout, which this mode doesn't use. */}
      {useClientSearch && loading && <span class="hint">Loading…</span>}

      <DataTable
        columns={columns}
        rows={displayRows}
        rowKey={(row) => row.id}
        emptyLabel="No entries yet."
        // Search stays available even when `features.sortable` (see
        // `dragReorder` below) - `DataTable` itself auto-disables dragging
        // while the search box has text, since a filtered view has no
        // single well-defined drag order to save.
        pageSize={isSortable ? 0 : undefined}
        onRowClick={(row) => route(`${path}/content/${type.name}/${row.id}`)}
        columnToggle={{
          storageKey: `contentList:${type.name}:columns`,
          defaultVisible,
          onVisibleChange: (visible) => {
            setSearchableFields(visible.filter((key) => queryableFieldNames.has(key)));
            setVisibleKeys(visible);
          },
        }}
        // See `useClientSearch` above - omitting `serverQuery` drops
        // `DataTable` into its existing fully-client-side search/sort/
        // paginate mode.
        serverQuery={
          useClientSearch
            ? undefined
            : {
                total,
                page,
                onPageChange: setPage,
                sort,
                onSortChange: setSort,
                onSearchChange: setSearch,
                loading,
              }
        }
        dragReorder={
          isSortable
            ? { getId: (row) => row.id, onReorder: setDragOrder, disabled: savingOrder }
            : undefined
        }
        actions={
          <>
            {isSortable && dragOrder && (
              <button type="button" class="outline" disabled={savingOrder} aria-busy={savingOrder} onClick={handleSaveOrder}>
                Save order
              </button>
            )}
            <button type="button" onClick={() => route(`${path}/content/${type.name}/new`)}>
              <PlusIcon /> Add
            </button>
          </>
        }
      />
    </>
  );
}
