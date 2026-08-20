import type { ContentTypeDefinition } from "./types.js";

/**
 * The ONE file every content type lives in (`status/content-types-json-file.md`).
 *
 * There is no `metadata` table any more: a content type is a JSON entry in
 * this document, and the document is the source of truth. It exists at the
 * SAME path in two places on purpose:
 *
 * - the git repo (`content/types.json`), which is where an admin's edits are
 *   authored and versioned - the Content Types UI writes it into the Page
 *   Builder's browser working copy exactly like a `.tsx` file, and it is
 *   committed when "Apply and build" runs;
 * - `pagesSourceStorage` (`.dry/pages-source/content/types.json` locally, R2
 *   in production), which is the copy the SERVER reads on the request hot
 *   path - reading git per request is neither fast enough nor possible at
 *   all on a `custom` (self-hosted) git host.
 *
 * `applied` is the baseline the migration planner diffs against: it is, by
 * construction, the schema the real D1/sqlite tables were last migrated to.
 * `drafts` is what the IndexedDB draft store used to hold - a staged, not
 * yet applied edit - so a draft now travels with the repo (and is reviewable
 * in a diff) instead of living in one browser profile.
 */
export const SCHEMA_DOCUMENT_PATH = "content/types.json";

/** Bumped only for a change no older reader could survive; `parse` accepts
 * anything at or below this and normalizes the rest. */
export const SCHEMA_DOCUMENT_FORMAT = 1;

export type SchemaDraftSource = "local" | "ai";

export interface SchemaDraft {
  definition: ContentTypeDefinition;
  /** `true` while this id has no `applied` entry yet - a type that was
   * drafted but never applied, so the UI knows there is no live table to
   * diff against or delete. Same meaning `draft-store.ts`'s `DraftEntry.isNew`
   * had when drafts lived in IndexedDB. */
  isNew: boolean;
  /** `"ai"` for a draft an AI wrote (MCP `propose_content_type`, the in-app
   * Schema Wizard), `"local"` for one the admin typed. Purely informational
   * now that both land in the same file - it drives the "proposed by AI"
   * badge, nothing else. */
  source: SchemaDraftSource;
  updatedAt: number;
}

export interface SchemaDocument {
  format: number;
  /** Incremented on every APPLIED change (never on a draft write) - the
   * content-types collection's data version, which used to be the
   * `"__content-types__"` row of `_versions`. `routes/content-types.ts`
   * still serves it as an ETag/cache key. */
  revision: number;
  applied: ContentTypeDefinition[];
  drafts: SchemaDraft[];
}

export class SchemaDocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaDocumentError";
  }
}

export function emptySchemaDocument(): SchemaDocument {
  return { format: SCHEMA_DOCUMENT_FORMAT, revision: 0, applied: [], drafts: [] };
}

/** Case-insensitive by `name`, so the file has ONE canonical ordering and a
 * git diff only ever shows what actually changed - unlike the old `SELECT *
 * FROM metadata`, whose row order was never guaranteed in the first place. */
function byName<T extends { name: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

/**
 * Never partially-accepts a document: a file that exists but can't be read as
 * one throws, so a corrupt/truncated write surfaces as an error the admin can
 * act on instead of silently presenting an app with no content types (which
 * the seed bootstrap would then "helpfully" re-create, dropping real tables).
 */
export function parseSchemaDocument(text: string): SchemaDocument {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SchemaDocumentError(`"${SCHEMA_DOCUMENT_PATH}" is not valid JSON.`);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new SchemaDocumentError(`"${SCHEMA_DOCUMENT_PATH}" must contain a JSON object.`);
  }
  const doc = raw as Partial<SchemaDocument>;
  if (typeof doc.format === "number" && doc.format > SCHEMA_DOCUMENT_FORMAT) {
    throw new SchemaDocumentError(
      `"${SCHEMA_DOCUMENT_PATH}" was written by a newer version of drycms (format ${doc.format}).`,
    );
  }
  if (!Array.isArray(doc.applied)) {
    throw new SchemaDocumentError(`"${SCHEMA_DOCUMENT_PATH}" has no "applied" array.`);
  }
  const applied = doc.applied.filter((type): type is ContentTypeDefinition => isDefinition(type));
  if (applied.length !== doc.applied.length) {
    throw new SchemaDocumentError(`"${SCHEMA_DOCUMENT_PATH}" contains an entry that is not a content type.`);
  }
  const drafts = Array.isArray(doc.drafts) ? doc.drafts.filter(isDraft) : [];
  return {
    format: typeof doc.format === "number" ? doc.format : SCHEMA_DOCUMENT_FORMAT,
    revision: typeof doc.revision === "number" && Number.isFinite(doc.revision) ? doc.revision : 0,
    applied: byName(applied),
    drafts,
  };
}

function isDefinition(value: unknown): value is ContentTypeDefinition {
  if (!value || typeof value !== "object") return false;
  const type = value as Partial<ContentTypeDefinition>;
  return typeof type.id === "string" && typeof type.name === "string" && typeof type.kind === "string" && Array.isArray(type.fields);
}

function isDraft(value: unknown): value is SchemaDraft {
  if (!value || typeof value !== "object") return false;
  const draft = value as Partial<SchemaDraft>;
  return isDefinition(draft.definition);
}

/** Pretty-printed and stably ordered - this file is read and reviewed as a
 * git diff, so churn-free output matters as much as correctness. Trailing
 * newline so the last line of a diff isn't a "\ No newline" marker. */
export function serializeSchemaDocument(doc: SchemaDocument): string {
  const ordered: SchemaDocument = {
    format: SCHEMA_DOCUMENT_FORMAT,
    revision: doc.revision,
    applied: byName(doc.applied),
    drafts: [...doc.drafts].sort((a, b) =>
      a.definition.name.toLowerCase().localeCompare(b.definition.name.toLowerCase()),
    ),
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

export function findApplied(doc: SchemaDocument, id: string): ContentTypeDefinition | null {
  return doc.applied.find((type) => type.id === id) ?? null;
}

export function findDraft(doc: SchemaDocument, id: string): SchemaDraft | null {
  return doc.drafts.find((draft) => draft.definition.id === id) ?? null;
}

/** Applies one saved definition: replaces (or adds) it in `applied`, drops
 * any draft for the same id - it just became live - and bumps `revision`.
 * Callers batch several of these before a single write. */
export function withAppliedType(doc: SchemaDocument, next: ContentTypeDefinition): SchemaDocument {
  return {
    ...doc,
    revision: doc.revision + 1,
    applied: byName([...doc.applied.filter((type) => type.id !== next.id), next]),
    drafts: doc.drafts.filter((draft) => draft.definition.id !== next.id),
  };
}

export function withoutAppliedType(doc: SchemaDocument, id: string): SchemaDocument {
  return {
    ...doc,
    revision: doc.revision + 1,
    applied: doc.applied.filter((type) => type.id !== id),
    drafts: doc.drafts.filter((draft) => draft.definition.id !== id),
  };
}

/** Stages an edit. Deliberately does NOT bump `revision`: nothing about the
 * live schema changed, and a draft write must not invalidate every cached
 * render the way an apply does. */
export function withDraft(
  doc: SchemaDocument,
  definition: ContentTypeDefinition,
  options: { source?: SchemaDraftSource; now?: number } = {},
): SchemaDocument {
  const existing = findDraft(doc, definition.id);
  const draft: SchemaDraft = {
    definition,
    isNew: existing?.isNew ?? findApplied(doc, definition.id) === null,
    source: options.source ?? existing?.source ?? "local",
    updatedAt: options.now ?? Date.now(),
  };
  return { ...doc, drafts: [...doc.drafts.filter((item) => item.definition.id !== definition.id), draft] };
}

export function withoutDraft(doc: SchemaDocument, id: string): SchemaDocument {
  return { ...doc, drafts: doc.drafts.filter((draft) => draft.definition.id !== id) };
}
