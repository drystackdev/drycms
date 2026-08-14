import { buildRouteTree, staticPagePaths, type ModuleLoader, type RouteTree, type RouteTreeNode } from "./route-tree.js";
import { matchRoute } from "./match.js";
import { PAGES_ROOT } from "./source-roots.js";

/**
 * `plans/app-r2.md` mục 1 - builds a route tree from the runtime
 * `pagesSourceStorage` manifest. Used by the browser build pipeline
 * (`page-build.ts`) and by `sitemap.ts`, both of which need a tree
 * whose matched nodes read back as SOURCE PATHS rather than loaders.
 *
 * Reuses `buildRouteTree`/`matchRoute`/`staticPagePaths` UNCHANGED (zero
 * risk of behavioral drift from the tested dev-mode matcher) rather than
 * re-deriving the static/dynamic/catch-all segment-priority logic - the
 * loaders it builds are never actually CALLED (nothing here renders
 * anything), only used as opaque map keys so a matched node's ORIGINAL
 * relative source path can be recovered afterward.
 */

/** One DISTINCT loader instance per path (never a shared/reused function -
 * `buildRouteTree`/`matchRoute` key and return these by reference, so 2
 * paths sharing one function object would collapse to whichever
 * `sourcePath` was tagged last), tagged with the path it stands for so it
 * can be recovered afterward without a parallel lookup table. Never
 * actually called - a build never renders through a manifest match, it
 * only reads `sourcePath` back off it (`sourcePathOf`). */
function pathTaggedLoader(path: string): ModuleLoader {
  const loader = (() => {
    throw new Error(`[drycms] route-manifest loaders are markers only ("${path}") - they carry a source path, they don't load anything.`);
  }) as unknown as ModuleLoader & { sourcePath: string };
  loader.sourcePath = path;
  return loader;
}

function sourcePathOf(loader: ModuleLoader): string {
  return (loader as ModuleLoader & { sourcePath: string }).sourcePath;
}

/** `paths` - every file under the pages source root, e.g. from
 * `pagesSourceStorage`'s `listAll()`/`?tree`: `["pages/page.tsx",
 * "pages/layout.tsx", "pages/blogs/[slug]/page.tsx", "pages/404.tsx",
 * "component/Card.tsx"]` - storage-root-relative, so INCLUDING the source
 * root folder (`source-roots.ts`) but with no leading slash, unlike
 * the live-source provider's module keys. Only the `pages` root produces
 * routes; the tagged loader keeps the FULL path (`pages/page.tsx`) so
 * `sourcePathOf` still hands `buildPage` a key its `sourceByPath` actually
 * has. */
export function buildManifestRouteTree(paths: string[]): RouteTree {
  const modules: Record<string, ModuleLoader> = {};
  for (const path of paths) {
    if (!path.startsWith(`${PAGES_ROOT}/`)) continue;
    if (!/(^|\/)(page|layout|404|500)\.tsx$/.test(path)) continue;
    modules[path] = pathTaggedLoader(path);
  }
  return buildRouteTree(modules, PAGES_ROOT);
}

export interface SourceRouteMatch {
  entryPath: string;
  /** Root-to-leaf - the same convention `page-build.ts`'s `PageBuildInput.
   * layoutPaths` expects directly, no reordering needed by the caller. */
  layoutPaths: string[];
  params: Record<string, string | string[]>;
}

/** Resolves `pathname` against a manifest-built tree straight to the
 * relative SOURCE PATHS `page-build.ts`'s `buildPage` needs
 * (`entryPath`/`layoutPaths`), instead of `match.ts`'s `RouteMatch` (whose
 * `page`/`layouts` are loaders meant to be awaited, not read for their
 * path). */
export function matchSourceRoute(tree: RouteTree, pathname: string): SourceRouteMatch | null {
  const match = matchRoute(tree.root, pathname);
  if (!match) return null;
  return {
    entryPath: sourcePathOf(match.page),
    layoutPaths: match.layouts.map(sourcePathOf),
    params: match.params,
  };
}

export interface NotFoundRoute {
  entryPath: string;
  /** Root-to-leaf, same convention `SourceRouteMatch.layoutPaths` uses -
   * just the root layout (if any), since a route miss is wrapped by the
   * root layout only. */
  layoutPaths: string[];
}

/** The manifest-tree counterpart to `page-handler.ts`'s own
 * `routeTree.notFound`/`routeTree.root.layout` miss-fallback shape - lets a
 * caller that only has SOURCE PATHS (e.g. a browser resolving routes
 * client-side, `vei-live-refresh.ts`) render the pages-root `404.tsx` the
 * same way. `undefined` when the tree has no `404.tsx` at all. */
export function notFoundRoute(tree: RouteTree): NotFoundRoute | undefined {
  if (!tree.notFound) return undefined;
  return {
    entryPath: sourcePathOf(tree.notFound),
    layoutPaths: tree.root.layout ? [sourcePathOf(tree.root.layout)] : [],
  };
}

/** The `500.tsx` counterpart to `notFoundRoute`: error pages live at the
 * pages root and are wrapped by that root's layout, just like `404.tsx`. */
export function serverErrorRoute(tree: RouteTree): NotFoundRoute | undefined {
  if (!tree.serverError) return undefined;
  return {
    entryPath: sourcePathOf(tree.serverError),
    layoutPaths: tree.root.layout ? [sourcePathOf(tree.root.layout)] : [],
  };
}

/** Every static page's PATHNAME to build - thin re-export of
 * `route-tree.ts`'s `staticPagePaths` (already pure, works on ANY
 * `RouteTree` regardless of what its loaders do) so callers of this module
 * don't also need to import from `route-tree.ts` directly. */
export { staticPagePaths };

const DYNAMIC_SEGMENT = /^\[([^.[\]]+)\]$/;

export interface DynamicPageTemplate {
  /** e.g. `"/blogs/[slug]"` - the route's own pathname, bracket segment
   * literal (not yet resolved to a real value). */
  pathnameTemplate: string;
  paramName: string;
  entryPath: string;
  /** Root-to-leaf, INCLUDING the dynamic segment's own layout if it has
   * one - same convention `SourceRouteMatch.layoutPaths` uses. */
  layoutPaths: string[];
}

/**
 * Every single-level `[param]` page template in the tree (mục 4) - the
 * dynamic-route counterpart to `staticPagePaths`. Catch-all (`[...rest]`)
 * segments are silently skipped, same "khai báo tay hoặc chấp nhận không
 * build" decision `plans/app-r2.md` mục 4 already made - `DYNAMIC_SEGMENT`
 * (copied from `match.ts`'s own regex) simply never matches one, so there's
 * nothing further to special-case here.
 *
 * Does NOT recurse past a matched `[param]` node into ITS children - v1
 * scope is one dynamic segment per branch. A real site nesting a second
 * dynamic segment under the first (`/blogs/[slug]/comments/[id]`) isn't
 * enumerable this way without already knowing the parent's concrete value,
 * which is exactly what `dynamic-routes.ts`'s caller resolves ONE level at
 * a time - deeper nesting is a real, currently-unhandled limitation, not
 * silently wrong.
 */
export function listDynamicPageTemplates(tree: RouteTree): DynamicPageTemplate[] {
  const templates: DynamicPageTemplate[] = [];
  function walk(node: RouteTreeNode, segments: string[], layoutPaths: string[]): void {
    for (const [segment, child] of node.children) {
      const childLayoutPaths = child.layout ? [...layoutPaths, sourcePathOf(child.layout)] : layoutPaths;
      const match = DYNAMIC_SEGMENT.exec(segment);
      if (match) {
        if (child.page) {
          templates.push({
            pathnameTemplate: `/${[...segments, segment].join("/")}`,
            paramName: match[1]!,
            entryPath: sourcePathOf(child.page),
            layoutPaths: childLayoutPaths,
          });
        }
        continue;
      }
      walk(child, [...segments, segment], childLayoutPaths);
    }
  }
  walk(tree.root, [], tree.root.layout ? [sourcePathOf(tree.root.layout)] : []);
  return templates;
}
