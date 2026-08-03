import type { DryRouteContext } from "./context.js";
import { resolveAccess } from "../content-types/access.js";
import { getContentAdapters } from "./content-adapters.js";
import { forbiddenResponse, unauthenticatedResponse } from "./route-helpers.js";

/** Central authorization for APIs that mutate server-managed assets. Keeping
 * this at the dispatcher boundary prevents a route added later from relying
 * only on a UI-only "admin" flag. */
export async function requireSuperAdmin(context: DryRouteContext, message = "Super administrator access is required."): Promise<Response | null> {
  if (!context.session) return unauthenticatedResponse();
  const { schema, entries } = getContentAdapters(context);
  const allTypes = await schema.listContentTypes();
  const access = await resolveAccess(entries, allTypes, context.session);
  if (!access) return unauthenticatedResponse();
  return access.isSuperAdmin ? null : forbiddenResponse(message);
}
