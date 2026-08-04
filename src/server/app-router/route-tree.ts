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

function createNode(): RouteTreeNode {
  return { children: new Map() };
}

/**
 * `modules` is shaped exactly like `import.meta.glob(...)`'s return value:
 * `{ "<rootPrefix>/blog/[slug]/page.tsx": () => import(...), ... }`. Any
 * key not starting with `rootPrefix`, or not ending in `page.tsx`/
 * `layout.tsx`, is ignored.
 */
export function buildRouteTree(
  modules: Record<string, ModuleLoader>,
  rootPrefix: string,
): RouteTreeNode {
  const root = createNode();
  for (const [path, loader] of Object.entries(modules)) {
    if (!path.startsWith(rootPrefix)) continue;
    const rest = path.slice(rootPrefix.length).replace(/^\/+/, "");
    const parts = rest.split("/");
    const fileName = parts.pop();
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
  return root;
}

const PAGES_ROOT_PREFIX = "/src/apps/pages";

/** Real discovery entry point - lazy (`import.meta.glob` without `eager`),
 * so a route's module only loads when a matching request actually renders
 * it, not on every dev-server/build startup. */
export function discoverRoutes(): RouteTreeNode {
  const modules = import.meta.glob<RouteModule>(
    "/src/apps/pages/**/{page,layout}.tsx",
  );
  return buildRouteTree(modules, PAGES_ROOT_PREFIX);
}
