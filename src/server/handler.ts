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
import * as authRoute from "./routes/auth.js";
import * as keyValueRoute from "./routes/key-value.js";
import * as aiRoute from "./routes/ai.js";
import { requireSuperAdmin } from "./admin-access.js";
import { bodyLimitResponse, limitRequestBody } from "./request-limits.js";

type RouteModule = Record<string, DryRouteHandler | undefined>;

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
  auth: authRoute,
  "key-value": keyValueRoute,
  ai: aiRoute,
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

  const handler = route[request.method];
  if (!handler) return secureResponse(new Response("Method not allowed", { status: 405 }), request);

  const bodyTooLarge = bodyLimitResponse(request, segment, request.method);
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
  // cookie itself) but only ENFORCED for every segment except `auth` -
  // register/login/logout have to be reachable with no session to begin
  // with. Individual routes (`content-entries.ts`/`content-types.ts`) do
  // finer-grained resource/action authorization on top of this - see
  // `content-types/access.ts`.
  const sessionToken = readSessionCookie(request);
  const refreshToken = readRefreshCookie(request);
  const claims = sessionToken ? await verifySessionClaims(sessionToken) : null;
  const session = await resolveSession(request, env);
  if (segment !== "auth" && !session) {
    return secureResponse(new Response(JSON.stringify({ error: "unauthenticated", message: "Sign in required." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    }), request);
  }

  const boundedRequest = limitRequestBody(request, segment, request.method);
  const context: DryRouteContext = { request: boundedRequest, url, params: { slug }, env, session, sessionToken, refreshToken, sessionId: claims?.sessionId };
  if ((segment === "icons" || segment === "richtext-components") && request.method !== "GET") {
    const denied = await requireSuperAdmin(context);
    if (denied) return secureResponse(denied, request);
  }
  return secureResponse(await handler(context), request);
}
