import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import type { JSX } from "preact/jsx-runtime";
const { path } = window.__DRY_CONFIG__;
import ComponentField from "../../components/fields/ComponentField.js";
import { renderEntryCellValue } from "../../components/EntryCellValue.js";
import EntrySummaryLines from "../../components/EntrySummaryLines.js";
import RelationField, {
  type RelationFieldSource,
} from "../../components/fields/RelationField.js";
import RichTextPreviewDialog from "../../components/RichTextPreviewDialog.js";
import { createContentEntriesApi } from "../../content-types/entries-http-api.js";
import type { EntryValue } from "../../content-types/engine/entry-codec.js";
import { buildEntrySummary, type ResolveRelation, type SummaryLine } from "../../content-types/engine/entry-summary.js";
import { validateEntryValue } from "../../content-types/engine/entry-validate.js";
import {
  buildEntryFieldTree,
  flattenQueryableColumns,
  type EntryComponentRepeatNode,
  type EntryFieldNode,
  type EntryRelationMirrorNode,
  type EntryRelationNode,
} from "../../content-types/engine/entry-tree.js";
import { SUPER_ADMIN_FIELD_NAME } from "../../content-types/permissions.js";
import type { ContentTypeDefinition } from "../../content-types/types.js";
import { blankEntryValue } from "./blank-value.js";
import ScalarField from "./ScalarField.js";

export interface FieldRendererProps {
  node: EntryFieldNode;
  value: unknown;
  onChange: (value: unknown) => void;
  error?: string;
  allTypes: ContentTypeDefinition[];
  /** The Visual Editing Interface's `?_path=` deep link (`overlay.ts`),
   * already confirmed to start at THIS node (`revealPath[0] === node.fieldName`
   * - `ContentEntryEditor.tsx`'s `renderFieldNodes` only passes it down that
   * far). Only `flatten` and `component-repeat` do anything with it: a
   * `component-repeat` field has no other way to reach an item that only
   * renders once its own dialog is open (`ComponentField.tsx`'s
   * `revealIndex`/`revealField`). */
  revealPath?: string[];
  /** The dotted path from the entry root to THIS node (e.g. `"hero"`, or
   * `"hero.cta"` for a `flatten` block nested inside another) - only ever
   * set by the `flatten` branch below, recursing into itself. Lets nested
   * `flatten` children carry their own `data-field-name` anchor scoped to
   * their exact position (`"hero.title"`) instead of only the top-level
   * wrapper's plain field name, which `highlightAnchor` would otherwise
   * resolve to the whole block's `<fieldset>` - see the second `scrollToField`
   * call in `ContentEntryEditor.tsx`'s `?_field=`/`?_path=` effect. */
  pathPrefix?: string;
}

/**
 * Renders one field of an entry, dispatching on `EntryFieldNode.kind`:
 * `column` -> `ScalarField` (the registry `Editor`s); `flatten` -> a nested
 * fieldset recursing back into this same component; `relation`/
 * `relation-mirror`/`component-repeat` -> thin adapters over the reusable
 * `components/RelationField`/`ComponentField` (`field-registry.ts` has no
 * `Editor` for any of the three - they're schema-definition-only there),
 * wiring the content-types-specific data source (target/source collection
 * API, nested `FieldRenderer` recursion) into their generic, backend-agnostic
 * props.
 */
export default function FieldRenderer({
  node,
  value,
  onChange,
  error,
  allTypes,
  revealPath,
  pathPrefix,
}: FieldRendererProps) {
  if (node.kind === "column") {
    return (
      <ScalarField
        node={node}
        value={value}
        onChange={onChange}
        error={error}
      />
    );
  }

  if (node.kind === "flatten") {
    const nested = (value as EntryValue) ?? {};
    const rest = revealPath?.slice(1);
    const ownPath = pathPrefix ?? node.fieldName;
    return (
      <fieldset>
        <legend>{node.label}</legend>
        {node.description && <small>{node.description}</small>}
        <div class="stack">
          {node.children.map((child) => {
            const childPath = `${ownPath}.${child.fieldName}`;
            return (
              <div key={child.fieldName} data-field-name={childPath}>
                <FieldRenderer
                  node={child}
                  value={nested[child.fieldName]}
                  onChange={(childValue) =>
                    onChange({ ...nested, [child.fieldName]: childValue })
                  }
                  allTypes={allTypes}
                  revealPath={rest?.[0] === child.fieldName ? rest : undefined}
                  pathPrefix={childPath}
                />
              </div>
            );
          })}
        </div>
      </fieldset>
    );
  }

  if (node.kind === "relation") {
    return (
      <RelationFieldAdapter
        node={node}
        value={value}
        onChange={onChange}
        allTypes={allTypes}
        error={error}
      />
    );
  }

  if (node.kind === "relation-mirror") {
    return (
      <RelationMirrorFieldAdapter
        node={node}
        value={value}
        onChange={onChange}
        allTypes={allTypes}
        error={error}
      />
    );
  }

  return (
    <ComponentRepeatFieldAdapter
      node={node}
      value={(value as EntryValue[]) ?? []}
      onChange={onChange}
      allTypes={allTypes}
      error={error}
      revealPath={revealPath}
    />
  );
}

/** Fetches one related/mirrored entry's own value (child relation/component
 * arrays already populated, same shape `entriesApi.get()` returns) by target
 * type id - `entry-summary.ts`'s `buildEntrySummary` takes this as its
 * injected `resolveRelation`, so every "list component" summary in the entry
 * editor (`RelationField`'s chosen-item chips, `ComponentField`'s item list)
 * shares the exact same fetch path. A missing/unreadable id degrades to
 * `undefined` (bare-id fallback), same as a dangling relation elsewhere. */
function useResolveRelation(allTypes: ContentTypeDefinition[]): ResolveRelation {
  return useCallback(
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
}

/** Builds a `RelationFieldSource` from an arbitrary `ContentTypeDefinition`
 * (its first 3 queryable columns for the picker table, `createContentEntriesApi`
 * for fetching/resolving) - shared by `RelationFieldAdapter` (picking rows
 * from a `relation` field's own target type) and `RelationMirrorFieldAdapter`
 * (picking rows from a `relationmirror` field's SOURCE type instead), since
 * neither depends on cardinality/direction, only on which type's rows are
 * being picked. `displayFields` is the picking field's own
 * `RelationFieldConfig.displayFields` (absent for a mirror - see
 * `EntryRelationMirrorNode`'s doc comment, mirrors have no config surface of
 * their own), threaded into `resolveSummaries` below. */
interface RelationFieldSourceResult {
  source: RelationFieldSource<{ id: string } & Record<string, unknown>> | null;
  /** Mount this alongside the `<RelationField>` that renders `source` - a
   * block-level richtext column (`EntryCellValue.tsx`'s "View HTML" button)
   * opens it instead of dumping raw HTML into the picker table's cell. */
  previewDialog: JSX.Element;
}

function useRelationFieldSource(
  type: ContentTypeDefinition | undefined,
  allTypes: ContentTypeDefinition[],
  displayFields: string[] | undefined,
): RelationFieldSourceResult {
  const [richTextPreview, setRichTextPreview] = useState<{
    label: string;
    html: string;
  } | null>(null);
  const entriesApi = useMemo(
    () =>
      type ? createContentEntriesApi(`${path}/api/content`, type.name) : null,
    [type],
  );
  // ALL of the target's queryable columns, not just a handful - `columnToggle`
  // below (mirroring `ContentEntryList.tsx`'s own List page table) is what
  // keeps the picker compact by default, while still letting a user reveal
  // whichever of these actually matters for the type they're picking from.
  const queryableColumns = useMemo(() => {
    const columns = type
      ? flattenQueryableColumns(buildEntryFieldTree(type, allTypes))
      : [];
    return type?.name === "role"
      ? columns.filter((column) => column.fieldName !== SUPER_ADMIN_FIELD_NAME)
      : columns;
  }, [type, allTypes]);
  const targetFieldNodes = useMemo(
    () => (type ? buildEntryFieldTree(type, allTypes) : []),
    [type, allTypes],
  );
  const resolveRelation = useResolveRelation(allTypes);

  const source = useMemo<
    RelationFieldSource<{ id: string } & Record<string, unknown>> | null
  >(() => {
    if (!type || !entriesApi) return null;
    const labelField = queryableColumns[0]?.fieldName;
    return {
      columns: queryableColumns.map((column) => ({
        key: column.fieldName,
        label: column.label,
        render: (cellValue: unknown) =>
          renderEntryCellValue(column, cellValue, (label, html) =>
            setRichTextPreview({ label, html }),
          ),
      })),
      // Same idea as `ContentEntryList.tsx`'s own `columnToggle`, scoped to
      // this picker rather than shared with the List page's own preference -
      // the two show different column sets (this one never has relation
      // columns), so a shared key would let a hidden-there choice hide a
      // column that isn't even offered here, or vice versa.
      columnToggle: {
        storageKey: `refPicker:${type.name}:columns`,
        defaultVisible: queryableColumns.slice(0, 3).map((c) => c.fieldName),
      },
      fetchRows: async (query) => {
        const result = await entriesApi.list({
          page: query.page,
          pageSize: query.pageSize,
          sortField: query.sortField,
          sortDir: query.sortDir,
          search: query.search,
          searchableFields: queryableColumns.map((c) => c.fieldName),
        });
        return {
          rows: result.rows.map((r) => ({ id: r.id, ...r.value })),
          total: result.total,
        };
      },
      resolveLabels: async (ids) => {
        const pairs = await Promise.all(
          ids.map((id) =>
            entriesApi
              .get(id)
              .then((entry): [string, string] => [
                id,
                labelField ? String(entry.value[labelField] ?? id) : id,
              ])
              .catch((): [string, string] => [id, id]),
          ),
        );
        return Object.fromEntries(pairs);
      },
      resolveSummaries: async (ids) => {
        const pairs = await Promise.all(
          ids.map(async (id): Promise<[string, SummaryLine[]]> => {
            const targetValue = await resolveRelation(type.id, id);
            if (!targetValue) {
              return [id, [{ fieldName: "id", label: "ID", kind: "text", text: id }]];
            }
            const lines = await buildEntrySummary(
              displayFields,
              targetFieldNodes,
              targetValue,
              allTypes,
              resolveRelation,
              0,
              new Set([type.id]),
            );
            return [id, lines];
          }),
        );
        return Object.fromEntries(pairs);
      },
    };
  }, [type, entriesApi, queryableColumns, targetFieldNodes, displayFields, allTypes, resolveRelation]);

  return {
    source,
    previewDialog: (
      <RichTextPreviewDialog
        preview={richTextPreview}
        onClose={() => setRichTextPreview(null)}
      />
    ),
  };
}

/** Adapts `RelationField`'s `""`/`string[]` "empty" convention to the
 * `manyToOne` column's real `null` in entry values - `oneToMany`/`manyToMany`
 * values are already plain string arrays, no translation needed. */
function RelationFieldAdapter({
  node,
  value,
  onChange,
  allTypes,
  error,
}: {
  node: EntryRelationNode;
  value: unknown;
  onChange: (value: unknown) => void;
  allTypes: ContentTypeDefinition[];
  error?: string;
}) {
  const targetType = allTypes.find((t) => t.id === node.targetTypeId);
  const multiple = node.cardinality !== "manyToOne";
  const { source, previewDialog } = useRelationFieldSource(targetType, allTypes, node.displayFields);

  if (!targetType || !source) {
    return (
      <div class="field">
        <label>{node.label}</label>
        <span class="hint">Target collection not found.</span>
      </div>
    );
  }

  return (
    <>
      <RelationField
        label={node.label}
        description={node.description}
        value={
          multiple
            ? Array.isArray(value)
              ? (value as string[])
              : []
            : typeof value === "string"
              ? value
              : ""
        }
        onChange={(next) =>
          onChange(multiple ? next : (next as string) === "" ? null : next)
        }
        multiple={multiple}
        sortable={node.sortable}
        source={source}
        pickerTitle={`Choose ${targetType.label}`}
        error={!!error}
        helperText={error}
      />
      {previewDialog}
    </>
  );
}

/** Same picker UI as `RelationFieldAdapter`, but for a `relationmirror`
 * field: picks rows from the MIRRORED field's `sourceTypeId` instead of a
 * `relation` field's own `targetTypeId`, and `multiple` comes from the
 * already-flipped `reverseCardinality` rather than a plain `cardinality`. An
 * unresolved node (source relation field renamed/deleted/retargeted since
 * this mirror was added) degrades the same way a dangling `relation.target`
 * already does. */
function RelationMirrorFieldAdapter({
  node,
  value,
  onChange,
  allTypes,
  error,
}: {
  node: EntryRelationMirrorNode;
  value: unknown;
  onChange: (value: unknown) => void;
  allTypes: ContentTypeDefinition[];
  error?: string;
}) {
  const sourceType = node.resolved
    ? allTypes.find((t) => t.id === node.sourceTypeId)
    : undefined;
  const multiple = node.resolved && node.reverseCardinality !== "manyToOne";
  // A mirror's `displayFields` has no config field of its own to live in -
  // sourced from `ContentTypeDefinition.fieldDisplayFields` instead (see
  // that map's doc comment), already resolved onto `node.displayFields` by
  // `entry-tree.ts`'s `buildRelationMirrorNode`.
  const { source, previewDialog } = useRelationFieldSource(
    sourceType,
    allTypes,
    node.resolved ? node.displayFields : undefined,
  );

  if (!node.resolved || !sourceType || !source) {
    return (
      <div class="field">
        <label>{node.label}</label>
        <span class="hint">Source relation field not found.</span>
      </div>
    );
  }

  return (
    <>
      <RelationField
        label={node.label}
        description={node.description}
        value={
          multiple
            ? Array.isArray(value)
              ? (value as string[])
              : []
            : typeof value === "string"
              ? value
              : ""
        }
        onChange={(next) =>
          onChange(multiple ? next : (next as string) === "" ? null : next)
        }
        multiple={multiple}
        source={source}
        pickerTitle={`Choose ${sourceType.label}`}
        error={!!error}
        helperText={error}
      />
      {previewDialog}
    </>
  );
}

/** Adapts `ComponentField`'s generic `renderItem` to a repeatable
 * component's own `itemFields`, recursing back into `FieldRenderer` for each
 * one - same nested-form shape `ComponentItemDialog` used to own directly. */
function ComponentRepeatFieldAdapter({
  node,
  value,
  onChange,
  allTypes,
  error,
  revealPath,
}: {
  node: EntryComponentRepeatNode;
  value: EntryValue[];
  onChange: (value: unknown) => void;
  allTypes: ContentTypeDefinition[];
  error?: string;
  revealPath?: string[];
}) {
  const summaryField = node.itemFields.find(
    (f) => f.kind === "column",
  )?.fieldName;

  // Richer, possibly multi-line summary per item (`ComponentField.tsx`'s
  // `renderSummary`) - component values are already fully inline (no fetch
  // for the item's OWN fields), but a chosen `displayFields` entry can still
  // be a nested `relation`, which needs `resolveRelation` to fetch its
  // target - hence the async effect rather than computing this inline.
  const resolveRelation = useResolveRelation(allTypes);
  const [summaries, setSummaries] = useState<SummaryLine[][]>([]);
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      value.map((item) =>
        buildEntrySummary(node.displayFields, node.itemFields, item, allTypes, resolveRelation),
      ),
    ).then((results) => {
      if (!cancelled) setSummaries(results);
    });
    return () => {
      cancelled = true;
    };
  }, [value, node.itemFields, node.displayFields, allTypes, resolveRelation]);

  // `revealPath` here is `[node.fieldName, <item index>, <item's own field
  // name>, ...]` (`field-path.ts`'s own dotted/indexed convention) - the
  // deeper segments, if any, are the same "known limitation" `applyFieldSet`
  // already documents (a nested write only surfaces as its top-level field
  // to an outside listener), so revealing only goes as deep as the item's
  // OWN top-level field, same granularity `ContentEntryEditor.tsx` already
  // gives the entry's own top-level fields.
  const rest = revealPath?.slice(1);
  const revealIndexSegment = rest?.[0];
  const revealIndex =
    revealIndexSegment !== undefined && /^\d+$/.test(revealIndexSegment)
      ? Number(revealIndexSegment)
      : undefined;
  const revealField = revealIndex !== undefined ? rest?.[1] : undefined;

  return (
    <ComponentField<EntryValue>
      label={node.label}
      description={node.description}
      value={value}
      onChange={onChange}
      sortable={node.sortable}
      error={!!error}
      helperText={error}
      itemLabel={node.label}
      summaryOf={(item) =>
        summaryField ? String(item[summaryField] ?? "") : ""
      }
      renderSummary={(_item, index) =>
        summaries[index] ? <EntrySummaryLines lines={summaries[index]!} /> : <span class="hint">…</span>
      }
      blankItem={() => blankEntryValue(node.itemFields)}
      validateItem={(item) => validateEntryValue(node.itemFields, item)}
      revealIndex={revealIndex}
      revealField={revealField}
      renderItem={(item, setItem, errors) =>
        node.itemFields.map((child) => (
          <div key={child.fieldName} data-field-name={child.fieldName}>
            <FieldRenderer
              node={child}
              value={item[child.fieldName]}
              onChange={(childValue) =>
                setItem({ ...item, [child.fieldName]: childValue })
              }
              error={errors[child.fieldName]}
              allTypes={allTypes}
            />
          </div>
        ))
      }
    />
  );
}
