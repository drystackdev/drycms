import type { ComponentFieldConfig, RelationCardinality, RelationFieldConfig, RelationMirrorFieldConfig, RichTextFieldConfig } from "../field-registry.js";
import { fieldTypes } from "../field-registry.js";
import { activeFields, activeSystemFieldsFor, applyFieldOrder, relationMirrorFieldsFor } from "../system-fields.js";
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
  /** From `ComponentFieldConfig.sortable` - lets `components/ComponentField.tsx`
   * drag-reorder items; order is just the array's own order (no separate
   * sort-index column - see `ContentEntryEditor.tsx`'s save flow, which
   * always resubmits the whole array). */
  sortable: boolean;
  /** Only ever carries `min`/`max` (item count) - see `field-registry.ts`'s
   * conditional `validationFields` (shown only when `repeatable` is on) and
   * `entry-validate.ts`'s count check that enforces them. */
  validation: FieldValidation;
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
  /** From `RelationFieldConfig.sortable` - lets `components/RelationField.tsx`
   * drag-reorder the picked items; only ever true when `cardinality` is
   * `manyToMany` (see that config's own doc). */
  sortable: boolean;
  /** Only ever carries `min`/`max` (item count) - see `field-registry.ts`'s
   * conditional `validationFields` (shown only when `cardinality` is
   * multi-valued) and `entry-validate.ts`'s count check that enforces them.
   * Meaningless on a `manyToOne` node (single target, nothing to count). */
  validation: FieldValidation;
}

/**
 * A `relationmirror` field - never physical storage of its own (see
 * `tree.ts`'s `walk()`'s `"virtual"` no-op branch). Instead it reads/writes
 * THROUGH `sourceTypeId`'s own `relation` field (`sourceFieldId`), from the
 * OPPOSITE side: `reverseCardinality` is `sourceFieldId`'s own cardinality
 * flipped (see `flipCardinality`), and `sourceColumnName`/
 * `sourceChildTableName` are that field's already-resolved physical location,
 * exactly the way `EntryRelationNode.columnName`/`.tableName` are - resolved
 * ONCE here, not re-derived by every adapter call site. Discriminated on
 * `resolved` so a since-deleted/retargeted/no-longer-`relation` source
 * degrades gracefully (entry editor: "Source relation field not found.") the
 * same way a plain `relation` field's dangling `target` already does,
 * instead of throwing and taking down the whole tree build.
 */
export type EntryRelationMirrorNode =
  | {
      kind: "relation-mirror";
      fieldId: string;
      fieldName: string;
      label: string;
      description?: string;
      resolved: true;
      /** `sourceFieldId`'s own cardinality, flipped - the multiplicity AS
       * SEEN FROM THIS SIDE, not the source's own. */
      reverseCardinality: RelationCardinality;
      sourceTypeId: string;
      /** The mirrored `relation` field's own `FieldDefinition.id` on
       * `sourceTypeId` - the file content engine's reverse-index is keyed by
       * this (plus `sourceTableName`, which for a root-table relation always
       * equals `sourceTypeId`'s own `ContentTypeDefinition.name` - see
       * `tree.ts`'s `resolveTableTree`) instead of a SQL column/table name,
       * since it has no table to query directly. */
      sourceFieldId: string;
      sourceTableName: string;
      /** Set iff `reverseCardinality === "oneToMany"` (source was `manyToOne`) -
       * a plain column on `sourceTableName`. */
      sourceColumnName?: string;
      /** Set iff `reverseCardinality` is `"manyToOne"` or `"manyToMany"`
       * (source was `oneToMany`/`manyToMany`) - the source's own relation
       * child table. */
      sourceChildTableName?: string;
    }
  | {
      kind: "relation-mirror";
      fieldId: string;
      fieldName: string;
      label: string;
      description?: string;
      resolved: false;
    };

export type EntryFieldNode = EntryColumnNode | EntryFlattenNode | EntryComponentRepeatNode | EntryRelationNode | EntryRelationMirrorNode;

function leafId(path: string[]): string {
  return path[path.length - 1]!;
}

/** `manyToOne` <-> `oneToMany` from the OTHER side's viewpoint; `manyToMany`
 * is symmetric. See `EntryRelationMirrorNode.reverseCardinality`'s doc. */
function flipCardinality(cardinality: RelationCardinality): RelationCardinality {
  if (cardinality === "manyToOne") return "oneToMany";
  if (cardinality === "oneToMany") return "manyToOne";
  return "manyToMany";
}

function buildRelationMirrorNode(field: FieldDefinition, allTypes: ContentTypeDefinition[]): EntryRelationMirrorNode {
  const base = {
    kind: "relation-mirror" as const,
    fieldId: field.id,
    fieldName: field.name,
    label: field.label,
    description: field.description,
  };
  const config = field.config as RelationMirrorFieldConfig;

  const sourceType = allTypes.find((t) => t.id === config.sourceTypeId);
  const sourceField = sourceType?.fields.find((f) => f.id === config.sourceFieldId);
  if (!sourceType || !sourceField || sourceField.type !== "relation") {
    return { ...base, resolved: false };
  }

  let sourceTree: TableNode;
  try {
    // Reuses `resolveTableTree` (same function `tree.ts`/`buildEntryFieldTree`
    // already call elsewhere) rather than inventing a second physical-name
    // resolver - safe even when `sourceType` is the SAME type this mirror
    // field is itself declared on (self-relations): `resolveTableTree` is a
    // pure function of `(type, allTypes)`, not memoized against/mutating any
    // shared state, so a redundant second call here is just that - redundant,
    // never recursive in any dangerous sense.
    sourceTree = resolveTableTree(sourceType, allTypes);
  } catch {
    // The SOURCE type's own fields are broken (e.g. missing component) -
    // degrade this mirror field rather than blow up the mirroring type's
    // whole tree over someone else's schema error.
    return { ...base, resolved: false };
  }

  const sourceConfig = sourceField.config as RelationFieldConfig;
  const reverseCardinality = flipCardinality(sourceConfig.cardinality);

  if (sourceConfig.cardinality === "manyToOne") {
    const column = sourceTree.columns.find((c) => leafId(c.localIdPath) === sourceField.id);
    if (!column) return { ...base, resolved: false };
    return {
      ...base,
      resolved: true,
      reverseCardinality,
      sourceTypeId: sourceType.id,
      sourceFieldId: sourceField.id,
      sourceTableName: sourceTree.tableName,
      sourceColumnName: column.name,
    };
  }
  const childRef = sourceTree.children.find((c) => leafId(c.localIdPath) === sourceField.id);
  if (!childRef) return { ...base, resolved: false };
  return {
    ...base,
    resolved: true,
    reverseCardinality,
    sourceTypeId: sourceType.id,
    sourceFieldId: sourceField.id,
    sourceTableName: sourceTree.tableName,
    sourceChildTableName: childRef.tableName,
  };
}

function buildNodes(
  fields: FieldDefinition[],
  tableNode: TableNode,
  componentsById: Map<string, ContentTypeDefinition>,
  allTypes: ContentTypeDefinition[],
): EntryFieldNode[] {
  const columnsByLeaf = new Map(tableNode.columns.map((c) => [leafId(c.localIdPath), c]));
  const childrenByLeaf = new Map(tableNode.children.map((c) => [leafId(c.localIdPath), c]));

  return fields.map((field): EntryFieldNode => {
    if (!fieldTypes[field.type]) {
      throw new Error(`[drycms] Unknown field type "${field.type}" on field "${field.id}".`);
    }

    if (field.type === "relationmirror") {
      return buildRelationMirrorNode(field, allTypes);
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
          sortable: false,
          validation: field.validation,
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
        sortable: config.cardinality === "manyToMany" && !!config.sortable,
        validation: field.validation,
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
          itemFields: buildNodes(component.fields, childRef.node, componentsById, allTypes),
          sortable: !!config.sortable,
          validation: field.validation,
        };
      }
      return {
        kind: "flatten",
        fieldId: field.id,
        fieldName: field.name,
        label: field.label,
        description: field.description,
        children: buildNodes(component.fields, tableNode, componentsById, allTypes),
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
  /** The declared or synthetic-system `FieldDefinition.id` - see
   * `EntryColumnNode.fieldId`'s doc comment for why matching a SPECIFIC
   * system field (e.g. the `draft`/`schedule` flags `entry-where.ts`'s
   * `buildPublishedOnlyClause` looks for) must go through this, not
   * `fieldName`: a name match alone can't tell the real system field apart
   * from a same-named custom field on a type that has the matching feature
   * off. */
  fieldId: string;
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

/** `password` and `secretkey` never round-trip a real value to the client
 * (see `entry-codec.ts`'s `MASKED_FIELD_TYPES`) - useless, and misleading, as
 * a List-page column even in masked form, so `flattenDisplayColumns` excludes
 * both, same as it excludes relations. */
const UNDISPLAYABLE_FIELD_TYPES = new Set(["password", "secretkey"]);

/** Every undisplayable field is unqueryable too - there's nothing sortable
 * or searchable behind a value that never reaches the client. */
const UNQUERYABLE_FIELD_TYPES = UNDISPLAYABLE_FIELD_TYPES;

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
        fieldId: node.fieldId,
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
 * `flattenQueryableColumns` plus a `manyToOne` relation field's own id
 * column - a real, single physical column (the FK itself), safe for a
 * `WHERE` to compare directly (`buildWhereClause` doesn't need to know it's
 * a relation at all; treated as a plain `number` column). `oneToMany`/
 * `manyToMany` stay excluded - those are child-table-backed, no single
 * column to compare against without a join/subquery `buildWhereClause`
 * doesn't do.
 *
 * Deliberately its OWN function rather than widening `flattenQueryableColumns`
 * itself: that function's result also feeds UI surfaces that treat
 * "queryable" as "safe to show a human" - the List page's searchable-fields
 * toggle and `FieldRenderer.tsx`'s relation-picker label/columns - where a
 * raw FK id showing up as a "searchable field" or as a relation's own
 * display label would be confusing, not just unhelpful. Only
 * `entries-sqlite.ts`/`entries-d1.ts`'s `where`-clause resolution should see
 * the wider set; `sort`/`search`/display all keep using the narrower
 * `flattenQueryableColumns` unchanged.
 */
export function flattenWhereColumns(nodes: EntryFieldNode[], pathPrefix = "", labelPrefix = ""): QueryableColumn[] {
  const out = flattenQueryableColumns(nodes, pathPrefix, labelPrefix);
  for (const node of nodes) {
    if (node.kind === "flatten") {
      const fieldName = pathPrefix ? `${pathPrefix}.${node.fieldName}` : node.fieldName;
      const label = labelPrefix ? `${labelPrefix} / ${node.label}` : node.label;
      out.push(...flattenWhereColumns(node.children, fieldName, label));
    } else if (node.kind === "relation" && node.cardinality === "manyToOne" && node.columnName) {
      const fieldName = pathPrefix ? `${pathPrefix}.${node.fieldName}` : node.fieldName;
      out.push({
        fieldId: node.fieldId,
        fieldName,
        columnName: node.columnName,
        label: labelPrefix ? `${labelPrefix} / ${node.label}` : node.label,
        fieldType: "number",
        fieldConfig: undefined,
        validation: node.validation,
      });
    }
  }
  return out;
}

/** The row's own primary key - never a declared `FieldDefinition`, so it's
 * never part of `flattenDisplayColumns`/`flattenQueryableColumns`'s output,
 * but a real, always-present physical column a `WHERE` can safely target
 * (e.g. excluding "this same row" from a `list()` result). Appended once,
 * directly by `entries-sqlite.ts`/`entries-d1.ts`, next to `flattenWhereColumns`'s
 * result - not folded into that function itself, since "id" isn't derived
 * from `nodes` at all. */
export const ID_WHERE_COLUMN: QueryableColumn = {
  fieldId: "id",
  fieldName: "id",
  columnName: "id",
  label: "ID",
  fieldType: "number",
  fieldConfig: undefined,
  validation: {},
};

/** A non-inline `richtext` field's authored HTML can be large enough to slow
 * down a plain `list()` query if fetched for every row by default - `inline`
 * richtext (short, text-like) has no such concern, so only non-inline is
 * excludable. */
function isExcludableFromList(node: EntryColumnNode): boolean {
  if (node.fieldType !== "richtext") return false;
  return !(node.fieldConfig as RichTextFieldConfig | undefined)?.inline;
}

/**
 * Real physical column names for a `list()` SELECT: every plain `column`
 * node (any field type, except an excluded non-inline `richtext` one) plus a
 * `manyToOne` `relation`'s own id column, recursing into `flatten` component
 * fields (same table). `component-repeat`/`oneToMany`/`manyToMany`
 * relation/`relation-mirror` nodes have no column of their own (child-table
 * or virtual) so they're skipped - `populateChildFields` fills those in
 * separately regardless of this list.
 *
 * `include` names (matched against `EntryColumnNode.fieldName`, not a dotted
 * path) opt specific otherwise-excluded fields back in - see
 * `DryListOptions.include` in `dry-reader.ts`. `get()`/`findEntry` never call
 * this; they always fetch every column (`SELECT *`), so this only shapes
 * `list()`'s result.
 */
export function listSelectColumnNames(nodes: EntryFieldNode[], include: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const node of nodes) {
    if (node.kind === "column") {
      if (isExcludableFromList(node) && !include.has(node.fieldName)) continue;
      out.push(node.columnName);
    } else if (node.kind === "flatten") {
      out.push(...listSelectColumnNames(node.children, include));
    } else if (node.kind === "relation" && node.columnName) {
      out.push(node.columnName);
    }
  }
  return out;
}

/**
 * The entry-data counterpart to `tree.ts`'s `resolveTableTree`: same walk,
 * same field-id-keyed matching against the resolved `TableNode`, but keyed by
 * *field name* (for reading/writing entry values) instead of SQL identity.
 * Includes the synthetic system fields (`title`/`slug`/`draft`/.../`seo`) a
 * `features` toggle implies, PLUS the synthetic `relationmirror` fields
 * `relationMirrorFieldsFor` derives from every OTHER type's `relation` fields
 * targeting this one - unlike `resolveTableTree`'s real (front-of-`fields[]`)
 * column order, this DISPLAY order defaults to `type.fields` FIRST, both auto
 * groups appended after, then permuted by `type.fieldOrder` (see `types.ts`)
 * on top - so system, custom, and mirror fields can freely interleave on
 * screen without touching the underlying table.
 */
export function buildEntryFieldTree(type: ContentTypeDefinition, allTypes: ContentTypeDefinition[]): EntryFieldNode[] {
  const componentsById = new Map(allTypes.filter((t) => t.kind === "component").map((t) => [t.id, t]));
  const rootTree = resolveTableTree(type, allTypes);
  const rootFields = applyFieldOrder(
    [...activeFields(type), ...activeSystemFieldsFor(type), ...relationMirrorFieldsFor(type, allTypes)],
    type.fieldOrder,
  );
  return buildNodes(rootFields, rootTree, componentsById, allTypes);
}
