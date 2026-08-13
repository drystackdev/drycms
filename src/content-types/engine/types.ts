import type { SavePlan } from "../migration.js";
import type { ContentTypeDefinition } from "../types.js";

export type ContentEngineErrorCode =
  | "not_found"
  | "already_exists"
  | "version_conflict"
  | "invalid_definition"
  | "in_use"
  | "unsupported"
  | "protected";

export class ContentEngineError extends Error {
  code: ContentEngineErrorCode;

  constructor(code: ContentEngineErrorCode, message: string) {
    super(message);
    this.name = "ContentEngineError";
    this.code = code;
  }
}

/**
 * The OTHER pending drafts being saved alongside one definition in the same
 * "Apply and build" batch (`routes/content-types.ts`'s `handleBatch`).
 * Without this, every item is planned as if it were the only change in
 * flight, which makes two drafts that depend on each other - a brand-new
 * component and a brand-new collection/singleton that embeds it - impossible
 * to check together: neither is live yet, so whichever is planned first
 * can't resolve the other.
 */
export interface SaveBatchContext {
  /** Extra definitions to resolve component references against, on top of
   * what's live (a draft with the same id as a live type shadows it). Only
   * ever passed for a dry-run: a real apply relies on batch ORDERING
   * (dependencies written first) instead, so a batch that fails halfway can
   * never leave a table shaped from a component that isn't live yet. */
  pendingTypes?: ContentTypeDefinition[];
}

/**
 * Schema-definition operations only - creates/migrates/drops the tables a
 * content type implies. Content-*row* CRUD (e.g. actual Blog post data) is
 * a separate, not-yet-built feature (the disabled "Content" nav entry) and
 * is deliberately out of scope here.
 */
export interface ContentEngineAdapter {
  listContentTypes(): Promise<ContentTypeDefinition[]>;
  getContentType(id: string): Promise<ContentTypeDefinition | null>;
  /** Dry-run: computes the plan (including the destructive-change summary
   * for a confirm dialog) without writing anything. */
  planSave(next: ContentTypeDefinition, batch?: SaveBatchContext): Promise<SavePlan>;
  /** Executes a previously-computed plan. Throws `ContentEngineError`
   * (`"version_conflict"`) if the row changed since the plan was computed. */
  applySave(next: ContentTypeDefinition, plan: SavePlan): Promise<ContentTypeDefinition>;
  /** Drops every child table, then the root table, then the metadata row. */
  deleteContentType(id: string): Promise<void>;
  /**
   * The content-types COLLECTION's data version (see `status/
   * build-cache.md`) - one counter for the whole list, bumped by
   * `applySave`/`deleteContentType` (and initial default-type seeding).
   * Distinct from any individual `ContentTypeDefinition.version` (that
   * one's per-definition schema/optimistic-concurrency version - mục 4.1
   * explicitly says not to reuse it for caching). `0` if nothing has ever
   * changed through this adapter yet.
   */
  getResourceVersion(): Promise<number>;
}
