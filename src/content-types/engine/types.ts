import type { SavePlan } from "../migration.js";
import type { ContentTypeDefinition } from "../types.js";
import type { FileSavePlan } from "./file/migration-file.js";

/** `sqlite`/`D1` produce a `SavePlan` (DDL `Statement`s); `file` produces a
 * `FileSavePlan` (a bulk-rewrite description) - see `engine/index.ts`'s
 * `createContentEngineAdapter`. Callers (`routes/content-types.ts`) only
 * ever touch the one field common to both, `destructiveSummary`, so the
 * adapter contract just widens to the union rather than needing a generic
 * parameter threaded through every engine module. */
export type AnySavePlan = SavePlan | FileSavePlan;

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
  planSave(next: ContentTypeDefinition): Promise<AnySavePlan>;
  /** Executes a previously-computed plan. Throws `ContentEngineError`
   * (`"version_conflict"`) if the row changed since the plan was computed. */
  applySave(next: ContentTypeDefinition, plan: AnySavePlan): Promise<ContentTypeDefinition>;
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
