import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import type { JSX } from "preact/jsx-runtime";
const { path } = window.__DRY_CONFIG__;
import DataTable, {
  type DataTableColumn,
  type SortState,
} from "../components/DataTable.js";
import { pinnedContentTypeSlugs } from "../components/DryLayout.js";
import { renderEntryCellValue } from "../components/EntryCellValue.js";
import EntrySummaryLines from "../components/EntrySummaryLines.js";
import RichTextPreviewDialog from "../components/RichTextPreviewDialog.js";
import {
  ArrowLeftIcon,
  ComponentIcon,
  PlusIcon,
} from "../components/icons/index.js";
import { toast } from "../components/Toast.js";
import {
  flattenQueryableColumns,
  buildEntryFieldTree,
  type EntryFieldNode,
  type QueryableColumn,
} from "../content-types/engine/entry-tree.js";
import { buildEntrySummary, type ResolveRelation, type SummaryLine } from "../content-types/engine/entry-summary.js";
import {
  createContentEntriesApi,
  type EntryListResult,
} from "../content-types/entries-http-api.js";
import type { RelationCardinality } from "../content-types/field-registry.js";
import { createContentTypesApi } from "../content-types/http-api.js";
import { hasEntryDraft } from "../content-types/entry-draft-store.js";
import { canAccess } from "../store/auth.js";
import type { ContentTypeDefinition } from "../content-types/types.js";
import type { MaskedValue } from "../content-types/engine/entry-codec.js";
import { useFetch } from "../hooks/useFetch.js";
import { useDelayedLoading } from "../hooks/useDelayedLoading.js";
import ContentEntryEditor from "./ContentEntryEditor.js";
import { useDocumentTitle } from "./page-common.js";

interface Props {
  typeSlug: string;
}

interface Row extends Record<string, unknown> {
  id: string;
}

const DEFAULT_PAGE_SIZE = 5;
const PAGE_SIZE_OPTIONS = [5, 10, 15];

/**
 * Not a real page size - just large enough that a typical collection's
 * entries all come back in one request when `useClientSearch` is true.
 */
const CLIENT_SEARCH_FETCH_ALL_SIZE = 10_000;

function isMaskedValue(value: unknown): value is MaskedValue {
  return (
    typeof value === "object" &&
    value !== null &&
    "hasExisting" in (value as Record<string, unknown>)
  );
}

/** Flattens a nested `flatten`-component entry value (e.g. `{ seo: { metaTitle:
 * ... } }`, see `FieldRenderer.tsx`'s `flatten` case) into the same dotted-path
 * keys `collectListCells` gives those fields' columns (e.g. `"seo.metaTitle"`,
 * matching `entry-tree.ts`'s `flattenDisplayColumns` convention) - `DataTable`
 * looks values up by a flat `row[column.key]`, so nested values need this
 * before they're usable as row data. Only descends into plain objects: arrays
 * (relation id lists, repeatable-component rows, neither of which get a
 * dotted-path column here) and other value types are left as-is. */
function flattenRowValue(
  value: Record<string, unknown>,
  prefix = "",
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    const fieldName = prefix ? `${prefix}.${key}` : key;
    if (
      val !== null &&
      typeof val === "object" &&
      !Array.isArray(val) &&
      !isMaskedValue(val)
    ) {
      Object.assign(
        out,
        flattenRowValue(val as Record<string, unknown>, fieldName),
      );
    } else {
      out[fieldName] = val;
    }
  }
  return out;
}

interface RelationColumn {
  fieldName: string;
  label: string;
  targetTypeId: string;
  cardinality: RelationCardinality;
  /** From `RelationFieldConfig.displayFields` - see `entry-summary.ts`'s
   * `buildEntrySummary`, which resolves this (falling back to the target's
   * first displayable field when unset) for each linked entry's summary. */
  displayFields?: string[];
}

type ListCell =
  | { kind: "field"; column: QueryableColumn }
  | { kind: "relation"; column: RelationColumn };

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
function collectListCells(
  nodes: EntryFieldNode[],
  pathPrefix = "",
  labelPrefix = "",
): ListCell[] {
  const out: ListCell[] = [];
  for (const node of nodes) {
    const fieldName = pathPrefix
      ? `${pathPrefix}.${node.fieldName}`
      : node.fieldName;
    const label = labelPrefix ? `${labelPrefix} / ${node.label}` : node.label;
    if (node.kind === "column") {
      if (UNDISPLAYABLE_FIELD_TYPES.has(node.fieldType)) continue;
      out.push({
        kind: "field",
        column: {
          fieldId: node.fieldId,
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
      out.push({
        kind: "relation",
        column: {
          fieldName,
          label,
          targetTypeId: node.targetTypeId,
          cardinality: node.cardinality,
          displayFields: node.displayFields,
        },
      });
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
 * Each linked entry renders via `EntrySummaryLines` (`entry-summary.ts`'s
 * `buildEntrySummary` output, one "Label: value" line per configured
 * `RelationFieldConfig.displayFields`) instead of a single-label badge -
 * still capped to the first 2 (`shown`) + a "+N more" remainder so a
 * multi-valued cell with several display lines each can't blow up the row's
 * height.
 */
function renderRelationCell(
  ids: string[] | undefined,
  lookupSummary: (id: string) => SummaryLine[] | undefined,
  multiple: boolean,
): JSX.Element {
  if (ids === undefined) return <>…</>;
  if (ids.length === 0) return <>-</>;
  const shown = multiple ? ids.slice(0, 2) : ids;
  const remaining = ids.length - shown.length;
  return (
    <div class="entry-summary-relation-cell">
      {shown.map((id) => {
        const lines = lookupSummary(id);
        return (
          <div key={id} class="entry-summary-relation-item">
            <ComponentIcon />
            {lines ? <EntrySummaryLines lines={lines} /> : <span class="hint">…</span>}
          </div>
        );
      })}
      {remaining > 0 && <span class="badge sm outline">+{remaining}</span>}
    </div>
  );
}

export default function ContentEntryList({ typeSlug }: Props) {
  const { route } = useLocation();
  const typesApi = useMemo(
    () => createContentTypesApi(`${path}/api/content-types`),
    [],
  );

  const [allTypes, setAllTypes] = useState<ContentTypeDefinition[] | null>(
    null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    typesApi
      .list()
      .then(setAllTypes)
      .catch((error) =>
        setLoadError(
          error instanceof Error
            ? error.message
            : "Failed to load content types.",
        ),
      );
  }, [typesApi]);

  const type = allTypes?.find(
    (t) => t.name === typeSlug && t.kind !== "component",
  );
  const showTypeLoading = useDelayedLoading(allTypes === null);

  useDocumentTitle(type ? `${type.label} entries` : "Content");

  if (loadError) return <span class="error">{loadError}</span>;
  if (allTypes === null)
    return showTypeLoading ? <span class="hint">Loading…</span> : null;
  if (!type)
    return <span class="error">Content type "{typeSlug}" not found.</span>;

  const readAction = type.kind === "singleton" ? "setting" : "view";
  if (!canAccess(type.id, readAction))
    return (
      <span class="error">You don't have permission to view this content.</span>
    );

  // A singleton has at most one row - there's nothing to list, so this route
  // renders the entry editor directly instead of a DataTable.
  if (type.kind === "singleton") {
    return <ContentEntryEditor typeSlug={typeSlug} />;
  }

  // Keyed by `type.name` - client-side navigation between two different
  // content types' list pages doesn't unmount `ContentEntryList` itself (the
  // matched route component stays the same), so without this key every
  // per-type hook state below (DataTable's `useStore` column visibility,
  // search/sort/page) would keep stale values from the PREVIOUS type
  // instead of resetting - e.g. `visibleKeys` holding field names that don't
  // exist on the new type, filtering the table down to zero columns.
  return (
    <ContentEntryListCollection
      key={type.name}
      type={type}
      allTypes={allTypes}
      route={route}
    />
  );
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
  const entriesApi = useMemo(
    () => createContentEntriesApi(`${path}/api/content`, type.name),
    [type.name],
  );
  const isSortable = !!type.features?.sortable;
  const canCreate = canAccess(type.id, "create");
  const canUpdate = canAccess(type.id, "update");
  // A `sortable` collection needs "fetch everything up front" treatment:
  // dragging a row only makes sense against the WHOLE order, never just the
  // current page/search-filtered slice, so rows are fetched once and
  // `DataTable`'s fully-client-side mode (triggered below by omitting
  // `serverQuery`) does search/sort/pagination in memory instead.
  const useClientSearch = isSortable;
  const fieldTree = useMemo(
    () => buildEntryFieldTree(type, allTypes),
    [type, allTypes],
  );
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
  const relationColumns = useMemo(
    () => listCells.filter((c) => c.kind === "relation").map((c) => c.column),
    [listCells],
  );
  const defaultVisible = useMemo(
    () => listCells.slice(0, 5).map((c) => c.column.fieldName),
    [listCells],
  );
  // One `entriesApi`/field tree per relation column's target type - reused
  // across every row instead of rebuilt per cell. The field tree feeds
  // `buildEntrySummary` (resolving `column.displayFields` against it).
  const relationTargets = useMemo(() => {
    const map = new Map<
      string,
      {
        entriesApi: ReturnType<typeof createContentEntriesApi>;
        targetFieldNodes: EntryFieldNode[];
      }
    >();
    for (const column of relationColumns) {
      const targetType = allTypes.find((t) => t.id === column.targetTypeId);
      if (!targetType) continue;
      map.set(column.fieldName, {
        entriesApi: createContentEntriesApi(
          `${path}/api/content`,
          targetType.name,
        ),
        targetFieldNodes: buildEntryFieldTree(targetType, allTypes),
      });
    }
    return map;
  }, [relationColumns, allTypes]);

  // Fetches one related entry's own value by target type id - the injected
  // `resolveRelation` `buildEntrySummary` uses to recurse into a chosen
  // `displayFields` entry that is itself a nested `relation` (same pattern
  // `FieldRenderer.tsx`'s `useResolveRelation` uses for the entry editor).
  const resolveRelation: ResolveRelation = useCallback(
    async (targetTypeId, id) => {
      const targetType = allTypes.find((t) => t.id === targetTypeId);
      if (!targetType) return undefined;
      try {
        const entry = await createContentEntriesApi(`${path}/api/content`, targetType.name).get(id);
        return entry.value;
      } catch {
        return undefined;
      }
    },
    [allTypes],
  );

  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
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
    : `entries:${type.name}:list:${page}:${pageSize}:${sort?.key ?? ""}:${sort?.direction ?? ""}:${search}:${searchableFields.join(",")}`;
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
              ...(isSortable
                ? { sortField: "sortIndex", sortDir: "asc" as const }
                : {}),
            }
          : {
              page,
              pageSize,
              sortField: sort?.key,
              sortDir: sort?.direction,
              search: search || undefined,
              searchableFields,
            },
        ifVersion,
        signal,
      ),
    [entriesApi, page, pageSize, sort, search, searchableFields, isSortable],
  );
  const {
    data: listData,
    loading,
    error: listError,
    reload,
  } = useFetch<EntryListResult>(listCacheKey, listFetcher);
  const showListLoading = useDelayedLoading(loading);
  const rows: Row[] = useMemo(
    () =>
      (listData?.rows ?? []).map((r) => ({
        id: r.id,
        ...flattenRowValue(r.value),
      })),
    [listData],
  );
  const total = listData?.total ?? 0;
  const loadError = listError
    ? listError instanceof Error
      ? listError.message
      : "Failed to load entries."
    : null;

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
      await entriesApi.reorder(
        dragOrder.map((row, index) => ({ id: row.id, sortIndex: index })),
      );
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

  // fieldName -> target id -> resolved summary lines. Only fetched for
  // relation columns the user actually has visible (`visibleKeys`) -
  // `entriesApi.get` is one request per distinct id, not worth paying for a
  // hidden column.
  const [relationSummaries, setRelationSummaries] = useState<
    Record<string, Record<string, SummaryLine[]>>
  >({});
  // row id -> fieldName -> resolved target ids, for `oneToMany`/`manyToMany`
  // relation columns only - `manyToOne`'s id is already on the row itself,
  // no need for this extra step (see `renderRelationCell`'s doc).
  const [rowRelationValues, setRowRelationValues] = useState<
    Record<string, Record<string, string[]>>
  >({});

  // Block-level richtext cells open this instead of rendering their HTML inline
  // (see `renderCell`'s `richtext` branch) - one shared dialog rather than one
  // per cell, populated on click.
  const [richTextPreview, setRichTextPreview] = useState<{
    label: string;
    html: string;
  } | null>(null);

  // Populates `rowRelationValues`: one `entriesApi.get(row.id)` per row still
  // missing a visible multi-cardinality column's value - `listEntries` (the
  // paginated query `rows` came from) doesn't run the child-table query a
  // `oneToMany`/`manyToMany` value needs, but the single-entry `get` already
  // does (see `entries-sqlite.ts`'s `populateChildFields`), so this reuses
  // that instead of touching the paginated query itself.
  useEffect(() => {
    let cancelled = false;
    const multiColumns = relationColumns.filter(
      (c) => c.cardinality !== "manyToOne" && visibleKeys.includes(c.fieldName),
    );
    if (multiColumns.length === 0) return;
    const missingRows = rows.filter((row) =>
      multiColumns.some(
        (c) => rowRelationValues[row.id]?.[c.fieldName] === undefined,
      ),
    );
    if (missingRows.length === 0) return;
    Promise.all(
      missingRows.map((row) =>
        entriesApi
          .get(row.id)
          .then((entry): [string, Record<string, string[]>] => [
            row.id,
            Object.fromEntries(
              multiColumns.map((c) => [
                c.fieldName,
                (entry.value[c.fieldName] as string[] | undefined) ?? [],
              ]),
            ),
          ])
          .catch((): [string, Record<string, string[]>] => [
            row.id,
            Object.fromEntries(multiColumns.map((c) => [c.fieldName, []])),
          ]),
      ),
    ).then((pairs) => {
      if (cancelled) return;
      setRowRelationValues((current) => {
        const next = { ...current };
        for (const [rowId, values] of pairs)
          next[rowId] = { ...next[rowId], ...values };
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
      const known = relationSummaries[column.fieldName] ?? {};
      const ids = [
        ...new Set(
          rows
            .flatMap((row) => idsForRow(column, row))
            .filter((id) => !(id in known)),
        ),
      ];
      if (ids.length === 0) continue;
      Promise.all(
        ids.map(
          async (id): Promise<[string, SummaryLine[]]> => {
            const entryValue = await resolveRelation(column.targetTypeId, id);
            if (!entryValue) {
              return [id, [{ fieldName: "id", label: "ID", kind: "text", text: id }]];
            }
            const lines = await buildEntrySummary(
              column.displayFields,
              target.targetFieldNodes,
              entryValue,
              allTypes,
              resolveRelation,
              0,
              new Set([column.targetTypeId]),
            );
            return [id, lines];
          },
        ),
      ).then((pairs) => {
        if (cancelled) return;
        setRelationSummaries((current) => ({
          ...current,
          [column.fieldName]: {
            ...current[column.fieldName],
            ...Object.fromEntries(pairs),
          },
        }));
      });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `relationSummaries` deliberately excluded: it's read to skip refetching, not to retrigger this effect (that update comes back through `rows`/`rowRelationValues`/`visibleKeys` instead).
  }, [rows, relationColumns, relationTargets, visibleKeys, rowRelationValues, allTypes, resolveRelation]);

  const isPinned = pinnedContentTypeSlugs.has(type.name);

  const columns: DataTableColumn<Row>[] = listCells.map(
    (cell): DataTableColumn<Row> => {
      if (cell.kind === "field") {
        const column = cell.column;
        return {
          key: column.fieldName,
          label: column.label,
          numeric: column.fieldType === "number",
          // `image` is technically queryable (it's a plain TEXT column of file
          // paths), but sorting by that path is meaningless for a thumbnail cell.
          sortable:
            queryableFieldNames.has(column.fieldName) &&
            column.fieldType !== "image",
          render: (value) =>
            renderEntryCellValue(column, value, (label, html) =>
              setRichTextPreview({ label, html }),
            ),
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
          return renderRelationCell(
            ids,
            (id) => relationSummaries[column.fieldName]?.[id],
            column.cardinality !== "manyToOne",
          );
        },
      };
    },
  );

  return (
    <>
      <section class="card">
        <header>
          <div class="row">
            {!isPinned && (
              <a role="button" href={`${path}/content`} class="icon ghost">
                <ArrowLeftIcon />
              </a>
            )}
            <div style={{ flex: 1 }}>
              <h2>{type.label}</h2>
              <p>{type.description || "Entries in this collection."}</p>
            </div>
          </div>
        </header>
        <div class="under stack">
          {loadError && <span class="error">{loadError}</span>}
          {/* See `useClientSearch` above - `serverQuery` below carries its own
              `loading` readout, which this mode doesn't use. */}
          {useClientSearch && showListLoading && (
            <span class="hint">Loading…</span>
          )}

          <DataTable
            columns={columns}
            rows={displayRows}
            rowKey={(row) => row.id}
            emptyLabel="No entries yet."
            // Search stays available even when `features.sortable` (see
            // `dragReorder` below) - `DataTable` itself auto-disables dragging
            // while the search box has text, since a filtered view has no
            // single well-defined drag order to save.
            pageSize={isSortable ? 0 : pageSize}
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            onPageSizeChange={setPageSize}
            onRowClick={(row) =>
              route(`${path}/content/${type.name}/${row.id}`)
            }
            columnToggle={{
              storageKey: `contentList:${type.name}:columns`,
              defaultVisible,
              onVisibleChange: (visible) => {
                setSearchableFields(
                  visible.filter((key) => queryableFieldNames.has(key)),
                );
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
                    loading: showListLoading,
                  }
            }
            dragReorder={
              isSortable
                ? {
                    getId: (row) => row.id,
                    onReorder: setDragOrder,
                    disabled: savingOrder || !canUpdate,
                  }
                : undefined
            }
            leadingColumn={{
              render: (row) =>
                hasEntryDraft(type.name, row.id) ? (
                  <span class="nav-draft-dot" aria-label="Unsaved changes" />
                ) : null,
            }}
            actions={
              <>
                {isSortable && dragOrder && canUpdate && (
                  <button
                    type="button"
                    class="outline"
                    disabled={savingOrder}
                    aria-busy={savingOrder}
                    onClick={handleSaveOrder}
                  >
                    Save order
                  </button>
                )}
                {canCreate && (
                  <button
                    type="button"
                    onClick={() => route(`${path}/content/${type.name}/new`)}
                  >
                    <PlusIcon /> Add
                  </button>
                )}
              </>
            }
          />
        </div>
      </section>

      <RichTextPreviewDialog
        preview={richTextPreview}
        onClose={() => setRichTextPreview(null)}
      />
    </>
  );
}
