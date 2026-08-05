import { fieldTypes } from "../field-registry.js";
import { quoteIdent } from "../naming.js";
import { SYSTEM_FIELD_IDS } from "../system-fields.js";
import type { QueryableColumn } from "./entry-tree.js";

export type EntryWhereOp = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in";

export interface EntryWhereCondition {
  /** A `flattenQueryableColumns` field name (dotted path for a field nested
   * inside a `flatten` component) - never a raw SQL column, resolved against
   * `queryable` the same way `EntryQuery.sortField` already is. */
  field: string;
  op: EntryWhereOp;
  /** A single value for every op except `in` (an array). Run through the
   * field type's own `serialize` before hitting SQL, same as a write would -
   * so a `date` condition accepts a `Date` (or anything `new Date()` parses)
   * and a `boolean` condition accepts `true`/`false`, not their raw column
   * encoding. */
  value: unknown;
}

/** A group of plain conditions ORed together internally, then ANDed in with
 * every other top-level `EntryWhere` entry - e.g. `[{field:"draft",op:"eq",
 * value:false}, {or:[{field:"category",op:"eq",value:1},{field:"category",
 * op:"eq",value:2}]}]` reads as `draft = false AND (category = 1 OR
 * category = 2)`. One level only - an `or` group's own conditions are plain
 * `EntryWhereCondition`s, not further groups; see `EntryWhere`'s own doc
 * comment for why. */
export interface EntryWhereGroup {
  or: EntryWhereCondition[];
}

/** ANDed together at the top level - each entry either a plain condition or
 * an `EntryWhereGroup` (see its own doc comment). `plans/reader.md`'s
 * original sketch called this a full condition tree; every real caller
 * (`dry()`'s `get`/`list`) so far only needs "AND of (plain conditions or
 * one OR-group)", so that's all this supports - deeper/mixed nesting can
 * still be added later as a superset of this shape without breaking it,
 * same as this `or` group itself was added on top of the original
 * flat-AND-only shape. */
export type EntryWhere = (EntryWhereCondition | EntryWhereGroup)[];

function isWhereGroup(entry: EntryWhereCondition | EntryWhereGroup): entry is EntryWhereGroup {
  return "or" in entry;
}

export class EntryWhereError extends Error {}

const SQL_OP: Record<Exclude<EntryWhereOp, "in">, string> = {
  eq: "=",
  ne: "!=",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
};

function serializeConditionValue(column: QueryableColumn, raw: unknown): unknown {
  const serialize = fieldTypes[column.fieldType]?.serialize;
  return serialize ? serialize(raw as never) : raw;
}

function resolveColumn(queryable: QueryableColumn[], fieldName: string): QueryableColumn {
  const column = queryable.find((c) => c.fieldName === fieldName);
  if (!column) {
    throw new EntryWhereError(`"${fieldName}" is not a queryable field.`);
  }
  return column;
}

/** Renders one `EntryWhereCondition` to its SQL fragment + params - the
 * per-condition half of `buildWhereClause`, factored out so an
 * `EntryWhereGroup`'s conditions can reuse it to build an `OR`-joined
 * fragment instead of duplicating this logic. */
function buildCondition(queryable: QueryableColumn[], condition: EntryWhereCondition): { sql: string; params: unknown[] } {
  const column = resolveColumn(queryable, condition.field);
  const ident = quoteIdent(column.columnName);

  if (condition.op === "in") {
    const values = Array.isArray(condition.value) ? condition.value : [condition.value];
    if (values.length === 0) return { sql: "0", params: [] }; // empty IN () - matches nothing.
    return { sql: `${ident} IN (${values.map(() => "?").join(",")})`, params: values.map((v) => serializeConditionValue(column, v)) };
  }

  if (condition.value === null) {
    // `= NULL`/`!= NULL` never match in SQL - a literal `null` condition
    // means the IS [NOT] NULL check a caller actually wants.
    return { sql: condition.op === "ne" ? `${ident} IS NOT NULL` : `${ident} IS NULL`, params: [] };
  }

  return { sql: `${ident} ${SQL_OP[condition.op]} ?`, params: [serializeConditionValue(column, condition.value)] };
}

/**
 * Resolves each `EntryWhere` entry's field(s) against `queryable` (throwing
 * `EntryWhereError` for an unknown/unqueryable field rather than silently
 * ignoring it) and renders one parameterized `WHERE`-safe SQL fragment (no
 * leading `WHERE`/`AND` keyword) + its positional params. `null` when
 * `where` is empty. A plain `EntryWhereCondition` renders via
 * `buildCondition`; an `EntryWhereGroup` renders its own conditions the same
 * way, `OR`-joins and parenthesizes them, then ANDs that in with everything
 * else - same "empty means match nothing" convention an empty `in` uses.
 *
 * Shared by `entries-sqlite.ts` and `entries-d1.ts` since both speak the same
 * SQL dialect (D1 is SQLite-compatible) - same rationale `entry-tree.ts` is
 * already shared between them while the driver-touching CRUD methods around
 * it aren't (see `entries-d1.ts`'s doc comment on why those stay duplicated).
 */
export function buildWhereClause(queryable: QueryableColumn[], where: EntryWhere): { sql: string; params: unknown[] } | null {
  if (where.length === 0) return null;
  const parts: string[] = [];
  const params: unknown[] = [];
  for (const entry of where) {
    if (isWhereGroup(entry)) {
      if (entry.or.length === 0) {
        parts.push("0"); // empty OR group - matches nothing.
        continue;
      }
      const built = entry.or.map((condition) => buildCondition(queryable, condition));
      parts.push(`(${built.map((b) => b.sql).join(" OR ")})`);
      params.push(...built.flatMap((b) => b.params));
      continue;
    }
    const built = buildCondition(queryable, entry);
    parts.push(built.sql);
    params.push(...built.params);
  }
  return { sql: parts.join(" AND "), params };
}

/**
 * The "published" gate `EntryQuery.publishedOnly`/`findEntry`'s
 * `publishedOnly` option applies - `null` (a no-op) unless the type actually
 * has `features.draft`/`features.schedule` (i.e. `queryable` carries the
 * matching system column), since there's no draft/scheduling concept to gate
 * on otherwise.
 *
 * A `draft`/`schedule` column nobody has ever explicitly set is SQL `NULL`,
 * not `false`/empty (see `entry-codec.ts`'s `valueToRow`: neither field
 * declares a `default`, so an untouched value falls through to `null`) - both
 * branches below treat `NULL` as "published" so a brand-new entry still shows
 * up before anyone has touched its Draft/Schedule toggle.
 */
export function buildPublishedOnlyClause(queryable: QueryableColumn[], nowIso: string): { sql: string; params: unknown[] } | null {
  const draftColumn = queryable.find((c) => c.fieldId === SYSTEM_FIELD_IDS.draft);
  const scheduleColumn = queryable.find((c) => c.fieldId === SYSTEM_FIELD_IDS.schedule);
  const parts: string[] = [];
  const params: unknown[] = [];
  if (draftColumn) {
    const ident = quoteIdent(draftColumn.columnName);
    parts.push(`(${ident} IS NULL OR ${ident} = 0)`);
  }
  if (scheduleColumn) {
    const ident = quoteIdent(scheduleColumn.columnName);
    parts.push(`(${ident} IS NULL OR ${ident} <= ?)`);
    params.push(nowIso);
  }
  if (parts.length === 0) return null;
  return { sql: parts.join(" AND "), params };
}

/** Combines any number of optional (`null` = "not applicable") pre-built
 * fragments into one `WHERE ...` clause, ANDing whichever ones are actually
 * present - `listEntries`' search/where/publishedOnly fragments are each
 * independently optional. Empty input (or every fragment `null`) yields `""`
 * (no `WHERE` at all), matching the adapters' pre-existing `whereSql`
 * default. */
export function combineWhereClauses(fragments: ({ sql: string; params: unknown[] } | null)[]): { sql: string; params: unknown[] } {
  const present = fragments.filter((f): f is { sql: string; params: unknown[] } => f !== null && f.sql.length > 0);
  if (present.length === 0) return { sql: "", params: [] };
  return {
    sql: ` WHERE ${present.map((f) => `(${f.sql})`).join(" AND ")}`,
    params: present.flatMap((f) => f.params),
  };
}
