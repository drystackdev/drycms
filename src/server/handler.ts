import { path as basePath } from "./config.js";
import type { DryRouteContext, DryRouteHandler } from "./context.js";
import { readBearerToken, readRefreshCookie, readSessionCookie, resolveSession } from "./session.js";
import { verifySessionClaims } from "../lib/session-token.js";
import { resolveMcpToken } from "./auth-security.js";
import { getContentAdapters } from "./content-adapters.js";
import { hasValidCsrf, requiresCsrf } from "./csrf.js";
import { resolveSiteOrigin } from "./app-router/site-origin.js";
import { protectedResourceMetadataUrl } from "./oauth-metadata.js";
import * as storageRoute from "./routes/storage.js";
import * as iconsRoute from "./routes/icons.js";
import * as iconifyRoute from "./routes/iconify.js";
import * as contentTypesRoute from "./routes/content-types.js";
import * as aiContentTypeDraftsRoute from "./routes/ai-content-type-drafts.js";
import * as contentEntriesRoute from "./routes/content-entries.js";
import * as richtextComponentsRoute from "./routes/richtext-components.js";
import * as authRoute from "./routes/auth.js";
import * as aiRoute from "./routes/ai.js";
import * as mcpRoute from "./routes/mcp.js";
import * as oauthRoute from "./routes/oauth.js";
import * as memoryRoute from "./routes/memory.js";
import * as systemSettingsRoute from "./routes/system-settings.js";
import * as dryHttpRoute from "./routes/dry-http.js";
import * as pagesBuildRoute from "./routes/pages-build.js";
import * as aiPageSourceFlagsRoute from "./routes/ai-page-source-flags.js";
import * as typesCacheRoute from "./routes/types-cache.js";
import * as pagesSourceRoute from "./routes/pages-source.js";
import * as pageSourceAiRoute from "./routes/ai-page-source-write.js";
import * as pagesSourceGithubSyncRoute from "./routes/pages-source-github-sync.js";
import * as pagesSourceGithubRestoreRoute from "./routes/pages-source-github-restore.js";
import * as pageHistoryRoute from "./routes/page-history.js";
import * as contentHistoryRoute from "./routes/content-history.js";
import * as gitRoute from "./routes/git.js";
import * as builtAssetsRoute from "./routes/built-assets.js";
import * as assetHrefsRoute from "./routes/asset-hrefs.js";
import * as backupRoute from "./routes/backup.js";
import * as storageBackupRoute from "./routes/storage-backup.js";
import { requirePermission, requirePermissionOrVeiAccess } from "./admin-access.js";
import {
  ICON_MANAGEMENT_RESOURCE_ID,
  PAGE_BUILDER_RESOURCE_ID,
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
  "ai-content-type-drafts": aiContentTypeDraftsRoute,
  content: contentEntriesRoute,
  "richtext-components": richtextComponentsRoute,
  auth: authRoute,
  ai: aiRoute,
  mcp: mcpRoute,
  // OAuth 2.1 Authorization Server for `mcp` (`status/mcp-oauth.md`) -
  // `authorize`/`register`/`token` must reach their handlers with no
  // session at all (a client registers/exchanges a code before any login
  // exists), so `oauth` is exempted from the blanket session gate below the
  // same way `auth` is; `consent`/`consent-info` self-check `context.session`
  // instead, matching `routes/auth.ts`'s `mcp-tokens` precedent.
  oauth: oauthRoute,
  memory: memoryRoute,
  "system-settings": systemSettingsRoute,
  "dry-http": dryHttpRoute,
  "pages-build": pagesBuildRoute,
  "ai-page-source-flags": aiPageSourceFlagsRoute,
  "types-cache": typesCacheRoute,
  "pages-source": pagesSourceRoute,
  "page-source-ai": pageSourceAiRoute,
  "github-sync": pagesSourceGithubSyncRoute,
  "github-restore": pagesSourceGithubRestoreRoute,
  "page-history": pageHistoryRoute,
  // No dispatcher-level gate here, unlike `page-history` above - a request
  // is scoped to ONE entry/singleton/schema (`?type=`/`?schema=`) whose OWN
  // permission grant is only known once the route reads the query string,
  // so `content-history.ts` authorizes itself per-request - same
  // self-gating precedent as `dry-http`/`pages-build` (see the comment
  // above `github-sync` below).
  "content-history": contentHistoryRoute,
  // The git smart-HTTP proxy the browser working copy talks to
  // (`routes/git.ts`) - same permission as `pages-source` below, since a
  // clone through it IS a read of that same executable tenant source.
  git: gitRoute,
  "built-assets": builtAssetsRoute,
  "asset-hrefs": assetHrefsRoute,
  // No dispatcher-level gate below for `backup` - unlike `github-sync`/
  // `github-restore`'s grantable `PAGE_BUILDER_RESOURCE_ID` permission, a
  // full database backup/restore has no Role toggle at all (same
  // `superAdminOnly`, not-a-System-toggle reasoning `DryLayout.tsx`'s `NAV`
  // entry documents for `ai-keys`) - `routes/backup.ts`'s own `GET`/`POST`
  // each call `requireSuperAdmin` directly instead, same self-gating
  // precedent as `routes/ai.ts`'s Magic Chat check.
  backup: backupRoute,
  // Same self-gating (no dispatcher-level check) and same reasoning as
  // `backup` above - a Media storage backup/restore has no Role toggle
  // either.
  "storage-backup": storageBackupRoute,
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
  // A built page's compiled JS (mục 7, `routes/built-assets.ts`) - a
  // visitor's browser fetches this to hydrate, with no session cookie at
  // all. Same public treatment as `storage`/`system-settings` GET above -
  // nothing here is more sensitive than site source already compiled
  // client-side to produce the page a visitor is currently looking at.
  const isPublicBuiltAsset = segment === "built-assets" && request.method === "GET";
  const sessionToken = readSessionCookie(request);
  const refreshToken = readRefreshCookie(request);
  const claims = sessionToken ? await verifySessionClaims(sessionToken) : null;
  let session = await resolveSession(request, env, claims);
  const boundedRequest = limitRequestBody(request, segment, request.method, slug);
  const context: DryRouteContext = { request: boundedRequest, url, params: { slug }, env, session, sessionToken, refreshToken, sessionId: claims?.sessionId };

  // `mcp` (`status/mcp-server.md`) authenticates external MCP clients (Claude
  // Desktop, Claude Code, ...) with a Personal Access Token instead of the
  // session cookie - they're not a browser, so `session` above is always
  // null for them. `resolveMcpToken` is a cheap KV lookup (just the owning
  // user id); `name`/`email` are then read fresh off the `user` entry
  // itself (not denormalized into the token at creation time) so a PAT never
  // goes stale the way a long-lived cached claim would - unlike a cookie
  // session, a PAT has no refresh cycle to otherwise pick that up. Every
  // permission check downstream (`checkAccess`) re-resolves the user's
  // grants from `session.id` regardless, so this only affects the identity
  // fields carried alongside it (e.g. the email `syncEntryMediaFolder` uses).
  if (!session && segment === "mcp") {
    const bearer = readBearerToken(request);
    const resolved = bearer ? await resolveMcpToken(bearer, env) : null;
    if (resolved) {
      const { schema, entries } = getContentAdapters(context);
      const allTypes = await schema.listContentTypes();
      const userType = allTypes.find((type) => type.name === "user");
      const entry = userType ? await entries.getEntry(userType, allTypes, resolved.userId) : null;
      if (entry) {
        session = { id: entry.id, name: String(entry.value.name ?? ""), email: String(entry.value.email ?? "") };
        context.session = session;
      }
    }
  }

  if (segment !== "auth" && segment !== "oauth" && !isPublicStorageRead && !isPublicThemeCss && !isPublicBuiltAsset && !session) {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    // This is the response an unauthenticated `mcp` request actually gets
    // (the bearer-token branch above never set `session`) - `mcp.ts`'s own
    // matching check never runs for real HTTP traffic, only a direct-call
    // unit test bypassing this dispatcher, so the RFC 9728 discovery pointer
    // has to be attached here to ever reach a real client.
    if (segment === "mcp") {
      headers["WWW-Authenticate"] = `Bearer resource_metadata="${protectedResourceMetadataUrl(resolveSiteOrigin(url))}"`;
    }
    return secureResponse(new Response(JSON.stringify({ error: "unauthenticated", message: "Sign in required." }), {
      status: 401,
      headers,
    }), request);
  }
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
  // `github-sync` (pushing a snapshot commit of pages-source - see
  // `status/pages-source-github-versioning.md`) is only meant to be called
  // by the build orchestrator - gated behind the `system-build` "Page
  // Builder" (code-edit) grant (`plans/app-r2.md` quyết định #12), every
  // method including GET (same "one all-or-nothing toggle" shape as Page
  // Components above, not a real content type with separate actions).
  // `types-cache` stays open to any authenticated session - it only ever
  // serves the generated `.d.ts` (see `routes/types-cache.ts`), same
  // "broadly read, narrowly written" treatment `icons`/`richtext-components`
  // GET already get.
  //
  // `dry-http` and `pages-build` are DELIBERATELY NOT blanket-gated here
  // anymore ("code + content = page" - a role that can edit a
  // collection/singleton can also build the pages that depend on it, not
  // just a role with the code-edit permission) - each does its own
  // per-resource authorization internally instead, since which resource(s)
  // are involved is only known once the request body/registered
  // dependencies are read (see `routes/dry-http.ts`'s `POST` and
  // `routes/pages-build.ts`'s `resolvePublishAccess`/`canPublishPath`).
  if (segment === "github-sync") {
    const denied = await requirePermission(context, PAGE_BUILDER_RESOURCE_ID, "setting");
    if (denied) return secureResponse(denied, request);
  }
  // Page source is executable tenant code, so writes always need the code-
  // edit grant, and a content-only session still can't reach anything here
  // merely by knowing the endpoint - but a READ (this segment's `GET`,
  // `git`'s `git-upload-pack` clone/fetch) also admits a role with no
  // code-edit grant that can already edit at least one real content type
  // (`requirePermissionOrVeiAccess`) - it needs to read page source to
  // render a VEI preview, even though it can never write any. `git-receive-
  // pack` (push) is a write and never gets this fallback.
  const isGitConfigRead = segment === "git" && request.method === "GET" && slug === "config";
  if (segment === "pages-source" || (segment === "git" && !isGitConfigRead)) {
    const isReadOnly =
      (segment === "pages-source" && request.method === "GET") ||
      (segment === "git" && gitRoute.isGitReadRequest(request.method, slug, url.searchParams));
    const denied = isReadOnly
      ? await requirePermissionOrVeiAccess(context, PAGE_BUILDER_RESOURCE_ID, "setting")
      : await requirePermission(context, PAGE_BUILDER_RESOURCE_ID, "setting");
    if (denied) return secureResponse(denied, request);
  }
  // `page-source-ai` (`status/page-editor-magic-chat.md`) is the Page
  // Editor's own Magic Chat, gated on the same merged Page Builder
  // permission as `pages-source`'s write methods above - it never writes to
  // storage itself (see that route's own doc comment), but reading/editing
  // page source through AI is still part of the same "Page Builder" surface,
  // not a separately grantable action.
  if (segment === "page-source-ai") {
    const denied = await requirePermission(context, PAGE_BUILDER_RESOURCE_ID, "setting");
    if (denied) return secureResponse(denied, request);
  }
  // `github-restore` (listing GitHub snapshot commits, and pulling one to
  // overwrite `pagesSourceStorage`) is part of the Code Editor's Settings
  // surface (no UI calls it since Page Editor's History/Reset dialogs were
  // deleted; the git working-copy work is what will replace them) - gated on
  // the same merged Page Builder permission as `pages-source`'s own write
  // methods above, every method including GET (same "one all-or-nothing
  // toggle" shape as Page Components).
  if (segment === "github-restore" || segment === "page-history") {
    const denied = await requirePermission(context, PAGE_BUILDER_RESOURCE_ID, "setting");
    if (denied) return secureResponse(denied, request);
  }
  return secureResponse(await handler(context), request);
}
