/**
 * Discovers `src/apps/pages/**` and builds a route tree - see
 * `plans/app-router.md`'s "Vị trí code mới". `buildRouteTree` is pure (no
 * fs, no Vite dependency) so `match.ts`'s tests can feed it a fake module
 * map instead of real files, matching `codegen.ts`'s "pure, easy to test"
 * precedent. `discoverRoutes` is the real entry point, backed by Vite's
 * `import.meta.glob` (the same discovery mechanism `RichtextComponents.tsx`/
 * `virtual-fs-files.ts` already use for a different `src/**` glob).
 */

import { PAGES_ROOT } from "./source-roots.js";

export interface RouteModule {
  default: (props: never) => unknown;
}

export type ModuleLoader = () => Promise<RouteModule>;

export interface RouteTreeNode {
  /** Keyed by the raw folder segment name ("blog", "[slug]", "[...path]"). */
  children: Map<string, RouteTreeNode>;
  page?: ModuleLoader;
  layout?: ModuleLoader;
}

/**
 * `notFound`/`serverError` are the pages-root `404.tsx`/`500.tsx` fallback
 * templates (`page-handler.ts`'s doc comment) - kept separate from `root`'s
 * own segment tree since they're rendered as a FALLBACK for a path that
 * didn't match anything (or whose render threw), never reached by
 * `match.ts`'s normal segment-by-segment walk.
 */
export interface RouteTree {
  root: RouteTreeNode;
  notFound?: ModuleLoader;
  serverError?: ModuleLoader;
}

function createNode(): RouteTreeNode {
  return { children: new Map() };
}

/**
 * `modules` is shaped exactly like `import.meta.glob(...)`'s return value:
 * `{ "<rootPrefix>/blog/[slug]/page.tsx": () => import(...), ... }`. Any key
 * not starting with `rootPrefix` is ignored. A key resolving (after stripping
 * `rootPrefix`) to exactly `404.tsx`/`500.tsx` at the pages ROOT (no
 * directory segments) is pulled out as `notFound`/`serverError` instead of
 * being inserted into the segment tree; everything else must end in
 * `page.tsx`/`layout.tsx` or is ignored.
 */
export function buildRouteTree(
  modules: Record<string, ModuleLoader>,
  rootPrefix: string,
): RouteTree {
  const root = createNode();
  let notFound: ModuleLoader | undefined;
  let serverError: ModuleLoader | undefined;

  for (const [path, loader] of Object.entries(modules)) {
    if (!path.startsWith(rootPrefix)) continue;
    const rest = path.slice(rootPrefix.length).replace(/^\/+/, "");
    const parts = rest.split("/");
    const fileName = parts.pop();

    if (parts.length === 0 && fileName === "404.tsx") {
      notFound = loader;
      continue;
    }
    if (parts.length === 0 && fileName === "500.tsx") {
      serverError = loader;
      continue;
    }
    if (fileName !== "page.tsx" && fileName !== "layout.tsx") continue;

    let node = root;
    for (const segment of parts) {
      if (!segment) continue;
      let child = node.children.get(segment);
      if (!child) {
        child = createNode();
        node.children.set(segment, child);
      }
      node = child;
    }
    if (fileName === "page.tsx") node.page = loader;
    else node.layout = loader;
  }
  return { root, notFound, serverError };
}

/** Every STATIC (no `[slug]`/`[...path]` segment anywhere in its path)
 * `page.tsx`'s route, for `sitemap.ts` - a dynamic segment can't be
 * enumerated from the tree alone (it needs a real DB row, see `sitemap.ts`'s
 * own collection-entry loop), so this only ever walks the static branches.
 * Depth-first, order not meaningful to callers. Includes `"/"` when the root
 * node itself has a `page` loader. */
export function staticPagePaths(tree: RouteTree): string[] {
  const paths: string[] = [];
  function walk(node: RouteTreeNode, segments: string[]): void {
    if (node.page) paths.push(segments.length === 0 ? "/" : `/${segments.join("/")}`);
    for (const [segment, child] of node.children) {
      if (segment.startsWith("[")) continue;
      walk(child, [...segments, segment]);
    }
  }
  walk(tree.root, []);
  return paths;
}

const PAGES_ROOT_PREFIX = "/src/apps/pages";

/** Dev-only alternative to the compile-time Vite glob below - lets
 * `discoverRoutes()` build its tree from `pagesSourceStorage` (`.dry/
 * pages-source` under `kind: "local"`) instead of `src/apps/pages`, real
 * files read/compiled live through Vite's OWN dev pipeline
 * (`vite.ssrLoadModule`, not `import.meta.glob`'s build-time-known file
 * set). Only `scripts/dev-server.mjs` constructs one (it's the only place
 * holding a real Vite dev server instance) and only `page-handler.ts` passes
 * it through, gated on `isDev` - `entry-node.ts`/`entry-worker.ts` never
 * pass one, so production's route discovery is completely unaffected. */
export interface DevPagesSource {
  /** Every `.tsx`/`.ts` path under the storage root, root-relative and
   * INCLUDING the source root folder (`"pages/page.tsx"`,
   * `"pages/blogs/[slug]/page.tsx"`, `"component/Card.tsx"` -
   * `source-roots.ts`) - same shape `listAll()`'s `StorageStatEntry.path`
   * already returns. Only the `pages` root becomes routes; the rest are
   * files a page imports, never a route of their own. */
  listPaths(): Promise<string[]>;
  loadModule(relPath: string): Promise<RouteModule>;
  /** The SAME module's URL as the BROWSER can `import()` it - dev's client
   * hydration (`hydrate-client.ts`) can't call `discoverRoutes()` itself the
   * way it does for the prod glob branch (a `.dry/pages-source` file isn't
   * part of that glob's known file set), so `page-handler.ts` embeds this
   * URL, per matched entry/layout, into the response instead - see
   * `devSourcePathOf` below. */
  browserUrlFor(relPath: string): string;
}

/** Reads back the root-relative path a `discoverRoutes(devSource)` loader
 * was tagged with (see below) - `undefined` for a loader from the OTHER
 * branch (the real Vite glob never tags anything), which is how
 * `page-handler.ts` tells whether it's safe to build a dev hydrate
 * manifest for the current request. */
export function devSourcePathOf(loader: ModuleLoader): string | undefined {
  return (loader as ModuleLoader & { devSourcePath?: string }).devSourcePath;
}

/** Real discovery entry point. Given a `devSource`, builds the tree from
 * ITS file list/loaders instead of the glob below - `buildRouteTree` itself
 * doesn't care which one fed it, same `RouteTree` shape either way. Lazy in
 * the glob branch (`import.meta.glob` without `eager`), so a route's module
 * only loads when a matching request actually renders it, not on every
 * dev-server/build startup; the `devSource` branch is lazy for the same
 * reason (`loadModule` is only called when `match.ts` actually resolves to
 * that path). Two separate globs (Vite's `import.meta.glob` needs a literal
 * string, not a runtime-built pattern) merged into one modules map before
 * `buildRouteTree` sorts them out. */
export async function discoverRoutes(devSource?: DevPagesSource): Promise<RouteTree> {
  if (devSource) {
    const paths = await devSource.listPaths();
    const modules: Record<string, ModuleLoader> = {};
    for (const path of paths) {
      // Only the `pages` source root holds routes (`source-roots.ts`) - a
      // `component/page.tsx` is just a component that happens to be named
      // that, never the `/component` route.
      if (!path.startsWith(`${PAGES_ROOT}/`)) continue;
      if (!/(^|\/)(page|layout|404|500)\.tsx$/.test(path)) continue;
      const loader: ModuleLoader & { devSourcePath?: string } = () => devSource.loadModule(path);
      loader.devSourcePath = path;
      modules[path] = loader;
    }
    return buildRouteTree(modules, PAGES_ROOT);
  }
  const pageModules = import.meta.glob<RouteModule>(
    "/src/apps/pages/**/{page,layout}.tsx",
  );
  const fallbackModules = import.meta.glob<RouteModule>(
    "/src/apps/pages/{404,500}.tsx",
  );
  return buildRouteTree({ ...pageModules, ...fallbackModules }, PAGES_ROOT_PREFIX);
}
