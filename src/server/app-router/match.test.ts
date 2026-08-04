import { describe, expect, it } from "vitest";
import { buildRouteTree, type ModuleLoader } from "./route-tree.js";
import { matchRoute } from "./match.js";

const ROOT = "/src/apps/pages";

/** Fake loader - never actually called in these tests, only identity
 * matters (each `id` gets its own function reference so tests can assert
 * exactly which loader matched). */
function loader(id: string): ModuleLoader {
  const fn = () => Promise.resolve({ default: () => id }) as never;
  (fn as unknown as { id: string }).id = id;
  return fn as unknown as ModuleLoader;
}

function id(l: ModuleLoader): string {
  return (l as unknown as { id: string }).id;
}

describe("matchRoute", () => {
  it("matches the root page and root layout", () => {
    const tree = buildRouteTree(
      {
        [`${ROOT}/page.tsx`]: loader("root-page"),
        [`${ROOT}/layout.tsx`]: loader("root-layout"),
      },
      ROOT,
    );
    const match = matchRoute(tree, "/");
    expect(match).not.toBeNull();
    expect(id(match!.page)).toBe("root-page");
    expect(match!.layouts.map(id)).toEqual(["root-layout"]);
    expect(match!.params).toEqual({});
  });

  it("prefers a static segment over a dynamic sibling", () => {
    const tree = buildRouteTree(
      {
        [`${ROOT}/blog/new/page.tsx`]: loader("blog-new"),
        [`${ROOT}/blog/[slug]/page.tsx`]: loader("blog-slug"),
      },
      ROOT,
    );
    const staticMatch = matchRoute(tree, "/blog/new");
    expect(id(staticMatch!.page)).toBe("blog-new");
    expect(staticMatch!.params).toEqual({});

    const dynamicMatch = matchRoute(tree, "/blog/hello-world");
    expect(id(dynamicMatch!.page)).toBe("blog-slug");
    expect(dynamicMatch!.params).toEqual({ slug: "hello-world" });
  });

  it("falls back to a catch-all when no static/dynamic sibling matches", () => {
    const tree = buildRouteTree(
      {
        [`${ROOT}/docs/[...path]/page.tsx`]: loader("docs-catch-all"),
      },
      ROOT,
    );
    const match = matchRoute(tree, "/docs/a/b/c");
    expect(id(match!.page)).toBe("docs-catch-all");
    expect(match!.params).toEqual({ path: ["a", "b", "c"] });
  });

  it("prefers a dynamic segment over a catch-all sibling", () => {
    const tree = buildRouteTree(
      {
        [`${ROOT}/docs/[slug]/page.tsx`]: loader("docs-slug"),
        [`${ROOT}/docs/[...path]/page.tsx`]: loader("docs-catch-all"),
      },
      ROOT,
    );
    const match = matchRoute(tree, "/docs/one");
    expect(id(match!.page)).toBe("docs-slug");
    expect(match!.params).toEqual({ slug: "one" });
  });

  it("collects layouts root-to-leaf, skipping levels without a layout.tsx", () => {
    const tree = buildRouteTree(
      {
        [`${ROOT}/layout.tsx`]: loader("root-layout"),
        [`${ROOT}/blog/[slug]/page.tsx`]: loader("blog-slug"),
        [`${ROOT}/blog/[slug]/layout.tsx`]: loader("blog-slug-layout"),
      },
      ROOT,
    );
    const match = matchRoute(tree, "/blog/hello");
    expect(match!.layouts.map(id)).toEqual(["root-layout", "blog-slug-layout"]);
  });

  it("returns null for a folder that only has a layout.tsx, no page.tsx", () => {
    const tree = buildRouteTree(
      {
        [`${ROOT}/blog/layout.tsx`]: loader("blog-layout"),
        [`${ROOT}/blog/[slug]/page.tsx`]: loader("blog-slug"),
      },
      ROOT,
    );
    expect(matchRoute(tree, "/blog")).toBeNull();
    expect(matchRoute(tree, "/blog/hello")).not.toBeNull();
  });

  it("returns null when no segment matches at all", () => {
    const tree = buildRouteTree(
      { [`${ROOT}/page.tsx`]: loader("root-page") },
      ROOT,
    );
    expect(matchRoute(tree, "/nope")).toBeNull();
  });
});
