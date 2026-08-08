import { describe, expect, it } from "vitest";
import { buildManifestRouteTree, matchSourceRoute, staticPagePaths } from "./route-manifest.js";

const PATHS = [
  "page.tsx",
  "layout.tsx",
  "404.tsx",
  "500.tsx",
  "about/page.tsx",
  "blogs/layout.tsx",
  "blogs/page.tsx",
  "blogs/[slug]/page.tsx",
  "blogs/[slug]/layout.tsx",
  // Non-route files a real storage listing would also contain - must be
  // ignored, not mistaken for a page/layout.
  "Greeting.tsx",
  "blogs/utils.ts",
];

describe("buildManifestRouteTree + matchSourceRoute", () => {
  it("matches the root page with its root layout", () => {
    const tree = buildManifestRouteTree(PATHS);
    const match = matchSourceRoute(tree, "/");
    expect(match).toEqual({ entryPath: "page.tsx", layoutPaths: ["layout.tsx"], params: {} });
  });

  it("matches a nested static page with the full root-to-leaf layout chain", () => {
    const tree = buildManifestRouteTree(PATHS);
    const match = matchSourceRoute(tree, "/blogs");
    expect(match).toEqual({ entryPath: "blogs/page.tsx", layoutPaths: ["layout.tsx", "blogs/layout.tsx"], params: {} });
  });

  it("matches a dynamic [slug] segment and captures the param", () => {
    const tree = buildManifestRouteTree(PATHS);
    const match = matchSourceRoute(tree, "/blogs/my-post");
    expect(match).toEqual({
      entryPath: "blogs/[slug]/page.tsx",
      layoutPaths: ["layout.tsx", "blogs/layout.tsx", "blogs/[slug]/layout.tsx"],
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
    expect(match?.entryPath).toBe("blogs/[slug]/page.tsx");
    expect(match?.params).toEqual({ slug: "utils" });
  });
});
