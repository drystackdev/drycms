import { buildRouteTree, staticPagePaths, type ModuleLoader, type RouteTree, type RouteTreeNode } from "./route-tree.js";
import { matchRoute } from "./match.js";

/**
 * `plans/app-r2.md` mục 1 - the manifest-driven counterpart to
 * `route-tree.ts`'s `discoverRoutes()` (which uses Vite's `import.meta.glob`,
 * compile-time only - a `.tsx` written to `pagesSourceStorage` at RUNTIME by
 * the browser build pipeline would never appear there). NOT wired in as a
 * replacement for `discoverRoutes()` anywhere - `page-handler.ts`/
 * `sitemap.ts` still call that one, unchanged (see `status/app-r2-build.md`
 * for why this stays dark: the browser build orchestrator that would
 * actually call this doesn't have a live trigger yet, and flipping
 * `discoverRoutes()` itself over would 404 the whole site the moment
 * `pagesSourceStorage` is empty, which it is on every existing deployment).
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
 * `pagesSourceStorage`'s `listAll()`/`?tree` (same shape
 * `page-components.ts`'s `handleTree` already returns for a different
 * root): `["page.tsx", "layout.tsx", "blogs/layout.tsx",
 * "blogs/page.tsx", "blogs/[slug]/page.tsx", "404.tsx"]` - NOT prefixed
 * with a leading slash or a root marker, unlike `discoverRoutes()`'s Vite
 * glob keys (`buildRouteTree`'s own `rootPrefix` param exists for that
 * distinction - here it's simply `""`, since the manifest is already
 * root-relative). */
export function buildManifestRouteTree(paths: string[]): RouteTree {
  const modules: Record<string, ModuleLoader> = {};
  for (const path of paths) {
    if (!/(^|\/)(page|layout|404|500)\.tsx$/.test(path)) continue;
    modules[path] = pathTaggedLoader(path);
  }
  return buildRouteTree(modules, "");
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
