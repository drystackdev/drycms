/**
 * Browser-facing side of `../ai-page-source-flags.ts`'s global "AI wrote
 * this page.tsx, not built since" tracker - what `PageBuilder.tsx` polls
 * while open to light up the file tree's red dot. Read-only: there's no
 * DELETE, unlike `ai-content-type-drafts.ts` - clearing only ever happens
 * automatically, when `routes/pages-build.ts`'s `publishOne` records a real
 * build for that path.
 */
import type { DryRouteContext, DryRouteHandler } from "../context.js";
import { jsonResponse, unauthenticatedResponse } from "../route-helpers.js";
import { requirePermission } from "../admin-access.js";
import { PAGE_BUILDER_RESOURCE_ID } from "../../content-types/permissions.js";
import { listAiPageSourceFlags, getAiPageSourceFlagsVersion } from "../ai-page-source-flags.js";

/** Same data-version protocol as `routes/content-types.ts`'s
 * `parseIfVersion` and its other per-route copies (`ai-content-type-drafts.ts`,
 * `mcp.ts`) - kept as its own copy here too, matching that precedent. */
function parseIfVersion(context: DryRouteContext): number | undefined {
  const header = context.request.headers.get("X-Data-Version");
  if (header === null) return undefined;
  const n = Number(header);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

export const GET: DryRouteHandler = async (context) => {
  if (!context.session) return unauthenticatedResponse();
  const denied = await requirePermission(context, PAGE_BUILDER_RESOURCE_ID, "setting", "You don't have permission to use the Page Builder.");
  if (denied) return denied;

  const version = await getAiPageSourceFlagsVersion(context.env);
  const ifVersion = parseIfVersion(context);
  if (ifVersion !== undefined && ifVersion === version) {
    return jsonResponse({ changed: false, version });
  }
  const flags = await listAiPageSourceFlags(context.env);
  return jsonResponse({ changed: true, version, flags });
};
