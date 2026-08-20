import type { ContentTypeDefinition } from "../types.js";
import type { EntryValue } from "./entry-codec.js";
import type { EntryWhere } from "./entry-where.js";

export type ContentEntryErrorCode = "not_found" | "validation_failed" | "unsupported";

export class ContentEntryError extends Error {
  code: ContentEntryErrorCode;
  /** Only set for `validation_failed` - field name (dotted path for nested
   * `flatten` fields) to a human-readable message, same shape
   * `entry-codec.ts`'s `validateEntryValue` returns. */
  fieldErrors?: Record<string, string>;

  constructor(code: ContentEntryErrorCode, message: string, fieldErrors?: Record<string, string>) {
    super(message);
    this.name = "ContentEntryError";
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

export interface EntryQuery {
  page: number;
  pageSize: number;
  /** A `flattenQueryableColumns` field name (see `entry-tree.ts`) - never a
   * raw SQL column, so the adapter must re-resolve it rather than trust it
   * directly as an identifier. */
  sortField?: string;
  sortDir?: "asc" | "desc";
  search?: string;
  /** Which `flattenQueryableColumns` fields `search` matches against - only
   * fields the caller has toggled visible (see `status/content.md`'s "only a
   * toggled-on column is searchable"). */
  searchableFields?: string[];
  /** ANDed with `search` and `publishedOnly` (each independently optional) -
   * see `entry-where.ts`. Existing admin-UI callers (`ContentEntryList.tsx`)
   * never set this; it exists for the `dry()` reader (`plans/reader.md`). */
  where?: EntryWhere;
  /** Excludes draft/future-scheduled rows (see `entry-where.ts`'s
   * `buildPublishedOnlyClause`) - a no-op when the type has neither
   * `features.draft` nor `features.schedule`. The `dry()` reader defaults
   * this to `true`; every other caller leaves it unset (an editor needs to
   * see everything, published or not). */
  publishedOnly?: boolean;
  /** Field names to force back into `listEntries`'s SELECT even though
   * they'd normally be excluded (currently only non-inline `richtext`
   * fields) - see `entry-tree.ts`'s `listSelectColumnNames`. */
  include?: string[];
  /**
   * Restricts the whole read to these top-level field names (`id` always
   * survives) - the projection behind `dry-reader.ts`'s `DryListOptions.
   * select`. Absent (the admin UI, every pre-existing caller) means "every
   * field", exactly as before this existed.
   *
   * Applied through `entry-tree.ts`'s `selectFieldNodes`, so it shapes the
   * SELECT column list, the row decode AND the per-row child-table queries
   * at once. An unselected field is ABSENT from the resulting
   * `EntryRow.value`, not `null` - unlike an `include`-excluded `richtext`
   * column, which is fetched-as-null because its node is still in the tree.
   * A selected field is fetched even if it's one of those otherwise-excluded
   * `richtext` columns: naming it is a stronger signal than the default.
   */
  select?: string[];
}

export interface EntryRow {
  id: number;
  value: EntryValue;
}

export interface EntryPage {
  rows: EntryRow[];
  total: number;
}

/**
 * Row-level CRUD for content-type entries - the counterpart to
 * `engine/types.ts`'s `ContentEngineAdapter`, which is schema-definition
 * only. `list/get/create/update/deleteEntry` operate on `collection` types;
 * a `singleton` has at most one row, so it gets its own pair of methods
 * instead of a fake id - `getSingletonEntry`/`saveSingletonEntry` (the
 * latter an upsert: creates the row on first save, updates it after).
 * `component` types have no table of their own and are never passed here
 * directly - they only ever appear nested inside another type's fields.
 */
export interface ContentEntryEngineAdapter {
  listEntries(type: ContentTypeDefinition, allTypes: ContentTypeDefinition[], query: EntryQuery): Promise<EntryPage>;
  getEntry(type: ContentTypeDefinition, allTypes: ContentTypeDefinition[], id: number): Promise<EntryRow | null>;
  /**
   * Like `getEntry`, but looks the row up by an arbitrary `EntryWhere`
   * instead of its `id` - e.g. `dry()`'s slug lookup (`get("my-slug")`).
   * Fully populated (relations/child-tables included), same as `getEntry`.
   * Ordered by `"id"` ascending and takes the first match when `where`
   * matches more than one row (no `ORDER BY` guarantee otherwise, so a
   * multi-match result would be DB/engine-order-dependent without this).
   * `null` if nothing matches. `publishedOnly` is the same gate
   * `EntryQuery.publishedOnly` applies - see `entry-where.ts`'s
   * `buildPublishedOnlyClause`.
   */
  findEntry(
    type: ContentTypeDefinition,
    allTypes: ContentTypeDefinition[],
    where: EntryWhere,
    options?: { publishedOnly?: boolean },
  ): Promise<EntryRow | null>;
  /**
   * Like `getEntry`, but returns the row exactly as stored - no
   * `entry-codec.ts` `rowToValue` masking (`password`/`secretkey` columns
   * come through with their real hash/ciphertext) and no relation/child-table
   * population. Only ever meant for a caller that genuinely needs the raw
   * column value server-side (e.g. verifying a login password against the
   * real stored hash) - never expose this over the generic entries HTTP
   * route, which exists specifically to keep those columns masked.
   */
  getRawEntry(type: ContentTypeDefinition, id: number): Promise<Record<string, unknown> | null>;
  createEntry(type: ContentTypeDefinition, allTypes: ContentTypeDefinition[], value: EntryValue): Promise<EntryRow>;
  updateEntry(type: ContentTypeDefinition, allTypes: ContentTypeDefinition[], id: number, value: EntryValue): Promise<EntryRow>;
  /**
   * Writes one row back AT `id`, whether or not that row still exists -
   * update in place when it does, insert with that exact id when it doesn't.
   * The ONE write path that mints no new id, and it exists for exactly one
   * caller: restoring a git snapshot (`server/git-restore.ts`,
   * `status/git-versions-page.md`), where every relation in every other
   * restored row points at these ids, so a re-created row that came back
   * under a fresh autoincrement id would silently break every reference to
   * it. Timestamps are kept as the snapshot recorded them (`entry-codec.ts`'s
   * `applyTimestamps` `"restore"` mode) rather than re-stamped to now.
   * Never called by the generic entries HTTP route.
   */
  restoreEntry(type: ContentTypeDefinition, allTypes: ContentTypeDefinition[], id: number, value: EntryValue): Promise<EntryRow>;
  deleteEntry(type: ContentTypeDefinition, allTypes: ContentTypeDefinition[], id: number): Promise<void>;
  getSingletonEntry(type: ContentTypeDefinition, allTypes: ContentTypeDefinition[]): Promise<EntryRow | null>;
  saveSingletonEntry(type: ContentTypeDefinition, allTypes: ContentTypeDefinition[], value: EntryValue): Promise<EntryRow>;
  /**
   * Guarantees a singleton has a row - a no-op if one already exists,
   * otherwise inserts a `blankEntryValue` row WITHOUT running field
   * validation (see `status/role.md`: a singleton should have something to
   * open and edit immediately, not only after the admin's first manual Save
   * satisfies its `required` fields). Called once, right after a singleton
   * content type is saved (`routes/content-types.ts`).
   */
  ensureSingletonEntry(type: ContentTypeDefinition, allTypes: ContentTypeDefinition[]): Promise<EntryRow>;
  /**
   * Bulk-writes every listed row's `sortIndex` column in one call - the
   * List page's drag-reorder Save action (see `features.sortable`,
   * `system-fields.ts`) renumbers the WHOLE currently-visible order at once
   * rather than patching just the moved row, so this always receives every
   * row's new value together instead of one `updateEntry` call per row.
   * `collection` types with `features.sortable` only - never called
   * otherwise.
   */
  reorderEntries(type: ContentTypeDefinition, allTypes: ContentTypeDefinition[], updates: { id: number; sortIndex: number }[]): Promise<void>;
  /**
   * The resource's current *data* version (see `status/build-cache.md`) -
   * bumped by `createEntry`/`updateEntry`/`deleteEntry`/`saveSingletonEntry`,
   * distinct from `ContentTypeDefinition.version` (schema/optimistic-
   * concurrency version, unrelated). `0` if the resource has never been
   * mutated through this adapter yet.
   */
  getResourceVersion(type: ContentTypeDefinition): Promise<number>;
}
