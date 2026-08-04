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

/** ANDed together - no OR/nesting. `plans/reader.md`'s original sketch called
 * this a full condition tree, but every real caller (`dry()`'s `get`/`list`)
 * only ever needs flat equality-style filters; a tree can still be added
 * later as a superset of this shape without breaking it. */
export type EntryWhere = EntryWhereCondition[];

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

/**
 * Resolves each `EntryWhere` condition's `field` against `queryable`
 * (throwing `EntryWhereError` for an unknown/unqueryable field rather than
 * silently ignoring it) and renders one parameterized `WHERE`-safe SQL
 * fragment (no leading `WHERE`/`AND` keyword) + its positional params. `null`
 * when `where` is empty.
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
  for (const condition of where) {
    const column = resolveColumn(queryable, condition.field);
    const ident = quoteIdent(column.columnName);

    if (condition.op === "in") {
      const values = Array.isArray(condition.value) ? condition.value : [condition.value];
      if (values.length === 0) {
        parts.push("0"); // empty IN () - matches nothing.
        continue;
      }
      parts.push(`${ident} IN (${values.map(() => "?").join(",")})`);
      params.push(...values.map((v) => serializeConditionValue(column, v)));
      continue;
    }

    if (condition.value === null) {
      // `= NULL`/`!= NULL` never match in SQL - a literal `null` condition
      // means the IS [NOT] NULL check a caller actually wants.
      parts.push(condition.op === "ne" ? `${ident} IS NOT NULL` : `${ident} IS NULL`);
      continue;
    }

    parts.push(`${ident} ${SQL_OP[condition.op]} ?`);
    params.push(serializeConditionValue(column, condition.value));
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
