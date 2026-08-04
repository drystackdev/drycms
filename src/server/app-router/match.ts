import type { ModuleLoader, RouteTreeNode } from "./route-tree.js";

export interface RouteMatch {
  page: ModuleLoader;
  /** Root-to-leaf order, only nodes that actually have a `layout.tsx` -
   * matches "layout.tsx: luôn gọi lòng nhau" (always nested) from
   * `plans/app-router.md`. */
  layouts: ModuleLoader[];
  /** `[slug]` segments are `string`; `[...path]` segments are `string[]`
   * (the remaining path, in order) - Next.js's own convention, which
   * `plans/app-router.md` references directly. */
  params: Record<string, string | string[]>;
}

const DYNAMIC_SEGMENT = /^\[([^.[\]]+)\]$/;
const CATCH_ALL_SEGMENT = /^\[\.\.\.([^.[\]]+)\]$/;

/**
 * pathname -> matched page + ordered layout chain + params, or `null` if
 * nothing matches. Priority per segment, Next.js-style: static name >
 * `[dynamic]` > `[...catchAll]`. A folder with only a `layout.tsx` (no
 * `page.tsx`) is not directly visitable - only its children are, exactly
 * like Next.js.
 */
export function matchRoute(root: RouteTreeNode, pathname: string): RouteMatch | null {
  const segments = pathname.split("/").filter(Boolean);
  const layouts: ModuleLoader[] = [];
  const params: Record<string, string | string[]> = {};

  let node = root;
  if (node.layout) layouts.push(node.layout);

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]!;

    const staticChild = node.children.get(segment);
    if (staticChild) {
      node = staticChild;
      if (node.layout) layouts.push(node.layout);
      continue;
    }

    const dynamicMatch = findChildMatching(node, DYNAMIC_SEGMENT);
    if (dynamicMatch) {
      params[dynamicMatch.paramName] = segment;
      node = dynamicMatch.child;
      if (node.layout) layouts.push(node.layout);
      continue;
    }

    const catchAllMatch = findChildMatching(node, CATCH_ALL_SEGMENT);
    if (catchAllMatch) {
      params[catchAllMatch.paramName] = segments.slice(i);
      node = catchAllMatch.child;
      if (node.layout) layouts.push(node.layout);
      i = segments.length; // catch-all consumes every remaining segment
      break;
    }

    return null;
  }

  if (!node.page) return null;
  return { page: node.page, layouts, params };
}

function findChildMatching(
  node: RouteTreeNode,
  pattern: RegExp,
): { paramName: string; child: RouteTreeNode } | null {
  for (const [key, child] of node.children) {
    const match = pattern.exec(key);
    if (match) return { paramName: match[1]!, child };
  }
  return null;
}
