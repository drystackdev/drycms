import type { SavePlan } from "../migration.js";
import type { ContentTypeDefinition } from "../types.js";

export type ContentEngineErrorCode =
  | "not_found"
  | "already_exists"
  | "version_conflict"
  | "invalid_definition"
  | "in_use"
  | "unsupported"
  | "system_protected";

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
  planSave(next: ContentTypeDefinition): Promise<SavePlan>;
  /** Executes a previously-computed plan. Throws `ContentEngineError`
   * (`"version_conflict"`) if the row changed since the plan was computed. */
  applySave(next: ContentTypeDefinition, plan: SavePlan): Promise<ContentTypeDefinition>;
  /** Drops every child table, then the root table, then the metadata row. */
  deleteContentType(id: string): Promise<void>;
}
