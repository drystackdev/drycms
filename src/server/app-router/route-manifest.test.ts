import { describe, expect, it } from "vitest";
import { buildManifestRouteTree, listDynamicPageTemplates, matchSourceRoute, notFoundRoute, staticPagePaths } from "./route-manifest.js";

// Storage-root-relative, so every route file sits under the `pages` source
// root (`source-roots.ts`) - the shape `pagesSourceStorage`'s own `listAll()`
// returns since the root split.
const PATHS = [
  "pages/page.tsx",
  "pages/layout.tsx",
  "pages/404.tsx",
  "pages/500.tsx",
  "pages/about/page.tsx",
  "pages/blogs/layout.tsx",
  "pages/blogs/page.tsx",
  "pages/blogs/[slug]/page.tsx",
  "pages/blogs/[slug]/layout.tsx",
  // A catch-all - mục 4's "khai báo tay hoặc chấp nhận không build":
  // must never appear in listDynamicPageTemplates's output.
  "pages/docs/[...path]/page.tsx",
  // Non-route files a real storage listing would also contain - must be
  // ignored, not mistaken for a page/layout.
  "pages/Greeting.tsx",
  "pages/blogs/utils.ts",
  // Another source root entirely: a component named `page.tsx` is still just
  // a component, never the `/component` route.
  "component/Card.tsx",
  "component/page.tsx",
];

describe("buildManifestRouteTree + matchSourceRoute", () => {
  it("matches the root page with its root layout", () => {
    const tree = buildManifestRouteTree(PATHS);
    const match = matchSourceRoute(tree, "/");
    expect(match).toEqual({ entryPath: "pages/page.tsx", layoutPaths: ["pages/layout.tsx"], params: {} });
  });

  it("matches a nested static page with the full root-to-leaf layout chain", () => {
    const tree = buildManifestRouteTree(PATHS);
    const match = matchSourceRoute(tree, "/blogs");
    expect(match).toEqual({ entryPath: "pages/blogs/page.tsx", layoutPaths: ["pages/layout.tsx", "pages/blogs/layout.tsx"], params: {} });
  });

  it("matches a dynamic [slug] segment and captures the param", () => {
    const tree = buildManifestRouteTree(PATHS);
    const match = matchSourceRoute(tree, "/blogs/my-post");
    expect(match).toEqual({
      entryPath: "pages/blogs/[slug]/page.tsx",
      layoutPaths: ["pages/layout.tsx", "pages/blogs/layout.tsx", "pages/blogs/[slug]/layout.tsx"],
      params: { slug: "my-post" },
    });
  });

  it("returns null for a path with no matching page", () => {
    const tree = buildManifestRouteTree(PATHS);
    expect(matchSourceRoute(tree, "/nowhere/at/all")).toBeNull();
  });

  it("staticPagePaths lists every STATIC page, excluding dynamic segments", () => {
    const tree = buildManifestRouteTree(PATHS);
    expect(staticPagePaths(tree).sort()).toEqual(["/", "/about", "/blogs"]);
  });

  it("ignores a non-route file at the tree root (a plain component next to page.tsx)", () => {
    const tree = buildManifestRouteTree(PATHS);
    // Not `[slug]`-shaped and no page.tsx/layout.tsx of its own name -
    // never becomes a route node just because it's in the manifest.
    expect(matchSourceRoute(tree, "/Greeting")).toBeNull();
  });

  it("a non-route file under a [slug] directory still resolves through that dynamic segment - same as any other visitor-typed path (route-tree.ts's own documented behavior, not a bug here)", () => {
    const tree = buildManifestRouteTree(PATHS);
    const match = matchSourceRoute(tree, "/blogs/utils");
    expect(match?.entryPath).toBe("pages/blogs/[slug]/page.tsx");
    expect(match?.params).toEqual({ slug: "utils" });
  });
});

describe("notFoundRoute", () => {
  it("resolves the pages-root 404.tsx's own source path, with the root layout", () => {
    const tree = buildManifestRouteTree(PATHS);
    expect(notFoundRoute(tree)).toEqual({ entryPath: "pages/404.tsx", layoutPaths: ["pages/layout.tsx"] });
  });

  it("omits layoutPaths when the tree has no root layout of its own", () => {
    const tree = buildManifestRouteTree(["pages/page.tsx", "pages/404.tsx"]);
    expect(notFoundRoute(tree)).toEqual({ entryPath: "pages/404.tsx", layoutPaths: [] });
  });

  it("is undefined when the tree has no 404.tsx at all", () => {
    const tree = buildManifestRouteTree(["pages/page.tsx", "pages/layout.tsx"]);
    expect(notFoundRoute(tree)).toBeUndefined();
  });
});

describe("listDynamicPageTemplates", () => {
  it("finds the single-level [slug] template with its full layout chain, and skips the catch-all entirely", () => {
    const tree = buildManifestRouteTree(PATHS);
    const templates = listDynamicPageTemplates(tree);
    expect(templates).toEqual([
      {
        pathnameTemplate: "/blogs/[slug]",
        paramName: "slug",
        entryPath: "pages/blogs/[slug]/page.tsx",
        layoutPaths: ["pages/layout.tsx", "pages/blogs/layout.tsx", "pages/blogs/[slug]/layout.tsx"],
      },
    ]);
    // docs/[...path]/page.tsx must never appear - catch-all, mục 4's
    // "khai báo tay hoặc chấp nhận không build".
    expect(templates.some((t) => t.pathnameTemplate.includes("..."))).toBe(false);
  });

  it("returns nothing for a tree with no dynamic segments at all", () => {
    const tree = buildManifestRouteTree(["pages/page.tsx", "pages/layout.tsx", "pages/about/page.tsx"]);
    expect(listDynamicPageTemplates(tree)).toEqual([]);
  });
});
