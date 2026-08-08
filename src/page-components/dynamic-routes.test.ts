import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeCallLog } from "../server/app-router/dry-replay-codec.js";
import type { ContentTypeDefinition } from "../content-types/types.js";
import type { DynamicPageTemplate } from "../server/app-router/route-manifest.js";
import { resolveDynamicPages } from "./dynamic-routes.js";

const BLOG_TYPE: ContentTypeDefinition = {
  id: "blog-id",
  kind: "collection",
  name: "blog",
  label: "Blog",
  fields: [],
  version: 0,
  features: { slug: true },
  seoUrlPattern: "/blogs/{slug}",
};

const TEMPLATE: DynamicPageTemplate = {
  pathnameTemplate: "/blogs/[slug]",
  paramName: "slug",
  entryPath: "blogs/[slug]/page.tsx",
  layoutPaths: ["layout.tsx", "blogs/layout.tsx"],
};

describe("resolveDynamicPages", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("matches a template to its content type via seoUrlPattern and resolves one page per published slug", async () => {
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { page: number };
      if (body.page === 0) {
        const rows = [{ slug: "hello-world" }, { slug: "second-post" }];
        return new Response(encodeCallLog([{ kind: "collection", name: "blog", method: "list", result: { rows, total: 2 } }]), { status: 200 });
      }
      return new Response(encodeCallLog([{ kind: "collection", name: "blog", method: "list", result: { rows: [], total: 2 } }]), { status: 200 });
    });

    const [resolution] = await resolveDynamicPages([TEMPLATE], [BLOG_TYPE], "/dry/api/dry-http");

    expect(resolution!.type).toBe(BLOG_TYPE);
    expect(resolution!.pages).toEqual([
      { pathname: "/blogs/hello-world", entryPath: "blogs/[slug]/page.tsx", layoutPaths: ["layout.tsx", "blogs/layout.tsx"], params: { slug: "hello-world" } },
      { pathname: "/blogs/second-post", entryPath: "blogs/[slug]/page.tsx", layoutPaths: ["layout.tsx", "blogs/layout.tsx"], params: { slug: "second-post" } },
    ]);
  });

  it("paginates past 500 rows", async () => {
    let calls = 0;
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      calls += 1;
      const body = JSON.parse(init.body as string) as { page: number };
      const rows = body.page === 0 ? Array.from({ length: 500 }, (_, i) => ({ slug: `post-${i}` })) : [{ slug: "post-500" }];
      return new Response(encodeCallLog([{ kind: "collection", name: "blog", method: "list", result: { rows, total: 501 } }]), { status: 200 });
    });

    const [resolution] = await resolveDynamicPages([TEMPLATE], [BLOG_TYPE], "/dry/api/dry-http");

    expect(calls).toBe(2);
    expect(resolution!.pages).toHaveLength(501);
  });

  it("reports type: null when no content type's seoUrlPattern matches the template, without calling fetch", async () => {
    const [resolution] = await resolveDynamicPages([TEMPLATE], [{ ...BLOG_TYPE, seoUrlPattern: "/articles/{slug}" }], "/dry/api/dry-http");
    expect(resolution!.type).toBeNull();
    expect(resolution!.pages).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
