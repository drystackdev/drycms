import type { DryRouteContext, DryRouteHandler } from "../context.js";
import { jsonResponse, unauthenticatedResponse } from "../route-helpers.js";
import { getContentAdapters } from "../content-adapters.js";
import { requirePermission } from "../admin-access.js";
import { CONTENT_TYPES_RESOURCE_ID } from "../../content-types/permissions.js";
import { createStorageSchemaDocumentStore } from "../schema-document-storage.js";
import { emptySchemaDocument, type SchemaDraft, type SchemaDraftSource } from "../../content-types/schema-document.js";
import type { ContentTypeDefinition } from "../../content-types/types.js";

/**
 * The staged (not yet applied) half of `content/types.json`
 * (`schema-document.ts`) - what the IndexedDB draft store used to hold
 * before a content-type draft became part of the repo.
 *
 * Only `drafts` is reachable here, never `applied`: a live schema change has
 * to go through `routes/content-types.ts`'s "Apply and build", which runs
 * the real table migration and writes the applied definition itself. This
 * route is the plain read/write seam the Content Types UI uses for the
 * staging area, and the copy it maintains in page-source storage is what
 * keeps drafts visible to a second browser (and to a tenant with no git
 * configured at all) - the Page Builder's git working copy writes the same
 * file for the commit that lands with the apply.
 */
async function loadDocument(context: DryRouteContext) {
  // Reading through the schema adapter first guarantees the bootstrap/seed
  // has run, so the store never answers `null` here for a fresh project.
  await getContentAdapters(context).schema.listContentTypes();
  const store = createStorageSchemaDocumentStore(context);
  return { store, document: (await store.read()) ?? emptySchemaDocument() };
}

export const GET: DryRouteHandler = async (context) => {
  if (!context.session) return unauthenticatedResponse();
  const denied = await requirePermission(context, CONTENT_TYPES_RESOURCE_ID, "setting", "You don't have permission to edit content type schemas.");
  if (denied) return denied;

  const { document } = await loadDocument(context);
  return jsonResponse({ revision: document.revision, drafts: document.drafts });
};

/** Replaces the whole staging area in one write - the client always holds
 * the complete set (it renders it), so a per-draft PATCH would only add
 * ordering hazards between two tabs for no benefit. `applied` is carried
 * over from whatever the server currently has, never from the request. */
export const PUT: DryRouteHandler = async (context) => {
  if (!context.session) return unauthenticatedResponse();
  const denied = await requirePermission(context, CONTENT_TYPES_RESOURCE_ID, "setting", "You don't have permission to edit content type schemas.");
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
