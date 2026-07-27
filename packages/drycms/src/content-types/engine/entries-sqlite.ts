import type { ResolvedSqliteContentOption } from "../../integration/options.js";
import { quoteIdent } from "../naming.js";
import type { ContentTypeDefinition } from "../types.js";
import { applyTimestamps, rowToValue, validateEntryValue, valueToRow, type EntryValue } from "./entry-codec.js";
import { buildEntryFieldTree, flattenQueryableColumns, type EntryFieldNode, type QueryableColumn } from "./entry-tree.js";
import { ContentEntryError, type ContentEntryEngineAdapter, type EntryPage, type EntryQuery, type EntryRow } from "./entries-types.js";
import { resolveSqliteDriver, type SqliteHandle } from "./sqlite-driver.js";

/** Escapes a user-provided search term for use inside a `LIKE '%...%' ESCAPE
 * '\'` pattern, so a literal `%`/`_` in what someone types doesn't act as a
 * wildcard. */
function escapeLikeTerm(term: string): string {
  return term.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** SQLite (via every one of the 3 local drivers) reports a unique-index
 * violation as `UNIQUE constraint failed: table.column` - translated into a
 * field-level error the same shape `validateEntryValue` produces, rather
 * than a raw 500. */
function translateUniqueViolation(error: unknown, queryable: QueryableColumn[]): ContentEntryError | null {
  const message = error instanceof Error ? error.message : String(error);
  const match = /UNIQUE constraint failed: [^.]+\.(.+)/.exec(message);
  if (!match) return null;
  const columnName = match[1]!;
  const column = queryable.find((c) => c.columnName === columnName);
  const label = column?.label ?? columnName;
  return new ContentEntryError("validation_failed", `"${label}" is already in use.`, {
    [column?.fieldName ?? columnName]: `"${label}" is already in use.`,
  });
}

/** Fills in every `relation`(non-`manyToOne`)/`component-repeat` field's
 * array value from its child table - the part `entry-codec.ts`'s pure
 * `rowToValue` can't do on its own (it only ever sees one already-fetched
 * row). Recurses through `flatten` fields (same table, no extra query) and
 * into a `component-repeat` item's OWN nested child tables (its row id
 * becomes the next level's `parent_id`). */
async function populateChildFields(
  handle: SqliteHandle,
  nodes: EntryFieldNode[],
  parentId: number,
  value: EntryValue,
): Promise<void> {
  for (const node of nodes) {
    if (node.kind === "flatten") {
      await populateChildFields(handle, node.children, parentId, value[node.fieldName] as EntryValue);
    } else if (node.kind === "component-repeat") {
      const rows = handle.all<Record<string, unknown>>(
        `SELECT * FROM ${quoteIdent(node.tableName)} WHERE "parent_id" = ? ORDER BY "position" ASC;`,
        [parentId],
      );
      const items: EntryValue[] = [];
      for (const row of rows) {
        const item = rowToValue(node.itemFields, row);
        await populateChildFields(handle, node.itemFields, Number(row.id), item);
        items.push(item);
      }
      value[node.fieldName] = items;
    } else if (node.kind === "relation" && node.tableName) {
      const rows = handle.all<{ target_id: number }>(
        `SELECT "target_id" FROM ${quoteIdent(node.tableName)} WHERE "parent_id" = ? ORDER BY "position" ASC;`,
        [parentId],
      );
      value[node.fieldName] = rows.map((r) => Number(r.target_id));
    }
  }
}

/** Deletes every row (recursively, children before parents) that
 * `parentId` owns in `nodes`' child tables - used both to clear a
 * `component-repeat`/relation-many field before rewriting it (`writeChildFields`)
 * and, with an empty `value`, to cascade-delete everything under a row being
 * deleted entirely (no generated DDL declares real `FOREIGN KEY`s, so
 * nothing does this automatically - same known gap `migration.ts` already
 * documents for `parent_id`/`target_id`). */
async function deleteChildFields(handle: SqliteHandle, nodes: EntryFieldNode[], parentId: number): Promise<void> {
  for (const node of nodes) {
    if (node.kind === "flatten") {
      await deleteChildFields(handle, node.children, parentId);
    } else if (node.kind === "component-repeat") {
      const rows = handle.all<{ id: number }>(`SELECT "id" FROM ${quoteIdent(node.tableName)} WHERE "parent_id" = ?;`, [
        parentId,
      ]);
      for (const row of rows) await deleteChildFields(handle, node.itemFields, Number(row.id));
      handle.run(`DELETE FROM ${quoteIdent(node.tableName)} WHERE "parent_id" = ?;`, [parentId]);
    } else if (node.kind === "relation" && node.tableName) {
      handle.run(`DELETE FROM ${quoteIdent(node.tableName)} WHERE "parent_id" = ?;`, [parentId]);
    }
  }
}

/** Replaces every `component-repeat`/relation-many field's child rows with
 * whatever `value` currently holds - always a full delete-then-reinsert
 * (simplest correct approach; no item-level diffing) in `position` order. */
async function writeChildFields(
  handle: SqliteHandle,
  nodes: EntryFieldNode[],
  parentId: number,
  value: EntryValue,
): Promise<void> {
  for (const node of nodes) {
    if (node.kind === "flatten") {
      await writeChildFields(handle, node.children, parentId, (value[node.fieldName] as EntryValue) ?? {});
    } else if (node.kind === "component-repeat") {
      const oldRows = handle.all<{ id: number }>(`SELECT "id" FROM ${quoteIdent(node.tableName)} WHERE "parent_id" = ?;`, [
        parentId,
      ]);
      for (const oldRow of oldRows) await deleteChildFields(handle, node.itemFields, Number(oldRow.id));
      handle.run(`DELETE FROM ${quoteIdent(node.tableName)} WHERE "parent_id" = ?;`, [parentId]);

      const items = Array.isArray(value[node.fieldName]) ? (value[node.fieldName] as EntryValue[]) : [];
      for (let position = 0; position < items.length; position++) {
        const itemRow = await valueToRow(node.itemFields, items[position]!);
        const columns = Object.keys(itemRow);
        const columnList = ["parent_id", "position", ...columns].map(quoteIdent).join(",");
        const placeholders = ["?", "?", ...columns.map(() => "?")].join(",");
        const result = handle.run(`INSERT INTO ${quoteIdent(node.tableName)} (${columnList}) VALUES (${placeholders});`, [
          parentId,
          position,
          ...columns.map((c) => itemRow[c]),
        ]);
        await writeChildFields(handle, node.itemFields, result.lastInsertRowid!, items[position]!);
      }
    } else if (node.kind === "relation" && node.tableName) {
      handle.run(`DELETE FROM ${quoteIdent(node.tableName)} WHERE "parent_id" = ?;`, [parentId]);
      const targetIds = Array.isArray(value[node.fieldName]) ? (value[node.fieldName] as unknown[]) : [];
      for (let position = 0; position < targetIds.length; position++) {
        const targetId = targetIds[position];
        if (typeof targetId !== "number") continue;
        handle.run(`INSERT INTO ${quoteIdent(node.tableName)} ("parent_id","position","target_id") VALUES (?,?,?);`, [
          parentId,
          position,
          targetId,
        ]);
      }
    }
  }
}

function assertValid(nodes: EntryFieldNode[], value: EntryValue): void {
  const errors = validateEntryValue(nodes, value);
  if (Object.keys(errors).length > 0) {
    throw new ContentEntryError("validation_failed", "Validation failed.", errors);
  }
}

export function createSqliteContentEntryEngineAdapter(option: ResolvedSqliteContentOption): ContentEntryEngineAdapter {
  let handlePromise: Promise<SqliteHandle> | undefined;
  async function getHandle(): Promise<SqliteHandle> {
    if (!handlePromise) handlePromise = resolveSqliteDriver(option.file);
    return handlePromise;
  }

  async function listEntries(
    type: ContentTypeDefinition,
    allTypes: ContentTypeDefinition[],
    query: EntryQuery,
  ): Promise<EntryPage> {
    const handle = await getHandle();
    const nodes = buildEntryFieldTree(type, allTypes);
    const queryable = flattenQueryableColumns(nodes);
    const tableName = quoteIdent(type.name);

    const params: unknown[] = [];
    let whereSql = "";
    if (query.search && query.searchableFields && query.searchableFields.length > 0) {
      const matching = queryable.filter((c) => query.searchableFields!.includes(c.fieldName));
      if (matching.length > 0) {
        const likeTerm = `%${escapeLikeTerm(query.search)}%`;
        whereSql = ` WHERE (${matching.map((c) => `${quoteIdent(c.columnName)} LIKE ? ESCAPE '\\'`).join(" OR ")})`;
        for (const _ of matching) params.push(likeTerm);
      }
    }

    const sortColumn = query.sortField ? queryable.find((c) => c.fieldName === query.sortField)?.columnName : undefined;
    const orderSql = sortColumn
      ? ` ORDER BY ${quoteIdent(sortColumn)} ${query.sortDir === "asc" ? "ASC" : "DESC"}`
      : ` ORDER BY "id" DESC`;

    const countRows = handle.all<{ count: number }>(`SELECT COUNT(*) as count FROM ${tableName}${whereSql};`, params);
    const total = Number(countRows[0]?.count ?? 0);

    const pageSize = Math.max(1, query.pageSize);
    const offset = Math.max(0, query.page) * pageSize;
    const rows = handle.all<Record<string, unknown>>(`SELECT * FROM ${tableName}${whereSql}${orderSql} LIMIT ? OFFSET ?;`, [
      ...params,
      pageSize,
      offset,
    ]);

    return { total, rows: rows.map((row) => ({ id: Number(row.id), value: rowToValue(nodes, row) })) };
  }

  async function getEntry(
    type: ContentTypeDefinition,
    allTypes: ContentTypeDefinition[],
    id: number,
  ): Promise<EntryRow | null> {
    const handle = await getHandle();
    const nodes = buildEntryFieldTree(type, allTypes);
    const rows = handle.all<Record<string, unknown>>(`SELECT * FROM ${quoteIdent(type.name)} WHERE "id" = ?;`, [id]);
    const row = rows[0];
    if (!row) return null;
    const value = rowToValue(nodes, row);
    await populateChildFields(handle, nodes, id, value);
    return { id, value };
  }

  async function createEntry(
    type: ContentTypeDefinition,
    allTypes: ContentTypeDefinition[],
    value: EntryValue,
  ): Promise<EntryRow> {
    const handle = await getHandle();
    const nodes = buildEntryFieldTree(type, allTypes);
    assertValid(nodes, value);
    const queryable = flattenQueryableColumns(nodes);

    const rowData = applyTimestamps(nodes, await valueToRow(nodes, value), "create");
    const columns = Object.keys(rowData);
    let id: number;
    try {
      if (columns.length === 0) {
        const result = handle.run(`INSERT INTO ${quoteIdent(type.name)} DEFAULT VALUES;`);
        id = result.lastInsertRowid!;
      } else {
        const columnList = columns.map(quoteIdent).join(",");
        const placeholders = columns.map(() => "?").join(",");
        const result = handle.run(`INSERT INTO ${quoteIdent(type.name)} (${columnList}) VALUES (${placeholders});`, columns.map((c) => rowData[c]));
        id = result.lastInsertRowid!;
      }
    } catch (error) {
      throw translateUniqueViolation(error, queryable) ?? error;
    }

    await writeChildFields(handle, nodes, id, value);
    return (await getEntry(type, allTypes, id))!;
  }

  async function updateEntry(
    type: ContentTypeDefinition,
    allTypes: ContentTypeDefinition[],
    id: number,
    value: EntryValue,
  ): Promise<EntryRow> {
    const handle = await getHandle();
    const nodes = buildEntryFieldTree(type, allTypes);
    assertValid(nodes, value);
    const queryable = flattenQueryableColumns(nodes);

    const existing = handle.all<{ id: number }>(`SELECT "id" FROM ${quoteIdent(type.name)} WHERE "id" = ?;`, [id]);
    if (existing.length === 0) {
      throw new ContentEntryError("not_found", `Entry ${id} not found on "${type.name}".`);
    }

    const rowData = applyTimestamps(nodes, await valueToRow(nodes, value), "update");
    const columns = Object.keys(rowData);
    if (columns.length > 0) {
      try {
        const setSql = columns.map((c) => `${quoteIdent(c)} = ?`).join(",");
        handle.run(`UPDATE ${quoteIdent(type.name)} SET ${setSql} WHERE "id" = ?;`, [...columns.map((c) => rowData[c]), id]);
      } catch (error) {
        throw translateUniqueViolation(error, queryable) ?? error;
      }
    }

    await writeChildFields(handle, nodes, id, value);
    return (await getEntry(type, allTypes, id))!;
  }

  async function deleteEntry(type: ContentTypeDefinition, allTypes: ContentTypeDefinition[], id: number): Promise<void> {
    const handle = await getHandle();
    const nodes = buildEntryFieldTree(type, allTypes);
    await deleteChildFields(handle, nodes, id);
    handle.run(`DELETE FROM ${quoteIdent(type.name)} WHERE "id" = ?;`, [id]);
  }

  async function getSingletonEntry(type: ContentTypeDefinition, allTypes: ContentTypeDefinition[]): Promise<EntryRow | null> {
    const handle = await getHandle();
    const rows = handle.all<{ id: number }>(`SELECT "id" FROM ${quoteIdent(type.name)} LIMIT 1;`);
    const row = rows[0];
    if (!row) return null;
    return getEntry(type, allTypes, Number(row.id));
  }

  async function saveSingletonEntry(
    type: ContentTypeDefinition,
    allTypes: ContentTypeDefinition[],
    value: EntryValue,
  ): Promise<EntryRow> {
    const handle = await getHandle();
    const rows = handle.all<{ id: number }>(`SELECT "id" FROM ${quoteIdent(type.name)} LIMIT 1;`);
    const existingId = rows[0] ? Number(rows[0].id) : null;
    return existingId === null ? createEntry(type, allTypes, value) : updateEntry(type, allTypes, existingId, value);
  }

  return { listEntries, getEntry, createEntry, updateEntry, deleteEntry, getSingletonEntry, saveSingletonEntry };
}
