import { path as basePath } from "./config.js";
import type { DryRouteContext, DryRouteHandler } from "./context.js";
import { readSessionCookie, resolveSession } from "./session.js";
import * as storageRoute from "./routes/storage.js";
import * as iconsRoute from "./routes/icons.js";
import * as iconifyRoute from "./routes/iconify.js";
import * as contentTypesRoute from "./routes/content-types.js";
import * as contentEntriesRoute from "./routes/content-entries.js";
import * as richtextComponentsRoute from "./routes/richtext-components.js";
import * as authRoute from "./routes/auth.js";
import * as keyValueRoute from "./routes/key-value.js";

type RouteModule = Record<string, DryRouteHandler | undefined>;

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
    return new Response("Not found", { status: 404 });
  }

  const rest = url.pathname.slice(prefix.length);
  const slash = rest.indexOf("/");
  const segment = slash === -1 ? rest : rest.slice(0, slash);
  const slug = slash === -1 ? undefined : rest.slice(slash + 1);

  const route = API_ROUTES[segment];
  if (!route) return new Response("Not found", { status: 404 });

  const handler = route[request.method];
  if (!handler) return new Response("Method not allowed", { status: 405 });

  // Resolved for every segment (including `auth`, so `GET /api/auth/session`
  // can read it straight off `context.session` instead of re-parsing the
  // cookie itself) but only ENFORCED for every segment except `auth` -
  // register/login/logout have to be reachable with no session to begin
  // with. Individual routes (`content-entries.ts`/`content-types.ts`) do
  // finer-grained resource/action authorization on top of this - see
  // `content-types/access.ts`.
  const sessionToken = readSessionCookie(request);
  const session = await resolveSession(request, env);
  if (segment !== "auth" && !session) {
    return new Response(JSON.stringify({ error: "unauthenticated", message: "Sign in required." }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const context: DryRouteContext = { request, url, params: { slug }, env, session, sessionToken };
  return handler(context);
}
