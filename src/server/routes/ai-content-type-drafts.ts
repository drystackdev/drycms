/**
 * Browser-facing side of `../ai-content-type-drafts.ts`'s KV staging area -
 * what `content-types/draft-store.ts`'s `syncAiContentTypeDrafts()` polls on
 * `BuilderContentType.tsx` mount, and what it/`ApplyBuildDialog.tsx` call to
 * clear a draft once the admin has resolved it (applied it, overwrote it
 * with a newer AI proposal, or explicitly kept their own local draft
 * instead). Never called by the MCP write side (`routes/mcp.ts`'s
 * `propose_content_type`), which only ever creates a pending draft here.
 */
import type { DryRouteContext, DryRouteHandler } from "../context.js";
import { jsonResponse, unauthenticatedResponse } from "../route-helpers.js";
import { requirePermission } from "../admin-access.js";
import { CONTENT_TYPES_RESOURCE_ID } from "../../content-types/permissions.js";
import { listAiContentTypeDrafts, deleteAiContentTypeDraft } from "../ai-content-type-drafts.js";

function readId(context: DryRouteContext): string | undefined {
  const raw = context.params.slug as string | undefined;
  if (!raw) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return undefined;
  }
}

export const GET: DryRouteHandler = async (context) => {
  if (!context.session) return unauthenticatedResponse();
  const denied = await requirePermission(context, CONTENT_TYPES_RESOURCE_ID, "setting", "You don't have permission to edit content type schemas.");
  if (denied) return denied;
  const drafts = await listAiContentTypeDrafts(context.session.id, context.env);
  return jsonResponse({ drafts });
};

export const DELETE: DryRouteHandler = async (context) => {
  if (!context.session) return unauthenticatedResponse();
  const denied = await requirePermission(context, CONTENT_TYPES_RESOURCE_ID, "setting", "You don't have permission to edit content type schemas.");
  if (denied) return denied;
  const id = readId(context);
  if (!id) return jsonResponse({ error: "invalid_request", message: "An id is required." }, 400);
  await deleteAiContentTypeDraft(context.session.id, id, context.env);
  return new Response(null, { status: 204 });
};
