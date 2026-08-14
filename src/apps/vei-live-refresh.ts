import hydrate from "preact-iso/hydrate";
import { configureHttpDryReader } from "../content-types/dry-reader-http.js";
import { setCurrentParams } from "../content-types/params-reader-client.js";
import { resolveMatchToVNode } from "../server/app-router/resolve-match.js";
import type { RouteMatch } from "../server/app-router/match.js";
import { candidatePathsFor, IMPORT_FROM_RE, moduleDefault } from "../page-components/page-build.js";
import { toUrlPath } from "../page-components/pages-source-http.js";
import { adminPath } from "../storage/admin-path.js";
import type { ContentTypeDefinition } from "../content-types/types.js";
import { HYDRATED_EVENT } from "./hydrated-event.js";

/**
 * The client half of the VEI-in-production fix (`status/vei-live-refresh.md`
 * if one exists, or see `page-handler.ts`'s `veiLiveManifest` doc comment).
 *
 * Outside `bun run dev`, `discoverRoutes()` always resolves a route to the
 * DEPLOYED `src/apps/pages` snapshot (`route-tree.ts`) - a Cloudflare Worker
 * has no way to dynamically compile+run newly saved `page.tsx` source at
 * request time (`new Function` throws "Code generation from strings
 * disallowed for this context" there, confirmed live - a hard platform
 * restriction, not a config gap). A VEI session still gets a fresh per-
 * request SSR render (`page-handler.ts`'s mục-12 carve-out), just of that
 * same stale snapshot.
 *
 * This script runs the same sucrase-eval pipeline the Page Editor's own
 * preview already uses (`page-build.ts`'s `evalModule`/`moduleDefault`, real
 * browser `new Function` - never restricted, unlike the Worker) against the
 * CURRENT saved source, fetched live over `GET /api/pages-source/<path>`
 * (single-file reads only - no directory listing, since `StorageAdapter.
 * listAll()` is deliberately unavailable for R2 - `pages-source-http.ts`'s
 * own doc comment), then re-renders over the just-hydrated stale DOM. Net
 * effect: a VEI page view flashes the deployed content for a moment, then
 * updates to the truly-live one - no rebuild, no redeploy.
 *
 * Route STRUCTURE stays whatever the deployed snapshot says (a brand-new
 * page still needs a real deploy to become reachable) - only the CONTENT of
 * an already-routable page/layout/component becomes live, since this script
 * only ever fetches paths it already knows about: the matched page/layout
 * (from the manifest below) and whatever THEIR OWN `import` statements name.
 */

interface VeiLiveManifest {
  entryPath: string;
  layoutPaths: string[];
  params: Record<string, string | string[]>;
  allTypes: ContentTypeDefinition[];
}

function readManifest(): VeiLiveManifest | null {
  const element = document.getElementById("dry-vei-live-manifest");
  if (!element?.textContent) return null;
  try {
    return JSON.parse(element.textContent) as VeiLiveManifest;
  } catch {
    return null;
  }
}

/**
 * NOT `pages-source-http.ts`'s shared `fetchText` - that one issues a plain
 * `fetch()` with no cache override, fine for its other callers (the Page
 * Editor tree, which has its own version/staleness handling) but wrong here:
 * the entire point of this module is "never show anything but the CURRENT
 * saved source", so a browser HTTP-cache hit serving yesterday's response
 * would silently defeat it. `toUrlPath` (URL-encoding only, no fetch) is
 * still shared - no reason to duplicate that part.
 */
async function fetchSource(path: string): Promise<string | null> {
  const response = await fetch(`${adminPath()}/api/pages-source/${toUrlPath(path)}`, {
    credentials: "same-origin",
    cache: "no-store",
  });
  return response.ok ? response.text() : null;
}

/**
 * Async counterpart to `page-build.ts`'s `transitiveDependencies` - that one
 * walks a pre-loaded `sourceByPath` map (the browser build already has the
 * whole tree in hand); this fetches each file lazily, resolving each import
 * specifier's CANDIDATES (`candidatePathsFor`) by actually trying each one
 * over the network in order and keeping the first that exists - same
 * first-match-wins precedence `resolveModulePath`'s map-membership check
 * already enforces for the pre-loaded-tree case, just decided by a real
 * fetch instead of a map lookup. Only ever reaches what `roots` (and
 * whatever they transitively import) actually name - no directory listing.
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

/**
 * `hydrate-client.ts`'s own `main()` re-renders this SAME document against
 * the (stale) SSR vnode tree - if it finishes AFTER this script's own
 * `hydrate()` call below, it silently stomps the fresh content straight back
 * to the stale one (a mismatched text node is exactly what hydration
 * "fixes"). Both scripts are independently async, so document order alone
 * doesn't guarantee who finishes last - `apps/vei/overlay.ts`'s own
 * `whenHydrated` has the identical race for the identical reason; this
 * mirrors it rather than reimplementing it differently.
 */
function whenHydrated(): Promise<void> {
  if ((window as { dryHydrated?: boolean }).dryHydrated) return Promise.resolve();
  return new Promise((resolve) => {
    window.addEventListener(HYDRATED_EVENT, () => resolve(), { once: true });
  });
}

async function main(): Promise<void> {
  const manifest = readManifest();
  if (!manifest) return;

  try {
    const sourceByPath = await collectClosure([manifest.entryPath, ...manifest.layoutPaths]);
    await whenHydrated();

    configureHttpDryReader({
      endpoint: `${adminPath()}/api/dry-http`,
      callLog: [],
      deps: [],
      allTypes: manifest.allTypes,
      seo: {},
    });
    setCurrentParams(manifest.params);

    const cache = new Map<string, { exports: any }>();
    const match: RouteMatch = {
      page: async () => ({ default: moduleDefault(manifest.entryPath, sourceByPath, cache) }),
      layouts: manifest.layoutPaths.map((path) => async () => ({ default: moduleDefault(path, sourceByPath, cache) })),
      params: manifest.params,
    };

    const vnode = await resolveMatchToVNode(match);
    hydrate(vnode as never);
  } catch (error) {
    // Stale beats broken (`page-handler.ts`'s mục-12 precedent for
    // `built/live/*`) - leave the already-hydrated stale DOM exactly as it
    // is rather than blanking the page over a mid-edit syntax error or a
    // transient fetch failure.
    console.error("[drycms] VEI live refresh failed - showing the last-deployed content instead:", error);
  }
}

void main();
