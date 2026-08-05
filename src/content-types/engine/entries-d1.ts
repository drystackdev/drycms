import type { ResolvedD1ContentOption } from "../../server/options.js";
import { quoteIdent } from "../naming.js";
import type { ContentTypeDefinition } from "../types.js";
import { runBatch, type D1Database } from "./d1-driver.js";
import { applyTimestamps, rowToValue, validateEntryValue, valueToRow, type EntryValue } from "./entry-codec.js";
import { blankEntryValue } from "./entry-defaults.js";
import { buildEntryFieldTree, flattenQueryableColumns, type EntryFieldNode, type QueryableColumn } from "./entry-tree.js";
import { buildPublishedOnlyClause, buildWhereClause, combineWhereClauses, type EntryWhere } from "./entry-where.js";
import { ContentEntryError, type ContentEntryEngineAdapter, type EntryPage, type EntryQuery, type EntryRow } from "./entries-types.js";

/** Same escaping as `entries-sqlite.ts` - kept as its own small copy rather
 * than a shared import, matching how `engine/sqlite.ts`/`engine/d1.ts`
 * already fully duplicate their structure instead of sharing an abstraction
 * across the sync (`SqliteHandle`)/async (`D1Database`) divide. */
function escapeLikeTerm(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function translateUniqueViolation(error: unknown, queryable: QueryableColumn[]): ContentEntryError | null {
  const message = error instanceof Error ? error.message : String(error);
  const match = /UNIQUE constraint failed: [^.]+\.(.+?)(:|$)/.exec(message);
  if (!match) return null;
  const columnName = match[1]!;
  const column = queryable.find((c) => c.columnName === columnName);
  const label = column?.label ?? columnName;
  return new ContentEntryError("validation_failed", `"${label}" is already in use.`, {
    [column?.fieldName ?? columnName]: `"${label}" is already in use.`,
  });
}

async function dbAll<T = unknown>(db: D1Database, sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await db.prepare(sql).bind(...params).all<T>();
  return result.results ?? [];
}

async function dbRun(db: D1Database, sql: string, params: unknown[] = []): Promise<{ lastInsertRowid: number }> {
  const result = await db.prepare(sql).bind(...params).run();
  return { lastInsertRowid: Number(result.meta.last_row_id ?? 0) };
}

async function populateChildFields(db: D1Database, nodes: EntryFieldNode[], parentId: number, value: EntryValue): Promise<void> {
  for (const node of nodes) {
    if (node.kind === "flatten") {
      await populateChildFields(db, node.children, parentId, value[node.fieldName] as EntryValue);
    } else if (node.kind === "component-repeat") {
      const rows = await dbAll<Record<string, unknown>>(
        db,
        `SELECT * FROM ${quoteIdent(node.tableName)} WHERE "parent_id" = ? ORDER BY "position" ASC;`,
        [parentId],
      );
      const items: EntryValue[] = [];
      for (const row of rows) {
        const item = rowToValue(node.itemFields, row);
        await populateChildFields(db, node.itemFields, Number(row.id), item);
        items.push(item);
      }
      value[node.fieldName] = items;
    } else if (node.kind === "relation" && node.tableName) {
      const rows = await dbAll<{ target_id: number }>(
        db,
        `SELECT "target_id" FROM ${quoteIdent(node.tableName)} WHERE "parent_id" = ? ORDER BY "position" ASC;`,
        [parentId],
      );
      value[node.fieldName] = rows.map((r) => Number(r.target_id));
    } else if (node.kind === "relation-mirror" && node.resolved) {
      if (node.sourceColumnName) {
        // reverse oneToMany (source was manyToOne) - many source rows may point at me.
        const rows = await dbAll<{ id: number }>(
          db,
          `SELECT "id" FROM ${quoteIdent(node.sourceTableName)} WHERE ${quoteIdent(node.sourceColumnName)} = ? ORDER BY "id" ASC;`,
          [parentId],
        );
        value[node.fieldName] = rows.map((r) => Number(r.id));
      } else if (node.reverseCardinality === "manyToOne") {
        // reverse manyToOne (source was oneToMany) - at most 1 row, UNIQUE target_id.
        const rows = await dbAll<{ parent_id: number }>(
          db,
          `SELECT "parent_id" FROM ${quoteIdent(node.sourceChildTableName!)} WHERE "target_id" = ?;`,
          [parentId],
        );
        value[node.fieldName] = rows[0] ? Number(rows[0].parent_id) : null;
      } else {
        // reverse manyToMany (source was manyToMany) - ordered by the child
        // table's own synthetic id (insertion order), NOT "position" - see
        // entries-sqlite.ts's identical branch for why.
        const rows = await dbAll<{ parent_id: number }>(
          db,
          `SELECT "parent_id" FROM ${quoteIdent(node.sourceChildTableName!)} WHERE "target_id" = ? ORDER BY "id" ASC;`,
          [parentId],
        );
        value[node.fieldName] = rows.map((r) => Number(r.parent_id));
      }
    }
  }
}

async function deleteChildFields(db: D1Database, nodes: EntryFieldNode[], parentId: number): Promise<void> {
  for (const node of nodes) {
    if (node.kind === "flatten") {
      await deleteChildFields(db, node.children, parentId);
    } else if (node.kind === "component-repeat") {
      const rows = await dbAll<{ id: number }>(db, `SELECT "id" FROM ${quoteIdent(node.tableName)} WHERE "parent_id" = ?;`, [
        parentId,
      ]);
      for (const row of rows) await deleteChildFields(db, node.itemFields, Number(row.id));
      await dbRun(db, `DELETE FROM ${quoteIdent(node.tableName)} WHERE "parent_id" = ?;`, [parentId]);
    } else if (node.kind === "relation" && node.tableName) {
      await dbRun(db, `DELETE FROM ${quoteIdent(node.tableName)} WHERE "parent_id" = ?;`, [parentId]);
    }
  }
}

async function writeChildFields(db: D1Database, nodes: EntryFieldNode[], parentId: number, value: EntryValue): Promise<void> {
  for (const node of nodes) {
    if (node.kind === "flatten") {
      await writeChildFields(db, node.children, parentId, (value[node.fieldName] as EntryValue) ?? {});
    } else if (node.kind === "component-repeat") {
      const oldRows = await dbAll<{ id: number }>(db, `SELECT "id" FROM ${quoteIdent(node.tableName)} WHERE "parent_id" = ?;`, [
        parentId,
      ]);
      for (const oldRow of oldRows) await deleteChildFields(db, node.itemFields, Number(oldRow.id));
      await dbRun(db, `DELETE FROM ${quoteIdent(node.tableName)} WHERE "parent_id" = ?;`, [parentId]);

      const items = Array.isArray(value[node.fieldName]) ? (value[node.fieldName] as EntryValue[]) : [];
      for (let position = 0; position < items.length; position++) {
        const itemRow = await valueToRow(node.itemFields, items[position]!);
        const columns = Object.keys(itemRow);
        const columnList = ["parent_id", "position", ...columns].map(quoteIdent).join(",");
        const placeholders = ["?", "?", ...columns.map(() => "?")].join(",");
        const result = await dbRun(db, `INSERT INTO ${quoteIdent(node.tableName)} (${columnList}) VALUES (${placeholders});`, [
          parentId,
          position,
          ...columns.map((c) => itemRow[c]),
        ]);
        await writeChildFields(db, node.itemFields, result.lastInsertRowid, items[position]!);
      }
    } else if (node.kind === "relation" && node.tableName) {
      await dbRun(db, `DELETE FROM ${quoteIdent(node.tableName)} WHERE "parent_id" = ?;`, [parentId]);
      const targetIds = Array.isArray(value[node.fieldName]) ? (value[node.fieldName] as unknown[]) : [];
      for (let position = 0; position < targetIds.length; position++) {
        const targetId = targetIds[position];
        if (typeof targetId !== "number") continue;
        await dbRun(db, `INSERT INTO ${quoteIdent(node.tableName)} ("parent_id","position","target_id") VALUES (?,?,?);`, [
          parentId,
          position,
          targetId,
        ]);
      }
    } else if (node.kind === "relation-mirror" && node.resolved) {
      await writeRelationMirror(db, node, parentId, value[node.fieldName]);
    }
  }
}

/** D1 counterpart to `entries-sqlite.ts`'s `writeRelationMirror` - same SQL,
 * same "touch only this row's links, never the mirrored field's other
 * rows/positions" contract, `await dbRun`/`dbAll` instead of `handle.run`/
 * `handle.all`. */
async function writeRelationMirror(
  db: D1Database,
  node: Extract<EntryFieldNode, { kind: "relation-mirror"; resolved: true }>,
  parentId: number,
  incoming: unknown,
): Promise<void> {
  if (node.sourceColumnName) {
    const ids = (Array.isArray(incoming) ? incoming : []).filter((v): v is number => typeof v === "number");
    const table = quoteIdent(node.sourceTableName);
    const col = quoteIdent(node.sourceColumnName);
    if (ids.length === 0) {
      await dbRun(db, `UPDATE ${table} SET ${col} = NULL WHERE ${col} = ?;`, [parentId]);
    } else {
      const placeholders = ids.map(() => "?").join(",");
      await dbRun(db, `UPDATE ${table} SET ${col} = NULL WHERE ${col} = ? AND "id" NOT IN (${placeholders});`, [parentId, ...ids]);
      await dbRun(db, `UPDATE ${table} SET ${col} = ? WHERE "id" IN (${placeholders});`, [parentId, ...ids]);
    }
    return;
  }

  const childTable = quoteIdent(node.sourceChildTableName!);
  if (node.reverseCardinality === "manyToOne") {
    await dbRun(db, `DELETE FROM ${childTable} WHERE "target_id" = ?;`, [parentId]);
    const newParentId = typeof incoming === "number" ? incoming : null;
    if (newParentId !== null) {
      await insertRelationChildRow(db, childTable, newParentId, parentId);
    }
    return;
  }

  await dbRun(db, `DELETE FROM ${childTable} WHERE "target_id" = ?;`, [parentId]);
  const newParentIds = (Array.isArray(incoming) ? incoming : []).filter((v): v is number => typeof v === "number");
  for (const newParentId of newParentIds) {
    await insertRelationChildRow(db, childTable, newParentId, parentId);
  }
}

async function insertRelationChildRow(db: D1Database, childTable: string, newParentId: number, targetId: number): Promise<void> {
  const rows = await dbAll<{ next: number }>(
    db,
    `SELECT COALESCE(MAX("position"), -1) + 1 AS next FROM ${childTable} WHERE "parent_id" = ?;`,
    [newParentId],
  );
  await dbRun(db, `INSERT INTO ${childTable} ("parent_id","position","target_id") VALUES (?,?,?);`, [
    newParentId,
    rows[0]!.next,
    targetId,
  ]);
}

function assertValid(nodes: EntryFieldNode[], value: EntryValue): void {
  const errors = validateEntryValue(nodes, value);
  if (Object.keys(errors).length > 0) {
    throw new ContentEntryError("validation_failed", "Validation failed.", errors);
  }
}

/** D1 counterpart to `entries-sqlite.ts` - see that file's doc comments for
 * the shared algorithm (child-table population/write/delete, unique-violation
 * translation). Structured as its own full implementation rather than a
 * shared abstraction over both backends, mirroring how `engine/sqlite.ts`/
 * `engine/d1.ts` (the schema engine) already do the same for the same
 * sync-vs-async-driver reason. */
export function createD1ContentEntryEngineAdapter(
  option: ResolvedD1ContentOption,
  runtimeEnv: Record<string, unknown> | undefined,
): ContentEntryEngineAdapter {
  const maybeDb = runtimeEnv?.[option.binding] as D1Database | undefined;
  if (!maybeDb) {
    throw new ContentEntryError(
      "unsupported",
      `[drycms] D1 binding "${option.binding}" was not found on the request env - check wrangler.jsonc's d1_databases config.`,
    );
  }
  const db: D1Database = maybeDb;

  // Same `_versions` table/shape as `entries-sqlite.ts`, bootstrapped lazily
  // on first use rather than eagerly (mirrors `d1.ts`'s own
  // `ensureBootstrap`, since a D1 binding is only resolvable per-request).
  let versionsBootstrapped: Promise<void> | undefined;
  async function ensureVersionsTable(): Promise<void> {
    versionsBootstrapped ??= db
      .prepare(
        `CREATE TABLE IF NOT EXISTS "_versions" (\n` +
          `  "resource" TEXT PRIMARY KEY,\n` +
          `  "version" INTEGER NOT NULL,\n` +
          `  "updated_at" INTEGER NOT NULL\n` +
          `);`,
      )
      .run()
      .then(() => undefined);
    return versionsBootstrapped;
  }

  /** `resource`'s current data version (see `status/build-cache.md`) - `0`
   * if `_versions` has no row for it yet. Distinct from
   * `ContentTypeDefinition.version` (schema version, tracked in `metadata`
   * by the schema engine - unrelated to this one). */
  async function getResourceVersionValue(resource: string): Promise<number> {
    await ensureVersionsTable();
    const rows = await dbAll<{ version: number }>(db, 'SELECT "version" FROM "_versions" WHERE "resource" = ?;', [resource]);
    return rows[0]?.version ?? 0;
  }

  /** Increments `resource`'s data version by 1. Unlike `entries-sqlite.ts`,
   * this can't share a real `BEGIN`/`COMMIT` transaction with the data write
   * that precedes it - D1 has no cross-statement transaction the way local
   * SQLite does (see `d1.ts`'s identical caveat on its own `metadata`
   * version bump). Callers `await` this only AFTER every data/child-table
   * write for the mutation has already succeeded, so the ordering guarantee
   * is "version never bumps without its data having landed first" - not
   * full atomicity; a crash between the data write and this call leaves a
   * stale (not wrong) version, self-healing on the resource's next edit. */
  async function bumpResourceVersion(resource: string): Promise<void> {
    await ensureVersionsTable();
    const next = (await getResourceVersionValue(resource)) + 1;
    await dbRun(
      db,
      'INSERT INTO "_versions" ("resource","version","updated_at") VALUES (?,?,?) ' +
        'ON CONFLICT("resource") DO UPDATE SET "version" = excluded."version", "updated_at" = excluded."updated_at";',
      [resource, next, Date.now()],
    );
  }

  async function listEntries(
    type: ContentTypeDefinition,
    allTypes: ContentTypeDefinition[],
    query: EntryQuery,
  ): Promise<EntryPage> {
    const nodes = buildEntryFieldTree(type, allTypes);
    const queryable = flattenQueryableColumns(nodes);
    const tableName = quoteIdent(type.name);

    let searchFragment: { sql: string; params: unknown[] } | null = null;
    if (query.search && query.searchableFields && query.searchableFields.length > 0) {
      const matching = queryable.filter((c) => query.searchableFields!.includes(c.fieldName));
      if (matching.length > 0) {
        const likeTerm = `%${escapeLikeTerm(query.search)}%`;
        searchFragment = {
          sql: matching.map((c) => `${quoteIdent(c.columnName)} LIKE ? ESCAPE '\\'`).join(" OR "),
          params: matching.map(() => likeTerm),
        };
      }
    }
    const whereFragment = query.where ? buildWhereClause(queryable, query.where) : null;
    const publishedFragment = query.publishedOnly ? buildPublishedOnlyClause(queryable, new Date().toISOString()) : null;
    const { sql: whereSql, params } = combineWhereClauses([searchFragment, whereFragment, publishedFragment]);

    const sortColumn = query.sortField ? queryable.find((c) => c.fieldName === query.sortField)?.columnName : undefined;
    const orderSql = sortColumn
      ? ` ORDER BY ${quoteIdent(sortColumn)} ${query.sortDir === "asc" ? "ASC" : "DESC"}`
      : ` ORDER BY "id" DESC`;

    const countRows = await dbAll<{ count: number }>(db, `SELECT COUNT(*) as count FROM ${tableName}${whereSql};`, params);
    const total = Number(countRows[0]?.count ?? 0);

    const pageSize = Math.max(1, query.pageSize);
    const offset = Math.max(0, query.page) * pageSize;
    const rows = await dbAll<Record<string, unknown>>(db, `SELECT * FROM ${tableName}${whereSql}${orderSql} LIMIT ? OFFSET ?;`, [
      ...params,
      pageSize,
      offset,
    ]);

    const result: EntryRow[] = [];
    for (const row of rows) {
      const id = Number(row.id);
      const value = rowToValue(nodes, row);
      await populateChildFields(db, nodes, id, value);
      result.push({ id, value });
    }
    return { total, rows: result };
  }

  async function findEntry(
    type: ContentTypeDefinition,
    allTypes: ContentTypeDefinition[],
    where: EntryWhere,
    options?: { publishedOnly?: boolean },
  ): Promise<EntryRow | null> {
    const nodes = buildEntryFieldTree(type, allTypes);
    const queryable = flattenQueryableColumns(nodes);
    const whereFragment = buildWhereClause(queryable, where);
    const publishedFragment = options?.publishedOnly ? buildPublishedOnlyClause(queryable, new Date().toISOString()) : null;
    const { sql: whereSql, params } = combineWhereClauses([whereFragment, publishedFragment]);

    const rows = await dbAll<Record<string, unknown>>(
      db,
      `SELECT * FROM ${quoteIdent(type.name)}${whereSql} ORDER BY "id" ASC LIMIT 1;`,
      params,
    );
    const row = rows[0];
    if (!row) return null;
    const id = Number(row.id);
    const value = rowToValue(nodes, row);
    await populateChildFields(db, nodes, id, value);
    return { id, value };
  }

  async function getEntry(
    type: ContentTypeDefinition,
    allTypes: ContentTypeDefinition[],
    id: number,
  ): Promise<EntryRow | null> {
    const nodes = buildEntryFieldTree(type, allTypes);
    const rows = await dbAll<Record<string, unknown>>(db, `SELECT * FROM ${quoteIdent(type.name)} WHERE "id" = ?;`, [id]);
    const row = rows[0];
    if (!row) return null;
    const value = rowToValue(nodes, row);
    await populateChildFields(db, nodes, id, value);
    return { id, value };
  }

  async function getRawEntry(type: ContentTypeDefinition, id: number): Promise<Record<string, unknown> | null> {
    const rows = await dbAll<Record<string, unknown>>(db, `SELECT * FROM ${quoteIdent(type.name)} WHERE "id" = ?;`, [id]);
    return rows[0] ?? null;
  }

  /** Shared by `createEntry` (validated) and `ensureSingletonEntry`
   * (deliberately NOT validated - see that function's doc comment). */
  async function insertRow(type: ContentTypeDefinition, nodes: EntryFieldNode[], queryable: QueryableColumn[], value: EntryValue): Promise<number> {
    const rowData = applyTimestamps(nodes, await valueToRow(nodes, value), "create");
    const columns = Object.keys(rowData);
    let id: number;
    try {
      if (columns.length === 0) {
        id = (await dbRun(db, `INSERT INTO ${quoteIdent(type.name)} DEFAULT VALUES;`)).lastInsertRowid;
      } else {
        const columnList = columns.map(quoteIdent).join(",");
        const placeholders = columns.map(() => "?").join(",");
        id = (
          await dbRun(db, `INSERT INTO ${quoteIdent(type.name)} (${columnList}) VALUES (${placeholders});`, columns.map((c) => rowData[c]))
        ).lastInsertRowid;
      }
    } catch (error) {
      throw translateUniqueViolation(error, queryable) ?? error;
    }

    await writeChildFields(db, nodes, id, value);
    await bumpResourceVersion(type.name);
    return id;
  }

  async function createEntry(
    type: ContentTypeDefinition,
    allTypes: ContentTypeDefinition[],
    value: EntryValue,
  ): Promise<EntryRow> {
    const nodes = buildEntryFieldTree(type, allTypes);
    assertValid(nodes, value);
    const queryable = flattenQueryableColumns(nodes);
    const id = await insertRow(type, nodes, queryable, value);
    return (await getEntry(type, allTypes, id))!;
  }

  async function updateEntry(
    type: ContentTypeDefinition,
    allTypes: ContentTypeDefinition[],
    id: number,
    value: EntryValue,
  ): Promise<EntryRow> {
    const nodes = buildEntryFieldTree(type, allTypes);
    assertValid(nodes, value);
    const queryable = flattenQueryableColumns(nodes);

    const existing = await dbAll<Record<string, unknown>>(db, `SELECT * FROM ${quoteIdent(type.name)} WHERE "id" = ?;`, [id]);
    const existingRow = existing[0];
    if (!existingRow) {
      throw new ContentEntryError("not_found", `Entry ${id} not found on "${type.name}".`);
    }

    const rowData = applyTimestamps(nodes, await valueToRow(nodes, value), "update");
    const columns = Object.keys(rowData);
    if (columns.length > 0) {
      try {
        const setSql = columns.map((c) => `${quoteIdent(c)} = ?`).join(",");
        await dbRun(db, `UPDATE ${quoteIdent(type.name)} SET ${setSql} WHERE "id" = ?;`, [...columns.map((c) => rowData[c]), id]);
      } catch (error) {
        throw translateUniqueViolation(error, queryable) ?? error;
      }
    }

    await writeChildFields(db, nodes, id, value);
    await bumpResourceVersion(type.name);
    return (await getEntry(type, allTypes, id))!;
  }

  async function deleteEntry(type: ContentTypeDefinition, allTypes: ContentTypeDefinition[], id: number): Promise<void> {
    const nodes = buildEntryFieldTree(type, allTypes);
    await deleteChildFields(db, nodes, id);
    await dbRun(db, `DELETE FROM ${quoteIdent(type.name)} WHERE "id" = ?;`, [id]);
    await bumpResourceVersion(type.name);
  }

  async function reorderEntries(
    type: ContentTypeDefinition,
    allTypes: ContentTypeDefinition[],
    updates: { id: number; sortIndex: number }[],
  ): Promise<void> {
    // One atomic `db.batch()` (D1's own multi-statement transaction, unlike
    // the rest of this adapter - see `bumpResourceVersion`'s caveat) rather
    // than a loop of individual `dbRun` calls, so a reorder either lands
    // fully or not at all.
    await runBatch(
      db,
      updates.map(({ id, sortIndex }) => ({
        sql: `UPDATE ${quoteIdent(type.name)} SET ${quoteIdent("sortIndex")} = ? WHERE "id" = ?;`,
        params: [sortIndex, id],
        description: `Reorder ${type.name} #${id}`,
      })),
    );
    await bumpResourceVersion(type.name);
  }

  async function getSingletonEntry(type: ContentTypeDefinition, allTypes: ContentTypeDefinition[]): Promise<EntryRow | null> {
    const rows = await dbAll<{ id: number }>(db, `SELECT "id" FROM ${quoteIdent(type.name)} LIMIT 1;`);
    const row = rows[0];
    if (!row) return null;
    return getEntry(type, allTypes, Number(row.id));
  }

  async function saveSingletonEntry(
    type: ContentTypeDefinition,
    allTypes: ContentTypeDefinition[],
    value: EntryValue,
  ): Promise<EntryRow> {
    const rows = await dbAll<{ id: number }>(db, `SELECT "id" FROM ${quoteIdent(type.name)} LIMIT 1;`);
    const existingId = rows[0] ? Number(rows[0].id) : null;
    return existingId === null ? createEntry(type, allTypes, value) : updateEntry(type, allTypes, existingId, value);
  }

  /** D1 counterpart to `entries-sqlite.ts`'s `ensureSingletonEntry` - same
   * bootstrap-row/no-validation rationale. */
  async function ensureSingletonEntry(type: ContentTypeDefinition, allTypes: ContentTypeDefinition[]): Promise<EntryRow> {
    const existing = await getSingletonEntry(type, allTypes);
    if (existing) return existing;
    const nodes = buildEntryFieldTree(type, allTypes);
    const queryable = flattenQueryableColumns(nodes);
    const id = await insertRow(type, nodes, queryable, blankEntryValue(nodes));
    return (await getEntry(type, allTypes, id))!;
  }

  return {
    listEntries,
    getEntry,
    findEntry,
    getRawEntry,
    createEntry,
    updateEntry,
    deleteEntry,
    reorderEntries,
    getSingletonEntry,
    saveSingletonEntry,
    ensureSingletonEntry,
    getResourceVersion: (type) => getResourceVersionValue(type.name),
  };
}
