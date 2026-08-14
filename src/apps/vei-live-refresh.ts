import hydrate from "preact-iso/hydrate";
import { configureHttpDryReader } from "../content-types/dry-reader-http.js";
import { createContentTypesApi, listCached } from "../content-types/http-api.js";
import { permissionKeyFor } from "../content-types/permissions.js";
import { setCurrentParams } from "../content-types/params-reader-client.js";
import { resolveMatchToVNode } from "../server/app-router/resolve-match.js";
import { buildManifestRouteTree, matchSourceRoute, notFoundRoute } from "../server/app-router/route-manifest.js";
import type { RouteMatch } from "../server/app-router/match.js";
import { candidatePathsFor, IMPORT_FROM_RE, moduleDefault } from "../page-components/page-build.js";
import { listAllFilesRecursive, toUrlPath } from "../page-components/pages-source-http.js";
import { adminPath, setAdminPath } from "../storage/admin-path.js";
import type { ContentTypeDefinition } from "../content-types/types.js";
import type { DryVeiContext } from "../content-types/dry-context.js";
import { HYDRATED_EVENT } from "./hydrated-event.js";

/**
 * The VEI client: since a VEI session no longer takes any server-side route
 * match or SSR (`page-handler.ts`'s own doc comment), THIS script is the
 * whole of VEI's rendering - it resolves the current URL against the LIVE
 * pages source and renders it, every time, whether the server handed it a
 * real cached page to refresh (`spliceVeiScripts`) or a bare shell with
 * nothing in it yet (`buildVeiShellDocument`).
 *
 * Route STRUCTURE used to come from the deployed build's own snapshot
 * (`src/apps/pages`, a compile-time glob) - stale the moment a page was
 * added/edited since the last sync+rebuild+deploy, which could false-404 a
 * page that rendered fine for every ordinary visitor. This script instead
 * fetches the pages-source PATH LIST fresh on every load
 * (`listAllFilesRecursive`, already used by `PageBuild.tsx`/
 * `rebuild-affected-pages.ts` for the same purpose - works against both
 * local storage's bulk `?tree` and R2's recursive per-folder walk fallback)
 * and matches it with `route-manifest.ts`'s pure, portable
 * `buildManifestRouteTree`/`matchSourceRoute` - the exact same route-tree
 * logic `page-handler.ts` used to run server-side, just fed the live list
 * instead of a frozen build-time one. A miss resolves the pages-root
 * `404.tsx` (`notFoundRoute`) the SAME way, so the true-404 case is also
 * live now, not dependent on whatever `404.tsx` happened to be in the last
 * deploy.
 *
 * `evalModule`/`moduleDefault` (`page-build.ts`) + `resolveMatchToVNode` are
 * the same eval-and-render pipeline this script already used for its
 * narrower "refresh this one already-known page" job - proven (via
 * `buildPage()`, `PageEditor.tsx`'s live preview) to do a FRESH render with
 * no prior DOM, not just a hydrate-over-stale-content, which is what the
 * shell case needs.
 *
 * The one thing that needed fixing to make a fresh render actually
 * click-to-editable: `dry-reader-http.ts`'s `dry()` never produced real
 * edit markers before (by design, for the "build a static page" case it
 * originally existed for) - `configureHttpDryReader` below now passes a
 * real `vei` context, resolved from THIS viewer's own permissions
 * (`GET /api/auth/session`), so `dry-reader-http.ts`'s `markOrInert` boxes
 * values for real instead of falling back to an inert `$`. Mirrors
 * `page-handler.ts`'s old (now-removed) `resolveVeiContext` logic exactly,
 * just resolved client-side.
 */

interface AuthSessionUser {
  isSuperAdmin: boolean;
  permissions: string[];
}

/** `veiConfigScript`'s own element (`render.ts`) - every App Router page
 * carries it, cached/anonymous ones included. Reads the SAME 2 fields
 * `hydrate-client.ts`'s own `seedAdminPath` does, for the identical reason
 * (`admin-path.ts`'s `adminPath()` only knows `window.__DRY_CONFIG__`,
 * which the ADMIN app injects, never a public page) - this script must seed
 * it itself since, unlike a normal cached page, the bare VEI shell
 * (`buildVeiShellDocument`) deliberately never loads `hydrate-client.ts` at
 * all. `edit` gates whether this script does anything: `false` on a cached
 * page served to an ordinary visitor who never hit `/vei/enter` this
 * session, `true` on anything `page-handler.ts`'s VEI branch served
 * (spliced or shell). */
function readVeiConfig(): { path: string; edit: boolean } | null {
  const element = document.getElementById("dry-vei-config");
  if (!element?.textContent) return null;
  try {
    return JSON.parse(element.textContent) as { path: string; edit: boolean };
  } catch {
    return null;
  }
}

/** Same fetch discipline `pages-source-http.ts`'s other callers use
 * (`credentials: "same-origin"`) - this script runs on a public page, not
 * inside the admin tab. `cache: "no-store"` on the SOURCE fetch specifically
 * (not the tree/content-types/session ones, which are cheap to let the
 * browser's own HTTP cache handle normally): the whole point of this script
 * is "never show anything but the CURRENTLY saved source." */
async function fetchSource(path: string): Promise<string | null> {
  const response = await fetch(`${adminPath()}/api/pages-source/${toUrlPath(path)}`, {
    credentials: "same-origin",
    cache: "no-store",
  });
  return response.ok ? response.text() : null;
}

/**
 * Async counterpart to `page-build.ts`'s `transitiveDependencies` - that one
 * walks a pre-loaded `sourceByPath` map (the browser BUILD pipeline already
 * has the whole tree in hand); this fetches each file lazily, resolving each
 * import specifier's CANDIDATES (`candidatePathsFor`) by actually trying
 * each one over the network in order and keeping the first that exists -
 * same first-match-wins precedence `resolveModulePath`'s map-membership
 * check already enforces for the pre-loaded-tree case, just decided by a
 * real fetch instead of a map lookup. Deliberately NOT bulk-fetching every
 * file's CONTENT just because `listAllFilesRecursive` already knows every
 * PATH - only ever reaches what `roots` (and whatever they transitively
 * import) actually name.
 */
async function collectClosure(roots: string[]): Promise<Record<string, string>> {
  const sourceByPath: Record<string, string> = {};

  async function scanImports(path: string, text: string): Promise<void> {
    const specifiers = new Set([...text.matchAll(IMPORT_FROM_RE)].map((m) => m[2]!));
    for (const specifier of specifiers) {
      if (specifier === "preact" || specifier === "preact/hooks") continue;
      await resolveSpecifier(path, specifier);
    }
  }

  async function resolveSpecifier(fromPath: string, specifier: string): Promise<void> {
    const resolved = candidatePathsFor(fromPath, specifier);
    if (resolved.kind === "external") return;
    for (const candidate of resolved.paths) {
      if (candidate in sourceByPath) return;
      const text = await fetchSource(candidate);
      if (text !== null) {
        sourceByPath[candidate] = text;
        await scanImports(candidate, text);
        return;
      }
    }
    throw new Error(`[drycms] vei-live-refresh: cannot find "${specifier}" imported from "${fromPath}".`);
  }

  for (const root of roots) {
    if (root in sourceByPath) continue;
    const text = await fetchSource(root);
    if (text === null) throw new Error(`[drycms] vei-live-refresh: "${root}" not found.`);
    sourceByPath[root] = text;
    await scanImports(root, text);
  }
  return sourceByPath;
}

/** This viewer's own edit rights, resolved client-side - mirrors
 * `page-handler.ts`'s old server-side `resolveVeiContext` exactly (a
 * singleton's schema collapses every action into one `setting` grant;
 * `isSuperAdmin` bypasses per-type checks entirely), just sourced from
 * `GET /api/auth/session` instead of a DB-backed `AccessInfo`. `null` when
 * the session cookie turned out invalid/expired by the time this ran (rare -
 * `page-handler.ts` already checked it moments ago - but not impossible),
 * in which case nothing renders as editable this load. */
async function resolveVeiAccess(): Promise<DryVeiContext | null> {
  const response = await fetch(`${adminPath()}/api/auth/session`, { credentials: "same-origin" });
  if (!response.ok) return null;
  const body = (await response.json()) as { user: AuthSessionUser | null };
  if (!body.user) return null;
  const { isSuperAdmin, permissions } = body.user;
  const editable = new Map<string, boolean>();
  return {
    canUpdate(type: ContentTypeDefinition) {
      if (isSuperAdmin) return true;
      const cached = editable.get(type.id);
      if (cached !== undefined) return cached;
      const action = type.kind === "singleton" ? "setting" : "update";
      const allowed = permissions.includes(permissionKeyFor(type.id, action));
      editable.set(type.id, allowed);
      return allowed;
    },
  };
}

/**
 * `hydrate-client.ts`'s (or `hydrate-built.ts`'s, on a spliced cache-hit
 * page) own hydrate pass overwrites any DOM text/attribute that doesn't
 * match its vnode, so this script's own render must not race it - identical
 * problem `apps/vei/overlay.ts`'s own `whenHydrated` already solves, mirrored
 * here rather than reimplemented differently.
 */
function whenHydrated(): Promise<void> {
  if ((window as { dryHydrated?: boolean }).dryHydrated) return Promise.resolve();
  return new Promise((resolve) => {
    window.addEventListener(HYDRATED_EVENT, () => resolve(), { once: true });
  });
}

/** Never leaves the page blank - the shell case has nothing else on screen
 * yet, unlike a cache-hit refresh failure (which just leaves the last-good
 * cached content exactly as it was, same as before). */
function renderInlineFallback(message: string): void {
  document.body.textContent = message;
}

async function main(): Promise<void> {
  const veiConfig = readVeiConfig();
  if (!veiConfig?.edit) return;
  setAdminPath(veiConfig.path);

  // Present ONLY on a real `buildDocument()`/`buildPage()` output
  // (`ISODATA_MARKER`, `build-document.ts`) - i.e. the cache-hit splice
  // case, which already has real prior content and its own hydrate script
  // racing to reconcile it. Absent on the bare shell (`buildVeiShellDocument`
  // deliberately omits it), where there's nothing to race and nothing to
  // wait for.
  const isCacheHit = document.querySelector('script[type="isodata"]') !== null;

  try {
    const typesApi = createContentTypesApi(`${adminPath()}/api/content-types`);
    const [allTypes, vei, fileEntries] = await Promise.all([
      listCached(typesApi),
      resolveVeiAccess(),
      listAllFilesRecursive(adminPath()),
    ]);

    const tree = buildManifestRouteTree(fileEntries.map((e) => e.id));
    const sourceMatch = matchSourceRoute(tree, window.location.pathname);
    const route = sourceMatch ?? notFoundRoute(tree);
    if (!route) {
      // Cache-hit: leave the last-good deployed content exactly as it is -
      // this script found no LIVE route for the URL, but the page it's
      // sitting on top of is real. Shell: nothing to preserve, so show the
      // real "not found" state instead of staying blank - deliberately NOT
      // awaiting `whenHydrated()` here, since nothing else runs on the bare
      // shell to ever fire that event (this function's own `finally` is
      // what eventually does, only once THIS branch returns).
      if (!isCacheHit) renderInlineFallback("Page not found");
      return;
    }
    const params = sourceMatch?.params ?? {};

    const sourceByPath = await collectClosure([route.entryPath, ...route.layoutPaths]);
    if (isCacheHit) await whenHydrated();

    configureHttpDryReader({
      endpoint: `${adminPath()}/api/dry-http`,
      callLog: [],
      deps: [],
      allTypes,
      seo: {},
      vei: vei ?? undefined,
    });
    setCurrentParams(params);

    const cache = new Map<string, { exports: any }>();
    const match: RouteMatch = {
      page: async () => ({ default: moduleDefault(route.entryPath, sourceByPath, cache) }),
      layouts: route.layoutPaths.map((path) => async () => ({ default: moduleDefault(path, sourceByPath, cache) })),
      params,
    };

    const vnode = await resolveMatchToVNode(match);
    hydrate(vnode as never);
  } catch (error) {
    // Stale/blank beats broken - leave a cache-hit's already-hydrated
    // content exactly as it is (a mid-edit syntax error or transient fetch
    // failure shouldn't blank a page that was displaying fine); the shell
    // case has nothing to preserve, so it gets an explicit message instead
    // of staying blank forever.
    console.error("[drycms] VEI live render failed:", error);
    if (!isCacheHit) renderInlineFallback("This page couldn't be loaded.");
  } finally {
    (window as { dryHydrated?: boolean }).dryHydrated = true;
    window.dispatchEvent(new Event(HYDRATED_EVENT));
  }
}

void main();
