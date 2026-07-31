import type { ContentTypeDefinition } from "../types.js";
import type { EntryValue } from "./entry-codec.js";

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
  createEntry(type: ContentTypeDefinition, allTypes: ContentTypeDefinition[], value: EntryValue): Promise<EntryRow>;
  updateEntry(type: ContentTypeDefinition, allTypes: ContentTypeDefinition[], id: number, value: EntryValue): Promise<EntryRow>;
  deleteEntry(type: ContentTypeDefinition, allTypes: ContentTypeDefinition[], id: number): Promise<void>;
  getSingletonEntry(type: ContentTypeDefinition, allTypes: ContentTypeDefinition[]): Promise<EntryRow | null>;
  saveSingletonEntry(type: ContentTypeDefinition, allTypes: ContentTypeDefinition[], value: EntryValue): Promise<EntryRow>;
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
