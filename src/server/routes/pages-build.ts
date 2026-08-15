import type { DryRouteHandler } from "../context.js";
import { getContentAdapters } from "../content-adapters.js";
import { errorResponse, forbiddenResponse, jsonResponse, unauthenticatedResponse } from "../route-helpers.js";
import { readBuiltPage, removeBuiltPage, writeBuiltAsset, writeBuiltPage } from "../app-router/built-pages-storage.js";
import type { PageDependency, PageRecord } from "../../content-types/engine/pages-registry-types.js";
import { resolveAccessCached, type AccessInfo } from "../../content-types/access.js";
import { PAGE_BUILDER_RESOURCE_ID } from "../../content-types/permissions.js";
import type { ContentTypeDefinition } from "../../content-types/types.js";
import { clearAiPageSourceWrite } from "../ai-page-source-flags.js";

/**
 * Write side of the app-r2 build pipeline (`plans/app-r2.md` mục 12) - the
 * browser build orchestrator calls this once per page, after it has already
 * compiled+rendered the page client-side (this endpoint does no rendering
 * or compiling itself - decision #2, "server không SSR gì cả"). Not wired
 * into anything that serves real traffic yet - see
 * `built-pages-storage.ts`'s doc comment.
 *
 * Authorization is per-resource, not a blanket segment gate anymore
 * (`handler.ts` no longer requires `PAGE_BUILDER_RESOURCE_ID` for this
 * segment) - "code + content = page": a role with the code-edit permission
 * can build/publish ANY page, same as before; a role that can only edit a
 * collection/singleton can (re)publish a page IF AND ONLY IF every resource
 * that page's last recorded build actually depended on (`_page_deps`, via
 * `PagesRegistryAdapter.listResourcesByPath`) is something that role can
 * view - see `resolvePublishAccess`/`canPublishPath` below. A page that has
 * never been built has nothing recorded yet, so its first build always
 * requires the code-edit permission.
 */
async function resolvePublishAccess(context: Parameters<DryRouteHandler>[0]): Promise<
  | { ok: true; access: AccessInfo; allTypes: ContentTypeDefinition[]; hasCodePermission: boolean }
  | { ok: false; response: Response }
> {
  if (!context.session) return { ok: false, response: unauthenticatedResponse() };
  const { schema, entries } = getContentAdapters(context);
  const allTypes = await schema.listContentTypes();
  const access = await resolveAccessCached(context, entries, allTypes, context.session);
  if (!access) return { ok: false, response: unauthenticatedResponse() };
  return { ok: true, access, allTypes, hasCodePermission: access.can(PAGE_BUILDER_RESOURCE_ID, "setting") };
}

/** Whether `access` (lacking the code-edit permission) may (re)publish
 * `pathname` - every resource `pagesRegistry` has on record for it from its
 * last real build must be one `access` can already view/setting on.
 * Deliberately does NOT consult the request body's own self-reported
 * `deps` - only the server's own prior record is trustworthy, or a role
 * without the code-edit permission could claim any `deps` it likes and
 * publish arbitrary content to an unrelated page. */
async function canPublishPath(
  context: Parameters<DryRouteHandler>[0],
  access: AccessInfo,
  allTypes: ContentTypeDefinition[],
  pathname: string,
): Promise<boolean> {
  const { pagesRegistry } = getContentAdapters(context);
  const resources = await pagesRegistry.listResourcesByPath(pathname);
  if (resources.length === 0) return false;
  return resources.every((resource) => {
    const type = allTypes.find((t) => t.name === resource);
    return !!type && access.can(type.id, type.kind === "singleton" ? "setting" : "view");
  });
}

/** Gate for the parts of this segment that stay code-edit-permission-only
 * even under the new per-resource model: the full site-wide manifest
 * (`handleList`) and reading back an arbitrary path's built HTML (`?path=`)
 * both span every page regardless of which resource it depends on, so
 * there's no single resource to check `canPublishPath` against - unlike
 * `byResource`/publish, which are naturally scoped to specific resources/a
 * specific already-built page. */
async function requireCodePermission(context: Parameters<DryRouteHandler>[0]): Promise<Response | null> {
  const resolved = await resolvePublishAccess(context);
  if (!resolved.ok) return resolved.response;
  return resolved.hasCodePermission ? null : forbiddenResponse();
}

interface PagesBuildRequestBody {
  pathname: string;
  /** The route-entry SOURCE file this build compiled from (`PageTarget.
   * entryPath` - `page-build.ts`), e.g. `"pages/blog/page.tsx"`. Distinct
   * from `pathname` (the public URL) - only ever used to clear
   * `ai-page-source-flags.ts`'s red dot for this file below, never
   * persisted to `PagesRegistryAdapter`. */
  entryPath: string;
  /** Every page-source file that contributed to this output. Older clients
   * may omit it; `entryPath` remains the compatibility fallback. */
  sourcePaths?: string[];
  html: string;
  /** mục 7 - `page.js`/`layout.js`/every transitively-imported component,
   * already compiled to real ESM client-side (`page-build.ts`'s
   * `compileEsmAsset`) - this endpoint only writes bytes, same "server
   * không SSR/compile gì cả" contract the HTML write already has. */
  jsAssets: { jsPath: string; source: string }[];
  /** Caller-minted per-build id (e.g. `crypto.randomUUID()`) - see
   * `built-pages-storage.ts`'s `immutableKeyFor` doc comment for why this
   * isn't derived server-side. */
  buildId: string;
  deps: PageDependency[];
  inSitemap: boolean;
  /** `page-build.ts`'s `computeSourceHash` for this exact build - optional
   * at the wire level (unlike `PublishOptions.sourceHash`, required at the
   * TS level) so any not-yet-updated caller mid-rolling-deploy degrades
   * gracefully instead of a hard-rejected publish. */
  sourceHash?: string | null;
}

function isValidBody(value: unknown): value is PagesBuildRequestBody {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  return (
    typeof body.pathname === "string" &&
    body.pathname.startsWith("/") &&
    typeof body.entryPath === "string" &&
    body.entryPath.length > 0 &&
    (body.sourcePaths === undefined ||
      (Array.isArray(body.sourcePaths) && body.sourcePaths.every((path) => typeof path === "string" && path.length > 0))) &&
    typeof body.html === "string" &&
    (body.jsAssets === undefined || Array.isArray(body.jsAssets)) &&
    typeof body.buildId === "string" &&
    body.buildId.length > 0 &&
    Array.isArray(body.deps) &&
    typeof body.inSitemap === "boolean" &&
    (body.sourceHash === undefined || body.sourceHash === null || typeof body.sourceHash === "string")
  );
}

/** One page's worth of the write side - shared by the single-page and batch
 * POST bodies below, so a "build all" run and a one-off "Build" click do
 * exactly the same work per page, just a different number of times per HTTP
 * request. */
async function publishOne(context: Parameters<DryRouteHandler>[0], raw: PagesBuildRequestBody): Promise<PageRecord> {
  const now = Date.now();
  const { liveKey } = await writeBuiltPage(context, raw.pathname, raw.buildId, raw.html);
  for (const asset of raw.jsAssets ?? []) {
    await writeBuiltAsset(context, asset.jsPath, asset.source);
  }

  const record: PageRecord = {
    path: raw.pathname,
    objectKey: liveKey,
    buildId: raw.buildId,
    builtAt: now,
    inSitemap: raw.inSitemap,
    sourceHash: raw.sourceHash ?? null,
  };
  const { pagesRegistry } = getContentAdapters(context);
  await pagesRegistry.recordBuild(record, raw.deps);
  // Best-effort, never fatal to a publish that already succeeded - same
  // "log and move on" contract `content-types.ts`'s `regenerateTypesCache`
  // uses for its own post-write side effect.
  try {
    for (const sourcePath of new Set(raw.sourcePaths ?? [raw.entryPath])) {
      await clearAiPageSourceWrite(sourcePath, context.env);
    }
  } catch (error) {
    console.error("[drycms] failed to clear the ai-page-source-flags entry after a build:", error);
  }
  return record;
}

/** `{ pages: [...] }` - "Build all"'s batch shape (`plans/app-r2.md` mục 11's
 * "Batch PUT lên storage, đừng 500 request rời rạc"): several pages'
 * `publishOne` writes in ONE HTTP round trip instead of one POST per page -
 * a site with a few hundred pages (e.g. after editing a shared root
 * `layout.tsx`, which forces rebuilding everything - staleness tracking
 * doesn't catch a CODE change, only a content one) would otherwise mean a
 * few hundred sequential requests. Sequential internally (not
 * `Promise.all`) - `writeBuiltPage`/`recordBuild` share one local-SQLite
 * handle under `kind: "local"`, and concurrent writers there would just
 * serialize anyway; this keeps behavior identical across engines and keeps
 * one page's failure from racing another's partial write. */
function isValidBatchBody(value: unknown): value is { pages: unknown[] } {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  return Array.isArray(body.pages) && body.pages.length > 0;
}

export const POST: DryRouteHandler = async (context) => {
  try {
    const resolved = await resolvePublishAccess(context);
    if (!resolved.ok) return resolved.response;
    const { access, allTypes, hasCodePermission } = resolved;
    async function authorized(pathname: string): Promise<boolean> {
      return hasCodePermission || (await canPublishPath(context, access, allTypes, pathname));
    }

    const raw: unknown = await context.request.json();
    if (isValidBatchBody(raw)) {
      const records: PageRecord[] = [];
      const errors: { pathname: string; message: string }[] = [];
      for (const entry of raw.pages) {
        if (!isValidBody(entry)) {
          errors.push({ pathname: typeof (entry as { pathname?: unknown })?.pathname === "string" ? (entry as { pathname: string }).pathname : "?", message: "Invalid page entry." });
          continue;
        }
        if (!(await authorized(entry.pathname))) {
          errors.push({ pathname: entry.pathname, message: "You don't have permission to publish this page." });
          continue;
        }
        try {
          records.push(await publishOne(context, entry));
        } catch (error) {
          errors.push({ pathname: entry.pathname, message: error instanceof Error ? error.message : "Publish failed." });
        }
      }
      return jsonResponse({ records, errors }, errors.length > 0 && records.length === 0 ? 500 : 200);
    }
    if (!isValidBody(raw)) return errorResponse(new Error("Invalid pages-build request body."));
    if (!(await authorized(raw.pathname))) return forbiddenResponse();
    const record = await publishOne(context, raw);
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
  const denied = await requireCodePermission(context);
  if (denied) return denied;
  const { pagesRegistry } = getContentAdapters(context);
  const [pages, stale] = await Promise.all([pagesRegistry.listAllPages(), pagesRegistry.listStalePaths()]);
  const staleByPath = new Map(stale.map((s) => [s.path, s.resource]));
  return jsonResponse({
    pages: pages.map((page) => ({ ...page, staleResource: staleByPath.get(page.path) ?? null })),
  });
}

/** `?byResource=a,b` - "what needs rebuilding now that these content types
 * changed" (mục 5's `_page_deps`, `PagesRegistryAdapter.listPathsByResource`).
 * The VEI overlay's `saveAll()` is the caller (`overlay.ts`'s
 * `rebuildAffectedPages` - mục 12's "Sau saveAll() thì chạy build cho trang
 * hiện tại + trang phụ thuộc"): it only knows which content TYPES it just
 * saved, not which pages read them, and has no business querying `_page_deps`
 * directly from the public bundle - this is the one HTTP hop that lets it
 * ask. Comma-joined rather than repeated `?byResource=` params - pathnames
 * and content-type names can't contain a comma, so splitting is unambiguous. */
async function handleByResource(context: Parameters<DryRouteHandler>[0], raw: string): Promise<Response> {
  const resolved = await resolvePublishAccess(context);
  if (!resolved.ok) return resolved.response;
  const { access, allTypes, hasCodePermission } = resolved;
  const requested = [...new Set(raw.split(",").map((r) => r.trim()).filter(Boolean))];
  // Same "silently drop what the caller can't see" treatment as a POST
  // publish being denied for one page in a batch - the caller (an
  // authenticated user acting on content they just successfully saved)
  // gets back whatever it's entitled to instead of a hard 403 for the whole
  // request, which would otherwise abort a mixed-permission save's rebuild
  // for even the resources it DOES have rights to.
  const resources = hasCodePermission
    ? requested
    : requested.filter((resource) => {
        const type = allTypes.find((t) => t.name === resource);
        return !!type && access.can(type.id, type.kind === "singleton" ? "setting" : "view");
      });
  const { pagesRegistry } = getContentAdapters(context);
  const paths = new Set<string>();
  for (const resource of resources) {
    for (const p of await pagesRegistry.listPathsByResource(resource)) paths.add(p);
  }
  return jsonResponse({ paths: [...paths] });
}

/** `?path=` - reads back what's currently live for a path without going
 * through the (still dark) public serve path (QA/admin tooling). No
 * `?path=` at all - the list above, for the admin "Build" page. Query
 * param, not `readSlug`'s rest-segment convention - this route has no
 * natural "file tree" shape to hang a path off of. */
export const GET: DryRouteHandler = async (context) => {
  try {
    const byResource = context.url.searchParams.get("byResource");
    if (byResource) return await handleByResource(context, byResource);
    const pathname = context.url.searchParams.get("path");
    if (!pathname) return await handleList(context);
    if (!pathname.startsWith("/")) {
      return errorResponse(new Error('"path" must start with "/".'));
    }
    const denied = await requireCodePermission(context);
    if (denied) return denied;
    const html = await readBuiltPage(context, pathname);
    if (html === null) return jsonResponse({ error: "not_found", message: `No built page at "${pathname}".` }, 404);
    return new Response(html, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
  } catch (error) {
    return errorResponse(error);
  }
};

export const DELETE: DryRouteHandler = async (context) => {
  try {
    const denied = await requireCodePermission(context);
    if (denied) return denied;
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
