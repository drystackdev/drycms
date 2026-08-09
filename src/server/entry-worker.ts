import { handleApiRequest, isApiRequest } from "./handler.js";
import { injectClientConfig } from "./client-config.js";
import { path as adminPath, content } from "./config.js";
import { isEdgeCacheable, readEdgeCache, storeEdgeCache } from "./app-router/edge-cache.js";
import { sitemapEdgeCacheTtlSeconds } from "./app-router/sitemap.js";
import { createPagesRegistryAdapter } from "../content-types/engine/index.js";
import { guardPageRequest } from "./page-guard.js";
import { handlePageRequest } from "./page-handler.js";
import { handleVeiRoute } from "./vei-routes.js";

/**
 * Cloudflare Workers entry - bundled by `vite build --ssr
 * src/server/entry-worker.ts` (mirrors `entry-node.ts`'s own build line),
 * deployed with `wrangler deploy`. `handler.ts`/`page-handler.ts`/
 * `page-guard.ts` are already Fetch-API-shaped (`Request` in, `Response`
 * out) - see `adapters/types.ts`'s own doc comment - so unlike
 * `adapters/node.ts`, no real bridging code is needed here, just the
 * routing order `entry-node.ts` also uses (static asset, then App Router
 * page, then the admin shell) wired to Workers' own primitives: static
 * files come from the `assets` binding (`wrangler.jsonc`) instead of
 * `node:fs`, and `env`/`ctx` are `fetch(request, env, ctx)`'s real
 * arguments instead of Node's `{}` stand-in (see `context.ts`'s doc
 * comment).
 */
interface WorkerFetcher {
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
}

export interface WorkerEnv extends Record<string, unknown> {
  /** Workers Static Assets binding - serves `dist/client/**` (the same
   * build `entry-node.ts` reads off disk), configured via
   * `wrangler.jsonc`'s `assets.binding`. */
  ASSETS: WorkerFetcher;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  // See `adapters/node.ts`'s `applySecurityHeaders` for why this is
  // `SAMEORIGIN` rather than `DENY`.
  "X-Frame-Options": "SAMEORIGIN",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

/** Same headers `adapters/node.ts`'s `applySecurityHeaders` sets on every
 * response - applied uniformly here instead, since Workers responses never
 * pass through a bridge layer like Node's `sendFetchResponse` does.
 * `handleApiRequest` already sets its own copy (`handler.ts`'s
 * `secureResponse`) - the `!headers.has()` guard (mirroring
 * `applySecurityHeaders`'s `!res.hasHeader()`) makes re-wrapping those
 * responses here a no-op rather than a double-set. */
function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(key)) headers.set(key, value);
  }
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** `env.ASSETS.fetch()` for `index.html`, with the same client-config
 * `<script>` injection `entry-node.ts`'s `serveAdminShell` does - just
 * sourced from the Assets binding's text instead of a cached
 * `readFileSync` read (nothing to cache across requests in a Workers
 * isolate the way `entry-node.ts` caches `indexHtml` at module scope for a
 * whole process). */
async function serveAdminShell(env: WorkerEnv, request: Request): Promise<Response> {
  const shellUrl = new URL("/index.html", request.url);
  const shellResponse = await env.ASSETS.fetch(shellUrl.toString());
  const html = await shellResponse.text();
  return new Response(injectClientConfig(html), { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (isApiRequest(url.pathname)) {
      return withSecurityHeaders(await handleApiRequest(request, env));
    }

    const guardResponse = await guardPageRequest(request, env);
    if (guardResponse) return withSecurityHeaders(guardResponse);

    const veiResponse = await handleVeiRoute(request, env);
    if (veiResponse) return withSecurityHeaders(veiResponse);

    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return withSecurityHeaders(new Response("Bad request", { status: 400 }));
    }

    const isAdminPath = pathname === adminPath || pathname.startsWith(`${adminPath}/`);
    // Mục 14 (`plans/app-r2.md`): `sitemap.xml` gets its OWN TTL, decoupled
    // from `pagesCacheEdgeTtl`'s own on/off toggle - turning page caching
    // off was never meant to reach it. `1` here is a cheap sentinel, not the
    // real value: `isEdgeCacheable` only needs to know "positive" to decide
    // caching is enabled AT ALL, and the real value
    // (`sitemapEdgeCacheTtlSeconds`, a D1 query) is only computed below, on
    // an actual cache MISS - paying for it on every hit would undercut the
    // whole point of caching this route in the first place.
    const isSitemap = !isAdminPath && pathname === "/sitemap.xml";

    // Ahead of the asset branch, not just the page branch: only the App
    // Router below ever stores an entry, so a hit here is by construction a
    // page - and answering from it skips the `env.ASSETS.fetch` miss that
    // every non-asset URL would otherwise pay on the way to `handlePageRequest`.
    const cacheable = !isAdminPath && isEdgeCacheable(request, isSitemap ? 1 : undefined);
    if (cacheable) {
      const hit = await readEdgeCache(request);
      if (hit) return hit;
    }

    // Real static assets (`/assets/main-abc123.js`, images, ...) first -
    // `pathname === "/"` is excluded the same way `entry-node.ts`'s
    // `tryServeStaticAsset` excludes it: the built `dist/client/index.html`
    // is the ADMIN shell, not a site-root page, so "/" always continues on
    // to the App Router / admin-shell branches below instead.
    if (pathname !== "/") {
      const assetResponse = await env.ASSETS.fetch(request);
      if (assetResponse.status !== 404) return withSecurityHeaders(assetResponse);
    }

    if (!isAdminPath) {
      const pageResponse = await handlePageRequest(request, env);
      if (pageResponse) {
        // Stored AFTER the security headers are on, so a later cache hit
        // carries the exact bytes and headers this render would have sent.
        const secured = withSecurityHeaders(pageResponse);
        if (!cacheable) return secured;
        const ttlSeconds = isSitemap
          ? await sitemapEdgeCacheTtlSeconds(createPagesRegistryAdapter(content, env), Date.now())
          : undefined;
        return storeEdgeCache(request, secured, ctx, ttlSeconds);
      }
      return withSecurityHeaders(
        new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } }),
      );
    }

    return withSecurityHeaders(await serveAdminShell(env, request));
  },
};
