/**
 * Discovers `src/apps/pages/**` and builds a route tree - see
 * `plans/app-router.md`'s "Vị trí code mới". `buildRouteTree` is pure (no
 * fs, no Vite dependency) so `match.ts`'s tests can feed it a fake module
 * map instead of real files, matching `codegen.ts`'s "pure, easy to test"
 * precedent. `discoverRoutes` is the real entry point, backed by Vite's
 * `import.meta.glob` (the same discovery mechanism `RichtextComponents.tsx`/
 * `virtual-fs-files.ts` already use for a different `src/**` glob).
 */

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

/** Real discovery entry point - lazy (`import.meta.glob` without `eager`),
 * so a route's module only loads when a matching request actually renders
 * it, not on every dev-server/build startup. Two separate globs (Vite's
 * `import.meta.glob` needs a literal string, not a runtime-built pattern)
 * merged into one modules map before `buildRouteTree` sorts them out. */
export function discoverRoutes(): RouteTree {
  const pageModules = import.meta.glob<RouteModule>(
    "/src/apps/pages/**/{page,layout}.tsx",
  );
  const fallbackModules = import.meta.glob<RouteModule>(
    "/src/apps/pages/{404,500}.tsx",
  );
  return buildRouteTree({ ...pageModules, ...fallbackModules }, PAGES_ROOT_PREFIX);
}
