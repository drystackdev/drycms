import type { ComponentFieldConfig, RelationCardinality, RelationFieldConfig } from "../field-registry.js";
import { fieldTypes } from "../field-registry.js";
import { applyFieldOrder, systemFieldsFor } from "../system-fields.js";
import { resolveTableTree, type TableNode } from "../tree.js";
import type { ContentTypeDefinition, FieldDefinition, FieldValidation } from "../types.js";

export interface EntryColumnNode {
  kind: "column";
  /** The declared or synthetic-system `FieldDefinition.id` this column came
   * from - `entry-codec.ts`'s `applyTimestamps` matches against
   * `SYSTEM_FIELD_IDS.createdAt`/`updatedAt` by this, not by `fieldName`,
   * since a name match alone can't tell a real system timestamp field apart
   * from a same-named custom field on a type that has `features.timestamps`
   * off (where `createdAt`/`updatedAt` aren't reserved names). */
  fieldId: string;
  fieldName: string;
  label: string;
  description?: string;
  columnName: string;
  fieldType: string;
  fieldConfig: unknown;
  validation: FieldValidation;
  default?: unknown;
}

/** A non-repeatable `component` field - its own fields live inline on the
 * SAME table as their parent, just name-prefixed (see `tree.ts`'s `walk`). */
export interface EntryFlattenNode {
  /** The `FieldDefinition.id`/`SYSTEM_FIELD_IDS` value this node came from -
   * see `EntryColumnNode.fieldId`'s doc comment; also used to key into
   * `ContentTypeDefinition.fieldSides` (`system-fields.ts`'s
   * `resolveFieldSide`). */
  fieldId: string;
  fieldName: string;
  label: string;
  description?: string;
  kind: "flatten";
  children: EntryFieldNode[];
}

/** A repeatable `component` field - one child table, one row per item. */
export interface EntryComponentRepeatNode {
  kind: "component-repeat";
  fieldId: string;
  fieldName: string;
  label: string;
  description?: string;
  tableName: string;
  itemFields: EntryFieldNode[];
}

/** A `relation` field, either cardinality. `manyToOne` stores a single
 * `target_id` column directly on this table (`columnName` set); `oneToMany`/
 * `manyToMany` store one row per link in a child table (`tableName` set). */
export interface EntryRelationNode {
  kind: "relation";
  fieldId: string;
  fieldName: string;
  label: string;
  description?: string;
  cardinality: RelationCardinality;
  targetTypeId: string;
  columnName?: string;
  tableName?: string;
}

export type EntryFieldNode = EntryColumnNode | EntryFlattenNode | EntryComponentRepeatNode | EntryRelationNode;

function leafId(path: string[]): string {
  return path[path.length - 1]!;
}

function buildNodes(
  fields: FieldDefinition[],
  tableNode: TableNode,
  componentsById: Map<string, ContentTypeDefinition>,
): EntryFieldNode[] {
  const columnsByLeaf = new Map(tableNode.columns.map((c) => [leafId(c.localIdPath), c]));
  const childrenByLeaf = new Map(tableNode.children.map((c) => [leafId(c.localIdPath), c]));

  return fields.map((field): EntryFieldNode => {
    if (!fieldTypes[field.type]) {
      throw new Error(`[drycms] Unknown field type "${field.type}" on field "${field.id}".`);
    }

    if (field.type === "relation") {
      const config = field.config as RelationFieldConfig;
      if (config.cardinality === "manyToOne") {
        const column = columnsByLeaf.get(field.id)!;
        return {
          kind: "relation",
          fieldId: field.id,
          fieldName: field.name,
          label: field.label,
          description: field.description,
          cardinality: config.cardinality,
          targetTypeId: config.target,
          columnName: column.name,
        };
      }
      const childRef = childrenByLeaf.get(field.id)!;
      return {
        kind: "relation",
        fieldId: field.id,
        fieldName: field.name,
        label: field.label,
        description: field.description,
        cardinality: config.cardinality,
        targetTypeId: config.target,
        tableName: childRef.tableName,
      };
    }

    if (field.type === "component") {
      const config = field.config as ComponentFieldConfig;
      const component = componentsById.get(config.componentId);
      if (!component) {
        throw new Error(`[drycms] Field "${field.name}" (${field.id}) references missing component "${config.componentId}".`);
      }
      if (config.repeatable) {
        const childRef = childrenByLeaf.get(field.id)!;
        return {
          kind: "component-repeat",
          fieldId: field.id,
          fieldName: field.name,
          label: field.label,
          description: field.description,
          tableName: childRef.tableName,
          itemFields: buildNodes(component.fields, childRef.node, componentsById),
        };
      }
      return {
        kind: "flatten",
        fieldId: field.id,
        fieldName: field.name,
        label: field.label,
        description: field.description,
        children: buildNodes(component.fields, tableNode, componentsById),
      };
    }

    // Every other field type always resolves to a plain column - only
    // `relation`/`component` have shapes that depend on their own config
    // (see `field-registry.ts`'s `FieldTypeDefinition.shape`).
    const column = columnsByLeaf.get(field.id)!;
    return {
      kind: "column",
      fieldId: field.id,
      fieldName: field.name,
      label: field.label,
      description: field.description,
      columnName: column.name,
      validation: field.validation,
      default: field.default,
      fieldType: field.type,
      fieldConfig: field.config,
    };
  });
}

export interface QueryableColumn {
  /** Dotted path for a field nested inside a `flatten` component (e.g.
   * `"seo.metaTitle"`) - matches the path `entry-codec.ts`'s `validateEntryValue`
   * reports field errors under. */
  fieldName: string;
  /** The real, already-`quoteIdent`-safe SQL column name - what a
   * `WHERE`/`ORDER BY` actually targets. */
  columnName: string;
  label: string;
  fieldType: string;
  fieldConfig: unknown;
  validation: FieldValidation;
}

/** `password` holds a one-way hash, never round-tripped to the client as a
 * real value (see `entry-codec.ts`'s `MASKED_FIELD_TYPES`) - useless, and
 * misleading, as a List-page column even in its masked form, so
 * `flattenDisplayColumns` excludes it same as it excludes relations. */
const UNDISPLAYABLE_FIELD_TYPES = new Set(["password"]);

/** On top of `UNDISPLAYABLE_FIELD_TYPES`, also excludes `secretkey` - its
 * masked placeholder is still worth a glance on a List page (see
 * `ContentEntryList.tsx`), but the ciphertext behind it can't be sorted or
 * searched, so `flattenQueryableColumns` (the sort/search-safe subset) drops
 * it too. */
const UNQUERYABLE_FIELD_TYPES = new Set([...UNDISPLAYABLE_FIELD_TYPES, "secretkey"]);

/**
 * Every `column` field, flattened into one list regardless of `flatten`
 * nesting - exactly the set of fields a List page's table can show a plain
 * column for. `relation`/`component-repeat` fields are deliberately
 * excluded: they're multi-valued/child-table-backed, not a single column a
 * cell can render directly, and the List page has no summary rendering for
 * them yet. `password` is excluded too - see `UNDISPLAYABLE_FIELD_TYPES`.
 */
export function flattenDisplayColumns(nodes: EntryFieldNode[], pathPrefix = "", labelPrefix = ""): QueryableColumn[] {
  const out: QueryableColumn[] = [];
  for (const node of nodes) {
    const fieldName = pathPrefix ? `${pathPrefix}.${node.fieldName}` : node.fieldName;
    if (node.kind === "column") {
      if (UNDISPLAYABLE_FIELD_TYPES.has(node.fieldType)) continue;
      out.push({
        fieldName,
        columnName: node.columnName,
        label: labelPrefix ? `${labelPrefix} / ${node.label}` : node.label,
        fieldType: node.fieldType,
        fieldConfig: node.fieldConfig,
        validation: node.validation,
      });
    } else if (node.kind === "flatten") {
      const label = labelPrefix ? `${labelPrefix} / ${node.label}` : node.label;
      out.push(...flattenDisplayColumns(node.children, fieldName, label));
    }
  }
  return out;
}

/** The subset of `flattenDisplayColumns` a `WHERE`/`ORDER BY` can safely
 * target - also what a List page should offer to sort by, search across, or
 * use as a relation-picker display field (see `FieldRenderer.tsx`'s
 * `RelationFieldAdapter`). */
export function flattenQueryableColumns(nodes: EntryFieldNode[], pathPrefix = "", labelPrefix = ""): QueryableColumn[] {
  return flattenDisplayColumns(nodes, pathPrefix, labelPrefix).filter((c) => !UNQUERYABLE_FIELD_TYPES.has(c.fieldType));
}

/**
 * The entry-data counterpart to `tree.ts`'s `resolveTableTree`: same walk,
 * same field-id-keyed matching against the resolved `TableNode`, but keyed by
 * *field name* (for reading/writing entry values) instead of SQL identity.
 * Includes the synthetic system fields (`title`/`slug`/`draft`/.../`seo`) a
 * `features` toggle implies, defaulting to the same front-of-`fields[]`
 * position `systemFieldsFor` always uses in `resolveTableTree` - but, unlike
 * the real column order, this DISPLAY order is then permuted by
 * `type.fieldOrder` (see `types.ts`), so system and custom fields can freely
 * interleave on screen without touching the underlying table.
 */
export function buildEntryFieldTree(type: ContentTypeDefinition, allTypes: ContentTypeDefinition[]): EntryFieldNode[] {
  const componentsById = new Map(allTypes.filter((t) => t.kind === "component").map((t) => [t.id, t]));
  const rootTree = resolveTableTree(type, allTypes);
  const rootFields = applyFieldOrder([...systemFieldsFor(type), ...type.fields], type.fieldOrder);
  return buildNodes(rootFields, rootTree, componentsById);
}
