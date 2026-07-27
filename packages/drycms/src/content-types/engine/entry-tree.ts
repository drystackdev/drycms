import type { ComponentFieldConfig, RelationCardinality, RelationFieldConfig } from "../field-registry.js";
import { fieldTypes } from "../field-registry.js";
import { systemFieldsFor } from "../system-fields.js";
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
  columnName: string;
  fieldType: string;
  fieldConfig: unknown;
  validation: FieldValidation;
  default?: unknown;
}

/** A non-repeatable `component` field - its own fields live inline on the
 * SAME table as their parent, just name-prefixed (see `tree.ts`'s `walk`). */
export interface EntryFlattenNode {
  fieldName: string;
  label: string;
  kind: "flatten";
  children: EntryFieldNode[];
}

/** A repeatable `component` field - one child table, one row per item. */
export interface EntryComponentRepeatNode {
  kind: "component-repeat";
  fieldName: string;
  label: string;
  tableName: string;
  itemFields: EntryFieldNode[];
}

/** A `relation` field, either cardinality. `manyToOne` stores a single
 * `target_id` column directly on this table (`columnName` set); `oneToMany`/
 * `manyToMany` store one row per link in a child table (`tableName` set). */
export interface EntryRelationNode {
  kind: "relation";
  fieldName: string;
  label: string;
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
          fieldName: field.name,
          label: field.label,
          cardinality: config.cardinality,
          targetTypeId: config.target,
          columnName: column.name,
        };
      }
      const childRef = childrenByLeaf.get(field.id)!;
      return {
        kind: "relation",
        fieldName: field.name,
        label: field.label,
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
          fieldName: field.name,
          label: field.label,
          tableName: childRef.tableName,
          itemFields: buildNodes(component.fields, childRef.node, componentsById),
        };
      }
      return {
        kind: "flatten",
        fieldName: field.name,
        label: field.label,
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
}

/**
 * Every `column` field, flattened into one list regardless of `flatten`
 * nesting - exactly the set of fields a List page's table can show a plain
 * column for, sort by, or search across. `relation`/`component-repeat`
 * fields are deliberately excluded: they're multi-valued/child-table-backed,
 * not a single column a `WHERE`/`ORDER BY` can target directly, and the List
 * page renders them as a summary instead (see `status/content.md`).
 */
export function flattenQueryableColumns(nodes: EntryFieldNode[], pathPrefix = "", labelPrefix = ""): QueryableColumn[] {
  const out: QueryableColumn[] = [];
  for (const node of nodes) {
    const fieldName = pathPrefix ? `${pathPrefix}.${node.fieldName}` : node.fieldName;
    if (node.kind === "column") {
      out.push({
        fieldName,
        columnName: node.columnName,
        label: labelPrefix ? `${labelPrefix} / ${node.label}` : node.label,
        fieldType: node.fieldType,
        fieldConfig: node.fieldConfig,
      });
    } else if (node.kind === "flatten") {
      const label = labelPrefix ? `${labelPrefix} / ${node.label}` : node.label;
      out.push(...flattenQueryableColumns(node.children, fieldName, label));
    }
  }
  return out;
}

/**
 * The entry-data counterpart to `tree.ts`'s `resolveTableTree`: same walk,
 * same field-id-keyed matching against the resolved `TableNode`, but keyed by
 * *field name* (for reading/writing entry values) instead of SQL identity.
 * Includes the synthetic system fields (`title`/`slug`/`draft`/.../`seo`) a
 * `features` toggle implies, in the same front-of-`fields[]` position
 * `systemFieldsFor` always uses.
 */
export function buildEntryFieldTree(type: ContentTypeDefinition, allTypes: ContentTypeDefinition[]): EntryFieldNode[] {
  const componentsById = new Map(allTypes.filter((t) => t.kind === "component").map((t) => [t.id, t]));
  const rootTree = resolveTableTree(type, allTypes);
  const rootFields = [...systemFieldsFor(type), ...type.fields];
  return buildNodes(rootFields, rootTree, componentsById);
}
