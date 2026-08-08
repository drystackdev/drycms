import type { DryRouteHandler } from "../context.js";
import { getContentAdapters } from "../content-adapters.js";
import { errorResponse, jsonResponse } from "../route-helpers.js";
import { readBuiltPage, removeBuiltPage, writeBuiltPage } from "../app-router/built-pages-storage.js";
import type { PageDependency, PageRecord } from "../../content-types/engine/pages-registry-types.js";

/**
 * Write side of the app-r2 build pipeline (`plans/app-r2.md` mục 12) - the
 * browser build orchestrator calls this once per page, after it has already
 * compiled+rendered the page client-side (this endpoint does no rendering
 * or compiling itself - decision #2, "server không SSR gì cả"). Not wired
 * into anything that serves real traffic yet - see
 * `built-pages-storage.ts`'s doc comment.
 */
interface PagesBuildRequestBody {
  pathname: string;
  html: string;
  /** Caller-minted per-build id (e.g. `crypto.randomUUID()`) - see
   * `built-pages-storage.ts`'s `immutableKeyFor` doc comment for why this
   * isn't derived server-side. */
  buildId: string;
  deps: PageDependency[];
  inSitemap: boolean;
  /** Epoch ms in the future = stage this build for `schedule` (mục 9)
   * instead of publishing it immediately; omitted/`null`/past = publish now. */
  publishAt?: number | null;
}

function isValidBody(value: unknown): value is PagesBuildRequestBody {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  return (
    typeof body.pathname === "string" &&
    body.pathname.startsWith("/") &&
    typeof body.html === "string" &&
    typeof body.buildId === "string" &&
    body.buildId.length > 0 &&
    Array.isArray(body.deps) &&
    typeof body.inSitemap === "boolean"
  );
}

export const POST: DryRouteHandler = async (context) => {
  try {
    const raw: unknown = await context.request.json();
    if (!isValidBody(raw)) return errorResponse(new Error("Invalid pages-build request body."));

    const now = Date.now();
    const publishAt = typeof raw.publishAt === "number" && raw.publishAt > now ? raw.publishAt : null;
    const { immutableKey, liveKey } = await writeBuiltPage(context, raw.pathname, raw.buildId, raw.html, {
      publishNow: publishAt === null,
    });

    const record: PageRecord = {
      path: raw.pathname,
      objectKey: liveKey ?? immutableKey,
      buildId: raw.buildId,
      builtAt: now,
      inSitemap: raw.inSitemap,
      publishAt,
    };
    const { pagesRegistry } = getContentAdapters(context);
    await pagesRegistry.recordBuild(record, raw.deps);

    return jsonResponse({ record }, 200);
  } catch (error) {
    return errorResponse(error);
  }
};

/** No `?path=` - the admin "Build" page's status list (mục 11): every
 * `_pages` row plus which paths are currently stale (`pagesRegistry.
 * listStalePaths()`, a JOIN against `_versions`), combined into one
 * response so the UI does 1 request instead of N. */
async function handleList(context: Parameters<DryRouteHandler>[0]): Promise<Response> {
  const { pagesRegistry } = getContentAdapters(context);
  const [pages, stale] = await Promise.all([pagesRegistry.listAllPages(), pagesRegistry.listStalePaths()]);
  const staleByPath = new Map(stale.map((s) => [s.path, s.resource]));
  return jsonResponse({
    pages: pages.map((page) => ({ ...page, staleResource: staleByPath.get(page.path) ?? null })),
  });
}

/** `?path=` - reads back what's currently live for a path without going
 * through the (still dark) public serve path (QA/admin tooling). No
 * `?path=` at all - the list above, for the admin "Build" page. Query
 * param, not `readSlug`'s rest-segment convention - this route has no
 * natural "file tree" shape to hang a path off of. */
export const GET: DryRouteHandler = async (context) => {
  try {
    const pathname = context.url.searchParams.get("path");
    if (!pathname) return await handleList(context);
    if (!pathname.startsWith("/")) {
      return errorResponse(new Error('"path" must start with "/".'));
    }
    const html = await readBuiltPage(context, pathname);
    if (html === null) return jsonResponse({ error: "not_found", message: `No built page at "${pathname}".` }, 404);
    return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
  } catch (error) {
    return errorResponse(error);
  }
};

export const DELETE: DryRouteHandler = async (context) => {
  try {
    const pathname = context.url.searchParams.get("path");
    if (!pathname || !pathname.startsWith("/")) {
      return errorResponse(new Error('A "path" query param starting with "/" is required.'));
    }
    await removeBuiltPage(context, pathname);
    const { pagesRegistry } = getContentAdapters(context);
    await pagesRegistry.removePage(pathname);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
};
