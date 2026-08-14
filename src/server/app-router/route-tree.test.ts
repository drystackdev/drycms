import { describe, expect, it } from "vitest";
import { buildRouteTree, staticPagePaths, type ModuleLoader } from "./route-tree.js";

const ROOT = "/pages-source/pages";

function loader(id: string): ModuleLoader {
  return () => Promise.resolve({ default: () => id }) as never;
}

describe("staticPagePaths", () => {
  it("lists every static page, including the root", () => {
    const tree = buildRouteTree(
      {
        [`${ROOT}/page.tsx`]: loader("root"),
        [`${ROOT}/about/page.tsx`]: loader("about"),
        [`${ROOT}/blogs/page.tsx`]: loader("blogs-list"),
      },
      ROOT,
    );
    expect(staticPagePaths(tree).sort()).toEqual(["/", "/about", "/blogs"]);
  });

  it("skips dynamic segments - can't enumerate a [slug]/[...path] route from the tree alone", () => {
    const tree = buildRouteTree(
      {
        [`${ROOT}/blogs/page.tsx`]: loader("blogs-list"),
        [`${ROOT}/blogs/[slug]/page.tsx`]: loader("blog-post"),
        [`${ROOT}/docs/[...path]/page.tsx`]: loader("docs-catchall"),
      },
      ROOT,
    );
    expect(staticPagePaths(tree)).toEqual(["/blogs"]);
  });

  it("excludes a directory with only a layout.tsx (no page.tsx of its own)", () => {
    const tree = buildRouteTree(
      {
        [`${ROOT}/blogs/layout.tsx`]: loader("blogs-layout"),
        [`${ROOT}/blogs/[slug]/page.tsx`]: loader("blog-post"),
      },
      ROOT,
    );
    expect(staticPagePaths(tree)).toEqual([]);
  });

  it("excludes the pages-root 404.tsx/500.tsx fallbacks - never inserted into the tree as nodes", () => {
    const tree = buildRouteTree(
      {
        [`${ROOT}/page.tsx`]: loader("root"),
        [`${ROOT}/404.tsx`]: loader("not-found"),
        [`${ROOT}/500.tsx`]: loader("server-error"),
      },
      ROOT,
    );
    expect(staticPagePaths(tree)).toEqual(["/"]);
  });
});
