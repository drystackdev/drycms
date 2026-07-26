import { fieldTypes, type SqlColumnType } from "./field-registry.js";
import { quoteIdent, toSqlLiteral } from "./naming.js";
import { findDependents, resolveTableTree, type ChildTableRef, type ColumnSpec, type TableNode } from "./tree.js";
import type { ContentTypeDefinition } from "./types.js";

export interface Statement {
  sql: string;
  /** Bound parameters for `?` placeholders - only the metadata upsert
   * statement uses these (arbitrary JSON/text values); every DDL statement
   * embeds identifiers/literals directly (see `naming.ts`) and leaves this
   * empty, since identifiers can never be bound as query parameters. */
  params?: unknown[];
  /** Human-readable, for logs/dry-run display. */
  description: string;
}

export type DestructiveChange =
  | { kind: "drop-column"; tableName: string; columnName: string }
  | { kind: "drop-table"; tableName: string }
  | { kind: "shape-changed"; tableName: string; columnOrField: string; from: string; to: string }
  | { kind: "lossy-retype"; tableName: string; columnName: string; from: SqlColumnType; to: SqlColumnType };

export interface TableMigration {
  tableName: string;
  action: "create" | "alter" | "recreate" | "drop" | "noop";
  statements: Statement[];
  destructive: DestructiveChange[];
}

export interface MigrationPlan {
  targetContentTypeId: string;
  /** Execution-order-safe: children created after their parent, dropped
   * before their parent. */
  tables: TableMigration[];
  metadataStatement: Statement;
  expectedVersion: number;
  nextVersion: number;
}

export interface SavePlan {
  primary: MigrationPlan;
  /** Only non-empty when saving a `component` - one plan per transitive
   * dependent whose derived table(s) need rebuilding. */
  cascaded: MigrationPlan[];
  destructiveSummary: DestructiveChange[];
}

function leafId(path: string[]): string {
  // `localIdPath` is always non-empty by construction (every column/child
  // table is produced by walking at least one field).
  return path[path.length - 1]!;
}

function defaultLiteralFor(col: ColumnSpec): string | undefined {
  if (col.default === undefined) return undefined;
  const fieldType = fieldTypes[col.fieldType];
  const serialized = fieldType?.serialize ? fieldType.serialize(col.default) : col.default;
  return toSqlLiteral(serialized);
}

function columnDefSql(col: ColumnSpec): string {
  const def = defaultLiteralFor(col);
  return `${quoteIdent(col.name)} ${col.sqlType}${def !== undefined ? ` DEFAULT ${def}` : ""}`;
}

function uniqueIndexName(tableName: string, columnName: string): string {
  return `ux_${tableName}_${columnName}`;
}

function createUniqueIndexStatement(tableName: string, col: ColumnSpec): Statement {
  const name = uniqueIndexName(tableName, col.name);
  return {
    sql: `CREATE UNIQUE INDEX ${quoteIdent(name)} ON ${quoteIdent(tableName)}(${quoteIdent(col.name)});`,
    description: `Unique index on ${tableName}.${col.name}`,
  };
}

function dropUniqueIndexStatement(tableName: string, columnName: string): Statement {
  const name = uniqueIndexName(tableName, columnName);
  return { sql: `DROP INDEX IF EXISTS ${quoteIdent(name)};`, description: `Drop unique index on ${tableName}.${columnName}` };
}

function titleIndexName(tableName: string): string {
  return `ix_${tableName}_title`;
}

function dropTitleIndexStatement(tableName: string): Statement {
  const name = titleIndexName(tableName);
  return { sql: `DROP INDEX IF EXISTS ${quoteIdent(name)};`, description: `Drop title index on ${tableName}` };
}

// ---------------------------------------------------------------------------
// FTS5
// ---------------------------------------------------------------------------

function ftsTableName(tableName: string): string {
  return `${tableName}_fts`;
}

function ftsTriggerNames(tableName: string): { ai: string; au: string; ad: string } {
  const base = ftsTableName(tableName);
  return { ai: `${base}_ai`, au: `${base}_au`, ad: `${base}_ad` };
}

function dropFtsStatements(tableName: string): Statement[] {
  const { ai, au, ad } = ftsTriggerNames(tableName);
  const fts = ftsTableName(tableName);
  return [
    { sql: `DROP TRIGGER IF EXISTS ${quoteIdent(ai)};`, description: `Drop FTS insert trigger for ${tableName}` },
    { sql: `DROP TRIGGER IF EXISTS ${quoteIdent(au)};`, description: `Drop FTS update trigger for ${tableName}` },
    { sql: `DROP TRIGGER IF EXISTS ${quoteIdent(ad)};`, description: `Drop FTS delete trigger for ${tableName}` },
    { sql: `DROP TABLE IF EXISTS ${quoteIdent(fts)};`, description: `Drop FTS table for ${tableName}` },
  ];
}

function createFtsStatements(tableName: string, ftsColumns: string[]): Statement[] {
  if (ftsColumns.length === 0) return [];
  const fts = ftsTableName(tableName);
  const { ai, au, ad } = ftsTriggerNames(tableName);
  const colList = ftsColumns.map(quoteIdent).join(", ");
  const newColList = ftsColumns.map((c) => `new.${quoteIdent(c)}`).join(", ");
  const oldColList = ftsColumns.map((c) => `old.${quoteIdent(c)}`).join(", ");

  return [
    {
      sql: `CREATE VIRTUAL TABLE ${quoteIdent(fts)} USING fts5(${colList}, content=${toSqlLiteral(tableName)}, content_rowid='id');`,
      description: `Create FTS table for ${tableName}`,
    },
    {
      sql: `INSERT INTO ${quoteIdent(fts)}(rowid, ${colList}) SELECT "id", ${colList} FROM ${quoteIdent(tableName)};`,
      description: `Backfill FTS table for ${tableName}`,
    },
    {
      sql: `CREATE TRIGGER ${quoteIdent(ai)} AFTER INSERT ON ${quoteIdent(tableName)} BEGIN INSERT INTO ${quoteIdent(fts)}(rowid, ${colList}) VALUES (new."id", ${newColList}); END;`,
      description: `Create FTS insert trigger for ${tableName}`,
    },
    {
      sql: `CREATE TRIGGER ${quoteIdent(ad)} AFTER DELETE ON ${quoteIdent(tableName)} BEGIN INSERT INTO ${quoteIdent(fts)}(${quoteIdent(fts)}, rowid, ${colList}) VALUES ('delete', old."id", ${oldColList}); END;`,
      description: `Create FTS delete trigger for ${tableName}`,
    },
    {
      sql:
        `CREATE TRIGGER ${quoteIdent(au)} AFTER UPDATE ON ${quoteIdent(tableName)} BEGIN ` +
        `INSERT INTO ${quoteIdent(fts)}(${quoteIdent(fts)}, rowid, ${colList}) VALUES ('delete', old."id", ${oldColList}); ` +
        `INSERT INTO ${quoteIdent(fts)}(rowid, ${colList}) VALUES (new."id", ${newColList}); END;`,
      description: `Create FTS update trigger for ${tableName}`,
    },
  ];
}

// ---------------------------------------------------------------------------
// CREATE TABLE
// ---------------------------------------------------------------------------

function createTableStatements(node: TableNode): Statement[] {
  // Child tables already carry a synthetic `id` ColumnSpec (name "id") as
  // columns[0] - render it as the real PK instead of a plain column; root
  // tables don't have one in `columns` (system fields start at `title`), so
  // the PK is prepended unconditionally and never duplicated either way.
  const rest = node.tableKind === "child" ? node.columns.slice(1) : node.columns;
  const columnDefs = [`${quoteIdent("id")} INTEGER PRIMARY KEY AUTOINCREMENT`, ...rest.map(columnDefSql)];

  const statements: Statement[] = [
    {
      sql: `CREATE TABLE ${quoteIdent(node.tableName)} (\n  ${columnDefs.join(",\n  ")}\n);`,
      description: `Create table ${node.tableName}`,
    },
  ];

  if (node.tableKind !== "child") {
    const titleCol = node.columns.find((c) => c.name === "title");
    if (titleCol) {
      statements.push({
        sql: `CREATE INDEX ${quoteIdent(titleIndexName(node.tableName))} ON ${quoteIdent(node.tableName)}(${quoteIdent(titleCol.name)});`,
        description: `Index ${node.tableName}.title`,
      });
    }
  }

  for (const col of rest) {
    if (col.unique) statements.push(createUniqueIndexStatement(node.tableName, col));
  }

  statements.push(...createFtsStatements(node.tableName, node.ftsColumns));

  return statements;
}

function dropTableStatements(tableName: string, hadFts: boolean): Statement[] {
  const statements: Statement[] = [];
  if (hadFts) statements.push(...dropFtsStatements(tableName));
  statements.push({ sql: `DROP TABLE ${quoteIdent(tableName)};`, description: `Drop table ${tableName}` });
  return statements;
}

// ---------------------------------------------------------------------------
// Column diff (both old and new table exist)
// ---------------------------------------------------------------------------

interface ColumnDiff {
  adds: ColumnSpec[];
  drops: ColumnSpec[];
  renames: { from: ColumnSpec; to: ColumnSpec }[];
  retypes: { from: ColumnSpec; to: ColumnSpec }[];
  /** `oldColumnName` is the name the column had (and the unique index was
   * created under) BEFORE this diff's renames apply - needed because
   * SQLite's `RENAME COLUMN` repoints an existing index at the new column
   * without renaming the index itself, so a same-save rename+unique-drop
   * must target the OLD name to actually find it. */
  uniqueToggles: { column: ColumnSpec; oldColumnName: string; nowUnique: boolean }[];
  destructive: DestructiveChange[];
}

function diffColumns(oldNode: TableNode, newNode: TableNode): ColumnDiff {
  const oldByLeaf = new Map(oldNode.columns.map((c) => [leafId(c.localIdPath), c]));
  const newByLeaf = new Map(newNode.columns.map((c) => [leafId(c.localIdPath), c]));
  const oldChildIds = new Set(oldNode.children.map((c) => leafId(c.localIdPath)));
  const newChildIds = new Set(newNode.children.map((c) => leafId(c.localIdPath)));
  const allIds = new Set([...oldByLeaf.keys(), ...newByLeaf.keys()]);

  const diff: ColumnDiff = { adds: [], drops: [], renames: [], retypes: [], uniqueToggles: [], destructive: [] };

  for (const id of allIds) {
    const oldCol = oldByLeaf.get(id);
    const newCol = newByLeaf.get(id);

    if (oldCol && newCol) {
      if (oldCol.sqlType !== newCol.sqlType) {
        diff.retypes.push({ from: oldCol, to: newCol });
        diff.destructive.push({
          kind: "lossy-retype",
          tableName: newNode.tableName,
          columnName: newCol.name,
          from: oldCol.sqlType,
          to: newCol.sqlType,
        });
      } else if (oldCol.name !== newCol.name) {
        diff.renames.push({ from: oldCol, to: newCol });
      }
      if (oldCol.unique !== newCol.unique) {
        diff.uniqueToggles.push({ column: newCol, oldColumnName: oldCol.name, nowUnique: newCol.unique });
      }
      continue;
    }

    // Shape-changed: this leaf id is a column on one side, a child-table
    // field on the other - report once as shape-changed instead of a plain
    // drop/add, but still emit the physical column drop/add either way.
    if (newCol && !oldCol) {
      diff.adds.push(newCol);
      if (oldChildIds.has(id)) {
        diff.destructive.push({
          kind: "shape-changed",
          tableName: newNode.tableName,
          columnOrField: newCol.name,
          from: "child-table",
          to: "column",
        });
      }
    } else if (oldCol && !newCol) {
      diff.drops.push(oldCol);
      diff.destructive.push(
        newChildIds.has(id)
          ? { kind: "shape-changed", tableName: oldNode.tableName, columnOrField: oldCol.name, from: "column", to: "child-table" }
          : { kind: "drop-column", tableName: oldNode.tableName, columnName: oldCol.name },
      );
    }
  }

  return diff;
}

function alterTableStatements(tableName: string, diff: ColumnDiff): Statement[] {
  const statements: Statement[] = [];

  for (const col of diff.drops) {
    if (col.unique) statements.push(dropUniqueIndexStatement(tableName, col.name));
    if (col.name === "title") statements.push(dropTitleIndexStatement(tableName));
    statements.push({ sql: `ALTER TABLE ${quoteIdent(tableName)} DROP COLUMN ${quoteIdent(col.name)};`, description: `Drop ${tableName}.${col.name}` });
  }

  // Two-phase temp-name swap, unconditionally, to avoid rename-cycle
  // collisions (e.g. A -> B while B -> A in the same save).
  diff.renames.forEach(({ from }, index) => {
    statements.push({
      sql: `ALTER TABLE ${quoteIdent(tableName)} RENAME COLUMN ${quoteIdent(from.name)} TO ${quoteIdent(`__rename_tmp_${index}`)};`,
      description: `Rename ${tableName}.${from.name} (phase 1)`,
    });
  });
  diff.renames.forEach(({ to }, index) => {
    statements.push({
      sql: `ALTER TABLE ${quoteIdent(tableName)} RENAME COLUMN ${quoteIdent(`__rename_tmp_${index}`)} TO ${quoteIdent(to.name)};`,
      description: `Rename ${tableName}.${to.name} (phase 2)`,
    });
  });

  for (const col of diff.adds) {
    statements.push({ sql: `ALTER TABLE ${quoteIdent(tableName)} ADD COLUMN ${columnDefSql(col)};`, description: `Add ${tableName}.${col.name}` });
  }

  for (const { column, oldColumnName, nowUnique } of diff.uniqueToggles) {
    statements.push(
      nowUnique ? createUniqueIndexStatement(tableName, column) : dropUniqueIndexStatement(tableName, oldColumnName),
    );
  }

  return statements;
}

/**
 * SQLite has no `ALTER COLUMN TYPE` - a retype forces the standard 12-step
 * recreate procedure for the WHOLE table, which absorbs every other pending
 * add/rename/drop for that table for free by writing the final schema
 * directly (never mixed with native ALTERs for the same table in the same
 * save). Does NOT include `PRAGMA foreign_keys=OFF`/`BEGIN`/`COMMIT` - those
 * are transaction-wide, not per-table, so the adapter wraps the whole
 * `SavePlan` (every table's statements + the metadata statement) in exactly
 * one transaction, toggling `foreign_keys` off only when at least one table
 * in the plan needs a recreate.
 */
function recreateTableStatements(oldNode: TableNode, newNode: TableNode, diff: ColumnDiff): Statement[] {
  const tmpName = `${newNode.tableName}__migrate_tmp`;
  const rest = newNode.tableKind === "child" ? newNode.columns.slice(1) : newNode.columns;
  const columnDefs = [`${quoteIdent("id")} INTEGER PRIMARY KEY AUTOINCREMENT`, ...rest.map(columnDefSql)];

  const oldByLeaf = new Map(oldNode.columns.map((c) => [leafId(c.localIdPath), c]));
  const selectExprs = rest.map((col) => {
    const oldCol = oldByLeaf.get(leafId(col.localIdPath));
    if (!oldCol) return "NULL"; // newly-added column - no prior data.
    const expr = quoteIdent(oldCol.name);
    return oldCol.sqlType === col.sqlType ? expr : `CAST(${expr} AS ${col.sqlType})`;
  });

  const statements: Statement[] = [
    {
      sql: `CREATE TABLE ${quoteIdent(tmpName)} (\n  ${columnDefs.join(",\n  ")}\n);`,
      description: `Create rebuild target for ${newNode.tableName}`,
    },
    {
      // Explicitly preserving "id" is load-bearing: every child table's
      // parent_id/target_id references these values by number, so
      // preserving them means no child table needs touching just because
      // its parent got rebuilt.
      sql:
        `INSERT INTO ${quoteIdent(tmpName)} ("id", ${rest.map((c) => quoteIdent(c.name)).join(", ")})\n` +
        `SELECT "id", ${selectExprs.join(", ")} FROM ${quoteIdent(oldNode.tableName)};`,
      description: `Copy data into rebuilt ${newNode.tableName}`,
    },
    ...(oldNode.ftsColumns.length > 0 ? dropFtsStatements(oldNode.tableName) : []),
    { sql: `DROP TABLE ${quoteIdent(oldNode.tableName)};`, description: `Drop old ${oldNode.tableName}` },
    {
      sql: `ALTER TABLE ${quoteIdent(tmpName)} RENAME TO ${quoteIdent(newNode.tableName)};`,
      description: `Promote rebuilt table to ${newNode.tableName}`,
    },
  ];

  if (newNode.tableKind !== "child") {
    const titleCol = rest.find((c) => c.name === "title");
    if (titleCol) {
      statements.push({
        sql: `CREATE INDEX ${quoteIdent(titleIndexName(newNode.tableName))} ON ${quoteIdent(newNode.tableName)}(${quoteIdent(titleCol.name)});`,
        description: `Re-index ${newNode.tableName}.title`,
      });
    }
  }
  for (const col of rest) {
    if (col.unique) statements.push(createUniqueIndexStatement(newNode.tableName, col));
  }
  statements.push(...createFtsStatements(newNode.tableName, newNode.ftsColumns));

  // No generated DDL declares a `FOREIGN KEY`/`REFERENCES` yet (`parent_id`/
  // `target_id` are plain `INTEGER` columns) - this currently verifies
  // nothing, but is correct groundwork for when those columns do, and is
  // cheap/harmless to run either way.
  statements.push(
    { sql: "PRAGMA foreign_key_check;", description: "Verify FK integrity after rebuild" },
  );

  return statements;
}

// ---------------------------------------------------------------------------
// Table-pair walk (root + every child table, recursively)
// ---------------------------------------------------------------------------

function diffOneTable(oldNode: TableNode | undefined, newNode: TableNode | undefined): TableMigration | undefined {
  if (!oldNode && !newNode) return undefined;

  if (!oldNode && newNode) {
    return { tableName: newNode.tableName, action: "create", statements: createTableStatements(newNode), destructive: [] };
  }

  if (oldNode && !newNode) {
    return {
      tableName: oldNode.tableName,
      action: "drop",
      statements: dropTableStatements(oldNode.tableName, oldNode.ftsColumns.length > 0),
      destructive: [{ kind: "drop-table", tableName: oldNode.tableName }],
    };
  }

  // Both exist.
  const old = oldNode!;
  const next = newNode!;
  const diff = diffColumns(old, next);
  const ftsChanged = old.ftsColumns.join(",") !== next.ftsColumns.join(",");

  if (diff.retypes.length > 0) {
    return {
      tableName: next.tableName,
      action: "recreate",
      statements: recreateTableStatements(old, next, diff),
      destructive: diff.destructive,
    };
  }

  const tableRenamed = old.tableName !== next.tableName;
  const hasChange = diff.adds.length > 0 || diff.drops.length > 0 || diff.renames.length > 0 || diff.uniqueToggles.length > 0;
  if (!hasChange && !ftsChanged && !tableRenamed) {
    return { tableName: next.tableName, action: "noop", statements: [], destructive: [] };
  }

  const statements: Statement[] = [];
  if (tableRenamed) {
    // Renamed FIRST - every statement after this (column ops, unique index
    // names, FTS) targets the table under its FINAL name, so a later
    // migration recomputing index/FTS names from the tree never mismatches
    // what this one actually created.
    if (old.ftsColumns.length > 0) statements.push(...dropFtsStatements(old.tableName));
    statements.push({
      sql: `ALTER TABLE ${quoteIdent(old.tableName)} RENAME TO ${quoteIdent(next.tableName)};`,
      description: `Rename table ${old.tableName} to ${next.tableName}`,
    });
  } else if (ftsChanged && old.ftsColumns.length > 0) {
    // Must drop BEFORE the column ops below - the old triggers reference
    // the old column set (e.g. `new.title`), and SQLite validates trigger
    // bodies against the post-drop schema during `ALTER TABLE ... DROP
    // COLUMN`, so a stale trigger referencing a dropped column fails the
    // whole statement.
    statements.push(...dropFtsStatements(old.tableName));
  }
  statements.push(...alterTableStatements(next.tableName, diff));
  // FTS5 doesn't support in-place column add/remove - whenever the eligible
  // column set changes, rebuild it fully after the base table's own
  // migration is applied (needs the FINAL column names/set).
  if (ftsChanged) {
    statements.push(...createFtsStatements(next.tableName, next.ftsColumns));
  } else if (tableRenamed && old.ftsColumns.length > 0) {
    // Not otherwise rebuilt this pass (column set unchanged) - just needs to
    // exist again under the new table name (dropped above as part of rename).
    statements.push(...createFtsStatements(next.tableName, next.ftsColumns));
  }

  return {
    tableName: next.tableName,
    action: hasChange || ftsChanged || tableRenamed ? "alter" : "noop",
    statements,
    destructive: diff.destructive,
  };
}

/** Pushes each table's migration pre-order (parent before children) for
 * every action except `drop`, which pushes post-order (children before
 * parent) instead - matching `MigrationPlan.tables`' documented invariant.
 * A `create` needs its parent to exist before a child can reference it; a
 * `drop` needs the opposite, a child gone before its parent can be dropped. */
function walkTablePair(oldNode: TableNode | undefined, newNode: TableNode | undefined, out: TableMigration[]): void {
  const migration = diffOneTable(oldNode, newNode);
  const isDrop = migration?.action === "drop";
  if (migration && migration.action !== "noop" && !isDrop) out.push(migration);

  const oldChildren = new Map<string, ChildTableRef>((oldNode?.children ?? []).map((c) => [c.localIdPath.join("/"), c]));
  const newChildren = new Map<string, ChildTableRef>((newNode?.children ?? []).map((c) => [c.localIdPath.join("/"), c]));
  const allKeys = new Set([...oldChildren.keys(), ...newChildren.keys()]);

  for (const key of allKeys) {
    walkTablePair(oldChildren.get(key)?.node, newChildren.get(key)?.node, out);
  }

  if (migration && isDrop) out.push(migration);
}

// ---------------------------------------------------------------------------
// Public planners
// ---------------------------------------------------------------------------

/** Plain INSERT for a brand-new id; on conflict (id already exists) only
 * updates if the row's CURRENT version still matches `expectedVersion` -
 * the optimistic-lock check. 0 rows affected on an existing id means either
 * a genuine conflict (another save landed first) or - by construction here,
 * since `expectedVersion` always comes from the just-loaded row - never a
 * "row doesn't exist" case for an update; the adapter treats "0 changes AND
 * the id already existed before this statement" as the conflict error. */
function metadataUpsertStatement(target: ContentTypeDefinition, nextVersion: number, expectedVersion: number): Statement {
  const definition = JSON.stringify({ ...target, version: nextVersion });
  return {
    sql: `INSERT INTO ${quoteIdent("metadata")} ("id","kind","name","definition","version") VALUES (?,?,?,?,?)
ON CONFLICT("id") DO UPDATE SET "kind"=excluded."kind", "name"=excluded."name", "definition"=excluded."definition", "version"=excluded."version"
WHERE ${quoteIdent("metadata")}."version" = ?;`,
    params: [target.id, target.kind, target.name, definition, nextVersion, expectedVersion],
    description: `Upsert metadata for "${target.name}" (v${nextVersion})`,
  };
}

/** Pure. Resolves the target's old and new table trees and diffs them,
 * table by table (root + every child table, recursively). `component`
 * types produce no tables of their own - `tables` is always `[]` for them. */
export function planMigration(input: {
  target: ContentTypeDefinition;
  oldAllTypes: ContentTypeDefinition[];
  newAllTypes: ContentTypeDefinition[];
}): MigrationPlan {
  const { target, oldAllTypes, newAllTypes } = input;
  const oldType = oldAllTypes.find((t) => t.id === target.id);
  const expectedVersion = oldType?.version ?? 0;
  const nextVersion = expectedVersion + 1;

  const tables: TableMigration[] = [];
  if (target.kind !== "component") {
    const oldTree = oldType ? resolveTableTree(oldType, oldAllTypes) : undefined;
    const newTree = resolveTableTree(target, newAllTypes);
    walkTablePair(oldTree, newTree, tables);
  }

  return {
    targetContentTypeId: target.id,
    tables,
    metadataStatement: metadataUpsertStatement(target, nextVersion, expectedVersion),
    expectedVersion,
    nextVersion,
  };
}

function collectTablesPostOrder(node: TableNode, out: TableNode[]): void {
  for (const child of node.children) collectTablesPostOrder(child.node, out);
  out.push(node);
}

/** DROP statements for every table a content type produces, children before
 * their parent. `component` types produce no tables - always `[]`. */
export function planDelete(target: ContentTypeDefinition, allTypes: ContentTypeDefinition[]): Statement[] {
  if (target.kind === "component") return [];
  const tree = resolveTableTree(target, allTypes);
  const tables: TableNode[] = [];
  collectTablesPostOrder(tree, tables);
  return tables.flatMap((node) => dropTableStatements(node.tableName, node.ftsColumns.length > 0));
}

/** Orchestration entry point: handles the component-cascade fan-out - saving
 * a `component` doesn't produce a table itself, but every collection/
 * singleton that (transitively) embeds it needs its own table(s) rebuilt,
 * even though that dependent's own declared `fields` didn't change. */
export function planSave(input: {
  savedType: ContentTypeDefinition;
  oldAllTypes: ContentTypeDefinition[];
  newAllTypes: ContentTypeDefinition[];
}): SavePlan {
  const { savedType, oldAllTypes, newAllTypes } = input;
  const primary = planMigration({ target: savedType, oldAllTypes, newAllTypes });

  if (savedType.kind !== "component") {
    return { primary, cascaded: [], destructiveSummary: primary.tables.flatMap((t) => t.destructive) };
  }

  const dependents = findDependents(savedType.id, newAllTypes);
  const cascaded = dependents.map((dep) => planMigration({ target: dep, oldAllTypes, newAllTypes }));
  const destructiveSummary = [primary, ...cascaded].flatMap((plan) => plan.tables.flatMap((t) => t.destructive));

  return { primary, cascaded, destructiveSummary };
}
