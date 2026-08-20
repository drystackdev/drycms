import type { DryRouteContext, DryRouteHandler } from "../context.js";
import { jsonResponse, unauthenticatedResponse } from "../route-helpers.js";
import { getContentAdapters } from "../content-adapters.js";
import { requirePermission } from "../admin-access.js";
import { CONTENT_TYPES_RESOURCE_ID } from "../../content-types/permissions.js";
import { createStorageSchemaDocumentStore } from "../schema-document-storage.js";
import {
  SchemaDocumentError,
  emptySchemaDocument,
  parseSchemaDocument,
  serializeSchemaDocument,
  withDraft,
  type SchemaDocument,
  type SchemaDraft,
  type SchemaDraftSource,
} from "../../content-types/schema-document.js";
import type { ContentTypeDefinition } from "../../content-types/types.js";

/**
 * `content/types.json` (`schema-document.ts`) as an HTTP surface:
 *
 * - `GET` / `PUT` - the staged (not yet applied) half, i.e. what the
 *   IndexedDB draft store used to hold before a content-type draft became
 *   part of the repo. Only `drafts` is reachable: a live schema change has
 *   to go through `routes/content-types.ts`'s "Apply and build", which runs
 *   the real table migration and writes the applied definition itself.
 * - `GET /export` - the whole document as a downloadable `.json` file.
 * - `POST /import` - an exported (or hand-written) document, staged as
 *   drafts. Deliberately NOT a restore: importing never touches a table.
 *   The admin reviews the result in "Apply and build", where the existing
 *   dry-run already reports every destructive change before anything runs.
 *
 * The storage copy this maintains is what keeps drafts visible to a second
 * browser (and to a tenant with no git configured at all); the commit that
 * carries them lands with the apply.
 */
async function loadDocument(context: DryRouteContext): Promise<{ store: ReturnType<typeof createStorageSchemaDocumentStore>; document: SchemaDocument }> {
  // Reading through the schema adapter first guarantees the bootstrap/seed
  // has run, so the store never answers `null` here for a fresh project.
  await getContentAdapters(context).schema.listContentTypes();
  const store = createStorageSchemaDocumentStore(context);
  return { store, document: (await store.read()) ?? emptySchemaDocument() };
}

async function guard(context: DryRouteContext): Promise<Response | null> {
  if (!context.session) return unauthenticatedResponse();
  return requirePermission(context, CONTENT_TYPES_RESOURCE_ID, "setting", "You don't have permission to edit content type schemas.");
}

function exportFilename(): string {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return `drycms-content-types-${stamp}.json`;
}

export const GET: DryRouteHandler = async (context) => {
  const denied = await guard(context);
  if (denied) return denied;

  const { document } = await loadDocument(context);
  if ((context.params.slug ?? "") === "export") {
    return new Response(serializeSchemaDocument(document), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${exportFilename()}"`,
      },
    });
  }
  return jsonResponse({ revision: document.revision, drafts: document.drafts });
};

/** Replaces the whole staging area in one write - the client always holds
 * the complete set (it renders it), so a per-draft PATCH would only add
 * ordering hazards between two tabs for no benefit. `applied` is carried
 * over from whatever the server currently has, never from the request. */
export const PUT: DryRouteHandler = async (context) => {
  const denied = await guard(context);
  if (denied) return denied;

  const body = (await context.request.json().catch(() => ({}))) as { drafts?: unknown };
  if (!Array.isArray(body.drafts)) {
    return jsonResponse({ error: "invalid_request", message: "`drafts` must be an array." }, 400);
  }

  const { store, document } = await loadDocument(context);
  const drafts: SchemaDraft[] = [];
  for (const raw of body.drafts) {
    const draft = raw as Partial<SchemaDraft>;
    const definition = draft.definition as ContentTypeDefinition | undefined;
    if (!definition || typeof definition.id !== "string" || typeof definition.name !== "string") {
      return jsonResponse({ error: "invalid_request", message: "Every draft needs a `definition`." }, 400);
    }
    drafts.push({
      definition,
      isNew: draft.isNew === true,
      source: (draft.source === "ai" ? "ai" : "local") as SchemaDraftSource,
      updatedAt: typeof draft.updatedAt === "number" ? draft.updatedAt : Date.now(),
    });
  }

  const next = { ...document, drafts };
  await store.write(next);
  return jsonResponse({ revision: next.revision, drafts: next.drafts });
};

/** Everything about a definition EXCEPT the optimistic-lock counter - two
 * projects that hold the same type will disagree about `version` (it counts
 * applies, not content), so comparing it would report every import as a
 * change and re-migrating identical tables for nothing. */
function sameDefinition(a: ContentTypeDefinition, b: ContentTypeDefinition): boolean {
  const strip = ({ version: _version, ...rest }: ContentTypeDefinition) => rest;
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

/** Accepts either a whole exported document or a bare `ContentTypeDefinition[]`
 * (what someone hand-assembling a file is most likely to produce). */
function readImportedTypes(text: string): ContentTypeDefinition[] {
  const trimmed = text.trim();
  if (trimmed.startsWith("[")) {
    const raw = JSON.parse(trimmed) as unknown;
    if (!Array.isArray(raw)) throw new SchemaDocumentError("The file must contain a content type array.");
    const types = raw.filter((entry): entry is ContentTypeDefinition => {
      const type = entry as Partial<ContentTypeDefinition>;
      return !!type && typeof type.id === "string" && typeof type.name === "string" && Array.isArray(type.fields);
    });
    if (types.length !== raw.length) throw new SchemaDocumentError("The file contains an entry that is not a content type.");
    return types;
  }
  const document = parseSchemaDocument(trimmed);
  // A draft in the imported file is still a pending change over there -
  // taking it (over its own applied copy, if both exist) is what the person
  // exporting it would expect, since that is the schema they were building.
  const byId = new Map(document.applied.map((type) => [type.id, type]));
  for (const draft of document.drafts) byId.set(draft.definition.id, draft.definition);
  return [...byId.values()];
}

export const POST: DryRouteHandler = async (context) => {
  const denied = await guard(context);
  if (denied) return denied;
  if ((context.params.slug ?? "") !== "import") {
    return jsonResponse({ error: "not_found", message: "Unknown content type document operation." }, 404);
  }

  let text: string;
  const contentType = context.request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    const form = await context.request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return jsonResponse({ error: "invalid_request", message: "A JSON file is required." }, 400);
    text = await file.text();
  } else {
    text = await context.request.text();
  }
  if (!text.trim()) return jsonResponse({ error: "invalid_request", message: "The file is empty." }, 400);

  let imported: ContentTypeDefinition[];
  try {
    imported = readImportedTypes(text);
  } catch (error) {
    const message = error instanceof SchemaDocumentError || error instanceof Error ? error.message : "The file could not be read.";
    return jsonResponse({ error: "invalid_request", message }, 400);
  }
  if (imported.length === 0) {
    return jsonResponse({ error: "invalid_request", message: "The file has no content types in it." }, 400);
  }

  const { store, document } = await loadDocument(context);
  const live = new Map(document.applied.map((type) => [type.id, type]));

  const added: string[] = [];
  const updated: string[] = [];
  const unchanged: string[] = [];
  let next = document;

  for (const type of imported) {
    const current = live.get(type.id);
    if (current && sameDefinition(current, type)) {
      unchanged.push(type.name);
      continue;
    }
    // `version` always comes from THIS project, never the file: it is the
    // optimistic lock `planSave`/`applySave` check, so an imported counter
    // from another install would fail every apply as a stale edit.
    next = withDraft(next, { ...type, version: current?.version ?? 0 });
    (current ? updated : added).push(type.name);
  }

  if (added.length > 0 || updated.length > 0) await store.write(next);

  return jsonResponse({
    imported: imported.length,
    added,
    updated,
    unchanged,
    drafts: next.drafts,
  });
};
