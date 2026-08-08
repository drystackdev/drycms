import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeCallLog } from "../server/app-router/dry-replay-codec.js";
import type { ContentTypeDefinition } from "../content-types/types.js";
import { buildPage, publishBuiltPage, PageBuildError } from "./page-build.js";

const SITE_SETTINGS_TYPE: ContentTypeDefinition = {
  id: "site-settings-id",
  kind: "singleton",
  name: "siteSettings",
  label: "Site Settings",
  fields: [],
  version: 0,
};

const SEO_DEFAULTS_TYPE: ContentTypeDefinition = {
  id: "seo-defaults-id",
  kind: "singleton",
  name: "seoDefaults",
  label: "SEO Defaults",
  fields: [],
  version: 0,
};

const LAYOUT_SOURCE = `
export default function Layout({ children }) {
  return <div class="shell">{children}</div>;
}
`;

// Exercises every ambient global at once (dry/params/setTitle/dryBind) AND
// an explicit "preact/hooks" import - the spike's unknown #1, now a real,
// permanent test instead of a throwaway harness run. `dry()` returns a
// Promise, so the top-level page has to be `async` to await it - and an
// async component can't use hooks itself (resolve-match.ts's own doc
// comment) - so `useState` lives in a nested SYNC child instead, the exact
// shape a real page is expected to use.
const REAL_PAGE_SOURCE = `
import Greeting from "./Greeting.js";

export default async function Page() {
  const settings = await dry().singleton("siteSettings").get();
  params();
  setTitle("Built Page Title");
  return <Greeting settings={settings} />;
}
`;

const GREETING_SOURCE = `
import { useState } from "preact/hooks";

export default function Greeting({ settings }) {
  const [greeting] = useState("hello");
  return <div class="greeting" {...dryBind(settings && settings.$ ? settings.$.title : null)}>{greeting}: {settings ? settings.title : "no title"}</div>;
}
`;

function jsonHeaders(resource: string, version: number): Record<string, string> {
  return { "Content-Type": "application/json; charset=utf-8", "X-Dry-Resource": resource, "X-Dry-Resource-Version": String(version) };
}

describe("buildPage", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("compiles+renders a real page: preact/hooks import, dry()/params()/setTitle()/dryBind() ambient globals, nested layout", async () => {
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { kind: string; name: string };
      if (body.kind === "singleton" && body.name === "siteSettings") {
        const text = encodeCallLog([{ kind: "singleton", name: "siteSettings", method: "get", result: { id: 1, title: "My Site" } }]);
        return new Response(text, { status: 200, headers: jsonHeaders("siteSettings", 7) });
      }
      if (body.kind === "singleton" && body.name === "seoDefaults") {
        const text = encodeCallLog([{ kind: "singleton", name: "seoDefaults", method: "get", result: { id: 1, seo: null } }]);
        return new Response(text, { status: 200, headers: jsonHeaders("seoDefaults", 1) });
      }
      throw new Error(`unexpected dry-http call: ${JSON.stringify(body)}`);
    });

    const result = await buildPage({
      pathname: "/about",
      origin: "https://example.com",
      adminPath: "/dry",
      siteLang: "en",
      dryHttpEndpoint: "/dry/api/dry-http",
      allTypes: [SITE_SETTINGS_TYPE, SEO_DEFAULTS_TYPE],
      sourceByPath: {
        "page.tsx": REAL_PAGE_SOURCE,
        "layout.tsx": LAYOUT_SOURCE,
        "Greeting.tsx": GREETING_SOURCE,
      },
      entryPath: "page.tsx",
      layoutPaths: ["layout.tsx"],
      params: { slug: "about" },
    });

    // Layout wraps page content.
    expect(result.html).toContain('<div class="shell">');
    // preact/hooks useState + the fetched singleton's title both rendered.
    expect(result.html).toContain("hello: My Site");
    // setTitle() fed the SEO cascade's `page` tier, picked up by
    // build-document.ts's buildSeoTags - not just a bare string in the body.
    expect(result.html).toContain("<title>Built Page Title</title>");
    // dryBind() on an INERT ref (`withInertRefs`'s `$`) must return `{}` -
    // no marker attribute, not a thrown error.
    expect(result.html).not.toContain("data-dry-ref");
    // origin/pathname fed canonical.
    expect(result.html).toContain('<link rel="canonical" href="https://example.com/about">');

    // The tracked dep is `siteSettings` (the page's own dry() call) plus the
    // untracked `seoDefaults` fetch - both present, deduped.
    expect(result.deps.sort((a, b) => a.resource.localeCompare(b.resource))).toEqual([
      { resource: "seoDefaults", version: 1 },
      { resource: "siteSettings", version: 7 },
    ]);
    expect(result.inSitemap).toBe(true);
  });

  it("rejects a bare npm import outside the preact/preact-hooks allowlist", async () => {
    fetchMock.mockResolvedValue(
      new Response(encodeCallLog([{ kind: "singleton", name: "seoDefaults", method: "get", result: null }]), {
        status: 200,
        headers: jsonHeaders("seoDefaults", 0),
      }),
    );

    await expect(
      buildPage({
        pathname: "/x",
        origin: "https://example.com",
        adminPath: "/dry",
        siteLang: "en",
        dryHttpEndpoint: "/dry/api/dry-http",
        allTypes: [],
        sourceByPath: {
          "page.tsx": `import dayjs from "dayjs";\nexport default function Page() { return <div>{String(dayjs)}</div>; }`,
          "layout.tsx": LAYOUT_SOURCE,
        },
        entryPath: "page.tsx",
        layoutPaths: ["layout.tsx"],
        params: {},
      }),
    ).rejects.toThrow(PageBuildError);
  });

  it("computes inSitemap=false when the page's own SEO cascade sets noIndex", async () => {
    fetchMock.mockImplementation(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string) as { kind: string; name: string };
      const text = encodeCallLog([{ kind: body.kind as "singleton", name: body.name, method: "get", result: { id: 1, seo: { noIndex: true } } }]);
      return new Response(text, { status: 200, headers: jsonHeaders(body.name, 1) });
    });

    const result = await buildPage({
      pathname: "/hidden",
      origin: "https://example.com",
      adminPath: "/dry",
      siteLang: "en",
      dryHttpEndpoint: "/dry/api/dry-http",
      allTypes: [SEO_DEFAULTS_TYPE],
      sourceByPath: {
        "page.tsx": `export default function Page() { return <div>hidden</div>; }`,
        "layout.tsx": LAYOUT_SOURCE,
      },
      entryPath: "page.tsx",
      layoutPaths: ["layout.tsx"],
      params: {},
    });

    expect(result.inSitemap).toBe(false);
  });
});

describe("publishBuiltPage", () => {
  it("POSTs the build result to the pages-build endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await publishBuiltPage(
      { html: "<html></html>", deps: [{ resource: "blog", version: 2 }], inSitemap: true },
      { pagesBuildEndpoint: "/dry/api/pages-build", pathname: "/blogs/abc", buildId: "build-1", publishAt: null },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/dry/api/pages-build");
    expect(JSON.parse(init.body as string)).toEqual({
      pathname: "/blogs/abc",
      html: "<html></html>",
      buildId: "build-1",
      deps: [{ resource: "blog", version: 2 }],
      inSitemap: true,
      publishAt: null,
    });

    vi.unstubAllGlobals();
  });

  it("throws PageBuildError on a non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
    await expect(
      publishBuiltPage({ html: "", deps: [], inSitemap: true }, { pagesBuildEndpoint: "/dry/api/pages-build", pathname: "/x" }),
    ).rejects.toThrow(PageBuildError);
    vi.unstubAllGlobals();
  });
});
