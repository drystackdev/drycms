/** Builds route trees from the live page-source provider used by dev. */

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

/** Dev-only live route discovery - lets
 * `discoverRoutes()` build its tree from `pagesSourceStorage` (`.dry/
 * pages-source` under `kind: "local"`), with real
 * files read/compiled live through Vite's own dev pipeline
 * (`vite.ssrLoadModule`). Only `scripts/dev-server.mjs` constructs one (it's the only place
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
  /** The file's raw text. Only ever called for a `[param]` page's own
   * `page.tsx` (`sitemap.ts`), to read which collection that page renders
   * off its `dry().collection(...).get()` call - see `page-collection.ts`
   * for why that call, and not a config field, is the mapping. */
  readSource(relPath: string): Promise<string>;
  /** The SAME module's URL as the BROWSER can `import()` it - dev's client
   * hydration (`hydrate-client.ts`) receives the already-resolved live module
   * URLs from `page-handler.ts`, which embeds this
   * URL, per matched entry/layout, into the response instead - see
   * `devSourcePathOf` below. */
  browserUrlFor(relPath: string): string;
}

/** Reads back the root-relative path a live-source loader was tagged with. */
export function devSourcePathOf(loader: ModuleLoader): string | undefined {
  return (loader as ModuleLoader & { devSourcePath?: string }).devSourcePath;
}

/** Dev-only route discovery from the live page-source provider. Production
 * serves browser-built artifacts and never imports page-source modules. */
export async function discoverRoutes(devSource: DevPagesSource): Promise<RouteTree> {
  const paths = await devSource.listPaths();
  const modules: Record<string, ModuleLoader> = {};
  for (const path of paths) {
    if (!path.startsWith(`${PAGES_ROOT}/`)) continue;
    if (!/(^|\/)(page|layout|404|500)\.tsx$/.test(path)) continue;
    const loader: ModuleLoader & { devSourcePath?: string } = () => devSource.loadModule(path);
    loader.devSourcePath = path;
    modules[path] = loader;
  }
  return buildRouteTree(modules, PAGES_ROOT);
}
