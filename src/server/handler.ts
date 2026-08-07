import { path as basePath } from "./config.js";
import type { DryRouteContext, DryRouteHandler } from "./context.js";
import { readRefreshCookie, readSessionCookie, resolveSession } from "./session.js";
import { verifySessionClaims } from "../lib/session-token.js";
import { hasValidCsrf, requiresCsrf } from "./csrf.js";
import * as storageRoute from "./routes/storage.js";
import * as iconsRoute from "./routes/icons.js";
import * as iconifyRoute from "./routes/iconify.js";
import * as contentTypesRoute from "./routes/content-types.js";
import * as contentEntriesRoute from "./routes/content-entries.js";
import * as richtextComponentsRoute from "./routes/richtext-components.js";
import * as pageComponentsRoute from "./routes/page-components.js";
import * as authRoute from "./routes/auth.js";
import * as aiRoute from "./routes/ai.js";
import * as memoryRoute from "./routes/memory.js";
import * as systemSettingsRoute from "./routes/system-settings.js";
import { requirePermission } from "./admin-access.js";
import {
  ICON_MANAGEMENT_RESOURCE_ID,
  PAGE_COMPONENTS_RESOURCE_ID,
  RICHTEXT_COMPONENTS_RESOURCE_ID,
} from "../content-types/permissions.js";
import { bodyLimitResponse, limitRequestBody } from "./request-limits.js";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "OPTIONS" | "HEAD";

/** Only the HTTP-verb exports are required to match `DryRouteHandler` - a
 * route module (`content-entries.ts`'s `checkAccess`, `ai.ts`'s
 * `createChatStream`/`acquireAiStreamSlot`/...) may export other helpers
 * too, reused directly by `ai-magic-write.ts` (see `status/magic-write.md`).
 * No index signature here on purpose: `route[request.method]` below casts
 * through `HttpMethod` instead, so an extra non-verb export never has to be
 * (impossibly) assignable to `DryRouteHandler`. */
type RouteModule = { [K in HttpMethod]?: DryRouteHandler };

function secureResponse(response: Response, request?: Request): Response {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (request && new URL(request.url).protocol === "https:") {
    response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return response;
}

/**
 * Direct replacement for the 6 `injectRoute` calls the old Astro integration
 * made - one router keyed by the path segment right after `${path}/api/`,
 * dispatching by HTTP method within it. `content-types` vs `content` matters
 * here only as distinct map keys (an exact segment match, not a prefix
 * match), so the two never collide despite one being a prefix of the other.
 */
const API_ROUTES: Record<string, RouteModule> = {
  storage: storageRoute,
  icons: iconsRoute,
  iconify: iconifyRoute,
  "content-types": contentTypesRoute,
  content: contentEntriesRoute,
  "richtext-components": richtextComponentsRoute,
  "page-components": pageComponentsRoute,
  auth: authRoute,
  ai: aiRoute,
  memory: memoryRoute,
  "system-settings": systemSettingsRoute,
};

export function isApiRequest(pathname: string): boolean {
  return pathname === `${basePath}/api` || pathname.startsWith(`${basePath}/api/`);
}

/**
 * The whole server-side API surface as one Fetch-API-shaped function. `env`
 * stands in for Astro's `context.locals.runtime.env` - the Node adapter has
 * nothing to put there (`{}`), a future Workers adapter passes the real
 * `env` argument from `fetch(request, env, ctx)` straight through.
 */
export async function handleApiRequest(
  request: Request,
  env: Record<string, unknown> = {},
): Promise<Response> {
  const url = new URL(request.url);
  const prefix = `${basePath}/api/`;
  if (!url.pathname.startsWith(prefix)) {
    return secureResponse(new Response("Not found", { status: 404 }), request);
  }

  const rest = url.pathname.slice(prefix.length);
  const slash = rest.indexOf("/");
  const segment = slash === -1 ? rest : rest.slice(0, slash);
  const slug = slash === -1 ? undefined : rest.slice(slash + 1);

  const route = API_ROUTES[segment];
  if (!route) return secureResponse(new Response("Not found", { status: 404 }), request);

  const handler = route[request.method as HttpMethod];
  if (!handler) return secureResponse(new Response("Method not allowed", { status: 405 }), request);

  const bodyTooLarge = bodyLimitResponse(request, segment, request.method, slug);
  if (bodyTooLarge) return secureResponse(bodyTooLarge, request);

  if (requiresCsrf(request, segment, slug)) {
    if (!hasValidCsrf(request)) {
      return secureResponse(new Response(JSON.stringify({ error: "csrf_failed", message: "CSRF token is missing or invalid." }), {
        status: 403,
        headers: { "Content-Type": "application/json" },
      }), request);
    }
  }

  // Resolved for every segment (including `auth`, so `GET /api/auth/session`
  // can read it straight off `context.session` instead of re-parsing the
  // cookie itself) but only ENFORCED for every segment except `auth` and a
  // public-media GET on `storage` - uploaded files back `<img>`s on the
  // public reader site, which has no session to send, so an anonymous file
  // read has to reach the route handler. `?tree` stays gated (it's a bulk
  // listing, not a single file), and `storage.ts`'s own `GET` still enforces
  // `context.session` itself before returning a *folder* listing - this
  // exemption only lets an unauthenticated request as far as the route, it
  // doesn't decide file-vs-folder (that needs a `stat()` only the route has).
  // Individual routes (`content-entries.ts`/`content-types.ts`) do
  // finer-grained resource/action authorization on top of this - see
  // `content-types/access.ts`.
  const isPublicStorageRead =
    segment === "storage" && request.method === "GET" && !url.searchParams.has("tree");
  // The rendered theme stylesheet (`routes/system-settings.ts`) has to load
  // before the admin shell even knows whether a visitor is signed in (the
  // login/register screens share the same `.dry` root and its color/font
  // tokens - see `lib/apply-system-theme.ts`), and carries nothing more
  // sensitive than the colors/fonts a Super Admin already chose to share
  // with every user - same public-GET treatment as `storage` above.
  const isPublicThemeCss = segment === "system-settings" && request.method === "GET";
  const sessionToken = readSessionCookie(request);
  const refreshToken = readRefreshCookie(request);
  const claims = sessionToken ? await verifySessionClaims(sessionToken) : null;
  const session = await resolveSession(request, env, claims);
  if (segment !== "auth" && !isPublicStorageRead && !isPublicThemeCss && !session) {
    return secureResponse(new Response(JSON.stringify({ error: "unauthenticated", message: "Sign in required." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    }), request);
  }

  const boundedRequest = limitRequestBody(request, segment, request.method, slug);
  const context: DryRouteContext = { request: boundedRequest, url, params: { slug }, env, session, sessionToken, refreshToken, sessionId: claims?.sessionId };
  // GET stays open to any authenticated session either way - an icon/
  // component's rendered output is read broadly across the app (nav icons,
  // RichText component blocks in arbitrary content), not just from these
  // features' own admin pages. Only the mutating methods need the
  // System-fieldset grant (`RoleEditor.tsx`'s Icon Management/Custom
  // Components toggles).
  if (segment === "icons" && request.method !== "GET") {
    const denied = await requirePermission(context, ICON_MANAGEMENT_RESOURCE_ID, "setting");
    if (denied) return secureResponse(denied, request);
  }
  if (segment === "richtext-components" && request.method !== "GET") {
    const denied = await requirePermission(context, RICHTEXT_COMPONENTS_RESOURCE_ID, "setting");
    if (denied) return secureResponse(denied, request);
  }
  // Every method, including `GET` - Component Builder has no separate
  // "view" permission, its `role.permissions` toggle is one all-or-nothing
  // `setting` grant (see `PAGE_COMPONENTS_RESOURCE_ID`), same collapse a
  // real singleton's schema gets in `permissionActionsFor`.
  if (segment === "page-components") {
    const denied = await requirePermission(context, PAGE_COMPONENTS_RESOURCE_ID, "setting");
    if (denied) return secureResponse(denied, request);
  }
  return secureResponse(await handler(context), request);
}
