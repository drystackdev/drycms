import { content } from "./config.js";
import type { DryRouteContext } from "./context.js";
import { resolveAccess } from "../content-types/access.js";
import { createContentEngineAdapter } from "../content-types/engine/index.js";
import type { ContentEngineAdapter } from "../content-types/engine/types.js";
import { createContentEntryEngineAdapter } from "../content-types/engine/index.js";
import type { ContentEntryEngineAdapter } from "../content-types/engine/entries-types.js";
import { forbiddenResponse, unauthenticatedResponse } from "./route-helpers.js";

const moduleSchemaAdapter: ContentEngineAdapter | undefined =
  content.engine !== "D1" ? createContentEngineAdapter(content) : undefined;
const moduleEntryAdapter: ContentEntryEngineAdapter | undefined =
  content.engine !== "D1" ? createContentEntryEngineAdapter(content) : undefined;

/** Central authorization for APIs that mutate server-managed assets. Keeping
 * this at the dispatcher boundary prevents a route added later from relying
 * only on a UI-only "admin" flag. */
export async function requireSuperAdmin(context: DryRouteContext, message = "Super administrator access is required."): Promise<Response | null> {
  if (!context.session) return unauthenticatedResponse();
  const schemaAdapter = moduleSchemaAdapter ?? createContentEngineAdapter(content, context.env);
  const entryAdapter = moduleEntryAdapter ?? createContentEntryEngineAdapter(content, context.env);
  const allTypes = await schemaAdapter.listContentTypes();
  const access = await resolveAccess(entryAdapter, allTypes, context.session);
  if (!access) return unauthenticatedResponse();
  return access.isSuperAdmin ? null : forbiddenResponse(message);
}
