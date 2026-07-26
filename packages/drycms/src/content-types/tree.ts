import type { ComponentFieldConfig, RelationFieldConfig, SqlColumnType } from "./field-registry.js";
import { fieldTypes, resolveFieldShape, resolveFts } from "./field-registry.js";
import { systemFieldsFor } from "./system-fields.js";
import type { ContentTypeDefinition, FieldDefinition } from "./types.js";

export interface ColumnSpec {
  /** Final, already-prefixed SQL column name. */
  name: string;
  sqlType: SqlColumnType;
  /** The diff key: the field-id chain that produced this column, local to
   * the table it lives in (not globally - a child table's own path starts
   * fresh). */
  localIdPath: string[];
  fts: boolean;
  unique: boolean;
  /** Raw (pre-`serialize()`) default from the `FieldDefinition`. */
  default?: unknown;
  /** Registry key, needed by `migration.ts` to call `serialize()`/encode a
   * literal for `DEFAULT` clauses at DDL-generation time. */
  fieldType: string;
  fieldConfig: unknown;
}

export interface ChildTableRef {
  /** Diff key for this child table, local to the parent it's declared in. */
  localIdPath: string[];
  tableName: string;
  node: TableNode;
  kind: "component-repeat" | "relation-many";
}

export interface TableNode {
  tableName: string;
  tableKind: "root-collection" | "root-singleton" | "child";
  columns: ColumnSpec[];
  children: ChildTableRef[];
  /** Column names eligible for FTS (root tables only in v1). */
  ftsColumns: string[];
}

class TreeResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TreeResolutionError";
  }
}

/** Every table name a resolved tree produces: the root plus every child
 * table, recursively. Used to detect a physical table-name collision
 * between two different content types (e.g. a repeatable field generating
 * `posts_categories` while another type is literally named that). */
export function collectTableNames(node: TableNode): string[] {
  const names = [node.tableName];
  for (const child of node.children) names.push(...collectTableNames(child.node));
  return names;
}

/** Every repeatable-component/relation-many child table gets these fixed
 * synthetic columns; they are never user-diffable (no id in `metadata`
 * produces them, they're implicit in `tableKind: 'child'`), so their
 * `localIdPath` uses a synthetic id namespace that can never collide with a
 * real field id. */
const SYSTEM_ID_COL: ColumnSpec = {
  name: "id",
  sqlType: "INTEGER",
  localIdPath: ["__child_id"],
  fts: false,
  unique: false,
  fieldType: "__system_pk",
  fieldConfig: {},
};
const PARENT_ID_COL: ColumnSpec = {
  name: "parent_id",
  sqlType: "INTEGER",
  localIdPath: ["__child_parent_id"],
  fts: false,
  unique: false,
  fieldType: "__system_fk",
  fieldConfig: {},
};
const POSITION_COL: ColumnSpec = {
  name: "position",
  sqlType: "INTEGER",
  localIdPath: ["__child_position"],
  fts: false,
  unique: false,
  fieldType: "__system_position",
  fieldConfig: {},
};
const TARGET_ID_COL: ColumnSpec = {
  name: "target_id",
  sqlType: "INTEGER",
  localIdPath: ["__child_target_id"],
  fts: false,
  unique: false,
  fieldType: "__system_fk",
  fieldConfig: {},
};

/**
 * Recursively resolves a `collection`/`singleton` content type's declared
 * fields (plus its system fields) into the physical table(s) it produces -
 * the root table itself, plus one `TableNode` per repeatable-component or
 * relation-many field, however deeply nested inside non-repeatable
 * components. `component` references are resolved against `allTypes`.
 */
export function resolveTableTree(type: ContentTypeDefinition, allTypes: ContentTypeDefinition[]): TableNode {
  const componentsById = new Map(allTypes.filter((t) => t.kind === "component").map((t) => [t.id, t]));

  function buildComponentChildTable(tableName: string, componentId: string, seen: ReadonlySet<string>): TableNode {
    const component = componentsById.get(componentId);
    if (!component) {
      throw new TreeResolutionError(`Referenced component "${componentId}" does not exist.`);
    }
    if (seen.has(component.id)) {
      throw new TreeResolutionError(`Circular component reference via "${component.id}".`);
    }
    // Child tables are out of FTS scope in v1 (see status/content-type-ui.md) -
    // always resolved with fullSearch off, regardless of the root's own setting.
    const inner = buildTable(tableName, "child", component.fields, new Set([...seen, component.id]), false);
    return { ...inner, columns: [SYSTEM_ID_COL, PARENT_ID_COL, POSITION_COL, ...inner.columns] };
  }

  function buildRelationChildTable(tableName: string): TableNode {
    return {
      tableName,
      tableKind: "child",
      columns: [SYSTEM_ID_COL, PARENT_ID_COL, POSITION_COL, TARGET_ID_COL],
      children: [],
      ftsColumns: [],
    };
  }

  function buildTable(
    tableName: string,
    tableKind: TableNode["tableKind"],
    ownFields: FieldDefinition[],
    seenComponentIds: ReadonlySet<string>,
    fullSearchEnabled: boolean,
  ): TableNode {
    const columns: ColumnSpec[] = [];
    const children: ChildTableRef[] = [];

    function walk(fields: FieldDefinition[], namePrefix: string[], idPrefix: string[], seen: ReadonlySet<string>) {
      for (const field of fields) {
        const fieldType = fieldTypes[field.type];
        if (!fieldType) {
          throw new TreeResolutionError(`Unknown field type "${field.type}" on field "${field.id}".`);
        }
        const shape = resolveFieldShape(fieldType, field.config);
        const idPath = [...idPrefix, field.id];

        if (shape === "column") {
          const sqlType = fieldType.sqlType?.(field.config as Record<string, unknown>);
          if (!sqlType) {
            throw new TreeResolutionError(
              `Field type "${field.type}" resolves to 'column' shape but declares no sqlType() (field "${field.id}").`,
            );
          }
          columns.push({
            name: [...namePrefix, field.name].join("_"),
            sqlType,
            localIdPath: idPath,
            fts: resolveFts(fieldType, field.config as Record<string, unknown>),
            unique: !!field.validation.unique,
            default: field.default,
            fieldType: field.type,
            fieldConfig: field.config,
          });
        } else if (shape === "flatten") {
          const { componentId } = field.config as ComponentFieldConfig;
          const component = componentsById.get(componentId);
          if (!component) {
            throw new TreeResolutionError(
              `Field "${field.name}" (${field.id}) references missing component "${componentId}".`,
            );
          }
          if (seen.has(component.id)) {
            throw new TreeResolutionError(`Circular component reference via "${component.id}".`);
          }
          walk(component.fields, [...namePrefix, field.name], idPath, new Set([...seen, component.id]));
        } else {
          // child-table: repeatable component, or relation with cardinality 'many'.
          // Table name inherits the FULL local flatten-prefix chain (not just
          // this field's own name) so two different flattened branches that
          // each contain a same-named repeatable field don't collide.
          const childTableName = [tableName, ...namePrefix, field.name].join("_");
          const config = field.config as ComponentFieldConfig | RelationFieldConfig;
          const isComponent = "componentId" in config;
          const childNode = isComponent
            ? buildComponentChildTable(childTableName, config.componentId, seen)
            : buildRelationChildTable(childTableName);
          children.push({
            localIdPath: idPath,
            tableName: childTableName,
            node: childNode,
            kind: isComponent ? "component-repeat" : "relation-many",
          });
        }
      }
    }

    walk(ownFields, [], [], seenComponentIds);
    const ftsColumns = fullSearchEnabled ? columns.filter((c) => c.fts).map((c) => c.name) : [];
    return { tableName, tableKind, columns, children, ftsColumns };
  }

  const rootFields = [...systemFieldsFor(type), ...type.fields];
  return buildTable(
    type.name,
    type.kind === "singleton" ? "root-singleton" : "root-collection",
    rootFields,
    new Set(),
    !!type.features?.fullSearch,
  );
}

/**
 * Every collection/singleton that (transitively, through nested components)
 * embeds `componentId`. Used to fan a component's own save out to every
 * dependent whose derived table(s) need rebuilding even though that
 * dependent's own `fields` didn't change.
 */
export function findDependents(componentId: string, allTypes: ContentTypeDefinition[]): ContentTypeDefinition[] {
  function directReferrersOf(id: string, seen: Set<string>): ContentTypeDefinition[] {
    if (seen.has(id)) return [];
    seen.add(id);
    return allTypes.filter((t) =>
      t.fields.some((f) => f.type === "component" && (f.config as ComponentFieldConfig).componentId === id),
    );
  }

  const roots = new Map<string, ContentTypeDefinition>();
  const visitedComponentIds = new Set<string>();

  function visit(id: string) {
    for (const referrer of directReferrersOf(id, visitedComponentIds)) {
      if (referrer.kind === "component") {
        visit(referrer.id);
      } else {
        roots.set(referrer.id, referrer);
      }
    }
  }

  visit(componentId);
  return [...roots.values()];
}
