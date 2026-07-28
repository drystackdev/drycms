import { useMemo } from "preact/hooks";
import { path } from "virtual:drycms/config";
import ComponentField from "../../components/ComponentField.js";
import RelationField, {
  type RelationFieldSource,
} from "../../components/RelationField.js";
import { createContentEntriesApi } from "../../content-types/entries-http-api.js";
import type { EntryValue } from "../../content-types/engine/entry-codec.js";
import { validateEntryValue } from "../../content-types/engine/entry-validate.js";
import {
  buildEntryFieldTree,
  flattenQueryableColumns,
  type EntryComponentRepeatNode,
  type EntryFieldNode,
  type EntryRelationMirrorNode,
  type EntryRelationNode,
} from "../../content-types/engine/entry-tree.js";
import type { ContentTypeDefinition } from "../../content-types/types.js";
import { blankEntryValue } from "./blank-value.js";
import ScalarField from "./ScalarField.js";

export interface FieldRendererProps {
  node: EntryFieldNode;
  value: unknown;
  onChange: (value: unknown) => void;
  error?: string;
  allTypes: ContentTypeDefinition[];
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
    return (
      <fieldset>
        <legend>{node.label}</legend>
        {node.description && <small>{node.description}</small>}
        <div class="stack">
          {node.children.map((child) => (
            <FieldRenderer
              key={child.fieldName}
              node={child}
              value={nested[child.fieldName]}
              onChange={(childValue) =>
                onChange({ ...nested, [child.fieldName]: childValue })
              }
              allTypes={allTypes}
            />
          ))}
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
    />
  );
}

/** Builds a `RelationFieldSource` from an arbitrary `ContentTypeDefinition`
 * (its first 3 queryable columns for the picker table, `createContentEntriesApi`
 * for fetching/resolving) - shared by `RelationFieldAdapter` (picking rows
 * from a `relation` field's own target type) and `RelationMirrorFieldAdapter`
 * (picking rows from a `relationmirror` field's SOURCE type instead), since
 * neither depends on cardinality/direction, only on which type's rows are
 * being picked. */
function useRelationFieldSource(
  type: ContentTypeDefinition | undefined,
  allTypes: ContentTypeDefinition[],
): RelationFieldSource<{ id: string } & Record<string, unknown>> | null {
  const entriesApi = useMemo(
    () => (type ? createContentEntriesApi(`${path}/api/content`, type.name) : null),
    [type],
  );
  const queryableColumns = useMemo(
    () => (type ? flattenQueryableColumns(buildEntryFieldTree(type, allTypes)).slice(0, 3) : []),
    [type, allTypes],
  );

  return useMemo(() => {
    if (!type || !entriesApi) return null;
    const labelField = queryableColumns[0]?.fieldName;
    return {
      columns: queryableColumns.map((column) => ({
        key: column.fieldName,
        label: column.label,
        render: (cellValue: unknown) => (
          <>{cellValue === null || cellValue === undefined || cellValue === "" ? "—" : String(cellValue)}</>
        ),
      })),
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
    };
  }, [type, entriesApi, queryableColumns]);
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
  const source = useRelationFieldSource(targetType, allTypes);

  if (!targetType || !source) {
    return (
      <div class="field">
        <label>{node.label}</label>
        <span class="hint">Target collection not found.</span>
      </div>
    );
  }

  return (
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
      pickerTitle={`Choose ${targetType.label}`}
      error={!!error}
      helperText={error}
    />
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
  const sourceType = node.resolved ? allTypes.find((t) => t.id === node.sourceTypeId) : undefined;
  const multiple = node.resolved && node.reverseCardinality !== "manyToOne";
  const source = useRelationFieldSource(sourceType, allTypes);

  if (!node.resolved || !sourceType || !source) {
    return (
      <div class="field">
        <label>{node.label}</label>
        <span class="hint">Source relation field not found.</span>
      </div>
    );
  }

  return (
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
}: {
  node: EntryComponentRepeatNode;
  value: EntryValue[];
  onChange: (value: unknown) => void;
  allTypes: ContentTypeDefinition[];
  error?: string;
}) {
  const summaryField = node.itemFields.find((f) => f.kind === "column")?.fieldName;

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
      summaryOf={(item) => (summaryField ? String(item[summaryField] ?? "") : "")}
      blankItem={() => blankEntryValue(node.itemFields)}
      validateItem={(item) => validateEntryValue(node.itemFields, item)}
      renderItem={(item, setItem, errors) =>
        node.itemFields.map((child) => (
          <FieldRenderer
            key={child.fieldName}
            node={child}
            value={item[child.fieldName]}
            onChange={(childValue) =>
              setItem({ ...item, [child.fieldName]: childValue })
            }
            error={errors[child.fieldName]}
            allTypes={allTypes}
          />
        ))
      }
    />
  );
}
