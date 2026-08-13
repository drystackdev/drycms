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
import { listAiContentTypeDrafts, deleteAiContentTypeDraft, getAiContentTypeDraftsVersion } from "../ai-content-type-drafts.js";

function readId(context: DryRouteContext): string | undefined {
  const raw = context.params.slug as string | undefined;
  if (!raw) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return undefined;
  }
}

/** The data-version protocol (see `status/build-cache.md`, and
 * `routes/content-types.ts`'s identical `parseIfVersion` - kept as its own
 * copy here, same existing precedent of each route owning this helper
 * rather than sharing one). `undefined` if the client sent nothing or an
 * unparseable value, treated the same as "no cached version, always send
 * the full payload". */
function parseIfVersion(context: DryRouteContext): number | undefined {
  const header = context.request.headers.get("X-Data-Version");
  if (header === null) return undefined;
  const n = Number(header);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

/** `BuilderContentType.tsx` polls this every `AI_DRAFT_POLL_MS` while the
 * page is open, almost always with nothing new pending - the conditional
 * check below (mirroring `routes/content-types.ts`'s GET) lets that common
 * case answer with `{changed:false}` instead of re-sending every pending
 * draft's full `ContentTypeDefinition` (can be large - see
 * `ai-content-type-drafts.ts`'s own doc comment on why each draft gets its
 * own KV entry) on every single poll. */
export const GET: DryRouteHandler = async (context) => {
  if (!context.session) return unauthenticatedResponse();
  const denied = await requirePermission(context, CONTENT_TYPES_RESOURCE_ID, "setting", "You don't have permission to edit content type schemas.");
  if (denied) return denied;

  const version = await getAiContentTypeDraftsVersion(context.session.id, context.env);
  const ifVersion = parseIfVersion(context);
  if (ifVersion !== undefined && ifVersion === version) {
    return jsonResponse({ changed: false, version });
  }

  const drafts = await listAiContentTypeDrafts(context.session.id, context.env);
  return jsonResponse({ changed: true, version, drafts });
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
