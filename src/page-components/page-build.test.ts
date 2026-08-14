import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeCallLog } from "../server/app-router/dry-replay-codec.js";
import type { ContentTypeDefinition } from "../content-types/types.js";
import { buildPage, candidatePathsFor, canSkipBuild, computeSourceHash, evalModule, pagesAffectedBy, publishBuiltPage, resolveAllPageTargets, PageBuildError } from "./page-build.js";

const TEST_ASSETS = { globalsCssHref: "/assets/globals.css", hydrateEntryHref: "/assets/hydrate.js", veiOverlayHref: "/assets/vei-overlay.js" };
const TEST_PREACT_RUNTIME_HREF = "/assets/preact-runtime.js";
const TEST_BUILT_ASSETS_BASE_URL = "/dry/api/built-assets";

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

it("includes 404.tsx and 500.tsx as built live targets", async () => {
  const { targets } = await resolveAllPageTargets(
    {
      "pages/page.tsx": "export default function Page() { return <main />; }",
      "pages/layout.tsx": "export default function Layout({ children }) { return <div>{children}</div>; }",
      "pages/404.tsx": "export default function NotFound() { return <main />; }",
      "pages/500.tsx": "export default function ErrorPage() { return <main />; }",
    },
    [],
    "/dry/api/dry-http",
  );
  expect(targets.get("/404")).toEqual({ pathname: "/404", entryPath: "pages/404.tsx", layoutPaths: ["pages/layout.tsx"], params: {} });
  expect(targets.get("/500")).toEqual({ pathname: "/500", entryPath: "pages/500.tsx", layoutPaths: ["pages/layout.tsx"], params: {} });
});

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
      assets: TEST_ASSETS,
      preactRuntimeHref: TEST_PREACT_RUNTIME_HREF,
      builtAssetsBaseUrl: TEST_BUILT_ASSETS_BASE_URL,
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
    // Browser-built output owns a per-page inline Tailwind build. It must
    // not also load the deploy-time global bundle, whose older dark variant
    // rules could make preview theme follow the browser/admin environment.
    expect(result.html).not.toContain(`href="${TEST_ASSETS.globalsCssHref}"`);
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

    // mục 7 - the whole reachable closure (entry + layout + the layout's
    // OWN import) got compiled to real ESM, not just the entry.
    const jsPaths = result.jsAssets.map((a) => a.jsPath).sort();
    expect(jsPaths).toEqual(["Greeting.js", "layout.tsx".replace(".tsx", ".js"), "page.js"]);

    const pageJs = result.jsAssets.find((a) => a.jsPath === "page.js")!.source;
    // sucrase's classic pragma never auto-injects h/Fragment - buildPage
    // must prepend it itself (found live in the app-r2 spike). The asset is
    // minified (`minify-js.ts`) before being returned, so the prepended
    // import's local `h`/`Fragment` BINDING names may have been mangled to
    // something shorter - only the imported EXPORT names (never touched)
    // and the source URL are asserted on here, not exact formatting.
    expect(pageJs.startsWith("import{")).toBe(true);
    expect(pageJs).toContain(`from"${TEST_PREACT_RUNTIME_HREF}"`);
    // The page's own relative import rewritten to Greeting's PUBLIC asset
    // URL, not left as a bare "./Greeting.js" a visitor's browser could
    // never resolve.
    expect(pageJs).toContain(`from"${TEST_BUILT_ASSETS_BASE_URL}/Greeting.js"`);
    expect(pageJs).not.toContain('"./Greeting.js"');

    const greetingJs = result.jsAssets.find((a) => a.jsPath === "Greeting.js")!.source;
    // The explicit `import { useState } from "preact/hooks"` rewritten to
    // the SAME runtime URL as the prepended h/Fragment import (one shared
    // chunk, one Preact instance - hooks only work correctly that way).
    expect(greetingJs).toContain(`from"${TEST_PREACT_RUNTIME_HREF}"`);
    expect(greetingJs).not.toContain('"preact/hooks"');

    // The embedded manifest `hydrate-built.ts` reads client-side - real
    // entry/layout URLs, real params, escaped safely for inline <script>.
    const manifestMatch = /<script type="application\/json" id="dry-hydrate-manifest">([\s\S]*?)<\/script>/.exec(result.html);
    expect(JSON.parse(manifestMatch![1]!)).toEqual({
      entryUrl: `${TEST_BUILT_ASSETS_BASE_URL}/page.js`,
      layoutUrls: [`${TEST_BUILT_ASSETS_BASE_URL}/layout.js`],
      // `hydrate-built.ts` dynamically `import()`s `hydrate` from this same
      // URL (not a normal bundled import) so it shares ONE Preact module
      // instance with the page/layout assets above - see that file's doc
      // comment.
      preactRuntimeUrl: TEST_PREACT_RUNTIME_HREF,
    });
    const paramsMatch = /<script type="application\/json" id="dry-hydrate-params">([\s\S]*?)<\/script>/.exec(result.html);
    expect(JSON.parse(paramsMatch![1]!)).toEqual({ slug: "about" });
  });

  it("skips compiling jsAssets when skipJsAssets is set, still renders html", async () => {
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
      assets: TEST_ASSETS,
      preactRuntimeHref: TEST_PREACT_RUNTIME_HREF,
      builtAssetsBaseUrl: TEST_BUILT_ASSETS_BASE_URL,
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
      skipJsAssets: true,
    });

    // html renders exactly like the full build - only jsAssets is affected.
    expect(result.html).toContain("hello: My Site");
    expect(result.jsAssets).toEqual([]);
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
        assets: TEST_ASSETS,
      preactRuntimeHref: TEST_PREACT_RUNTIME_HREF,
      builtAssetsBaseUrl: TEST_BUILT_ASSETS_BASE_URL,
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

  it("resolves an `@component/...` import from the source root, and points its ESM asset at the built URL", async () => {
    fetchMock.mockResolvedValue(
      new Response(encodeCallLog([{ kind: "singleton", name: "seoDefaults", method: "get", result: null }]), {
        status: 200,
        headers: jsonHeaders("seoDefaults", 0),
      }),
    );

    const result = await buildPage({
      pathname: "/",
      origin: "https://example.com",
      adminPath: "/dry",
      siteLang: "en",
      assets: TEST_ASSETS,
      preactRuntimeHref: TEST_PREACT_RUNTIME_HREF,
      builtAssetsBaseUrl: TEST_BUILT_ASSETS_BASE_URL,
      dryHttpEndpoint: "/dry/api/dry-http",
      allTypes: [],
      sourceByPath: {
        "pages/page.tsx": `import Card from "@component/ui/Card";\nexport default function Page() { return <Card title="Hi" />; }`,
        "pages/layout.tsx": LAYOUT_SOURCE,
        "component/ui/Card.tsx": `export default function Card({ title }) { return <div class="card">{title}</div>; }`,
      },
      entryPath: "pages/page.tsx",
      layoutPaths: ["pages/layout.tsx"],
      params: {},
    });

    expect(result.html).toContain('class="card"');
    expect(result.html).toContain("Hi");
    // The component is part of the page's own hydration closure, and the
    // alias specifier is rewritten to its public asset URL - a browser has
    // no idea what `@component/...` means.
    const cardAsset = result.jsAssets.find((asset) => asset.jsPath === "component/ui/Card.js");
    expect(cardAsset).toBeDefined();
    const pageAsset = result.jsAssets.find((asset) => asset.jsPath === "pages/page.js");
    expect(pageAsset!.source).toContain(`${TEST_BUILT_ASSETS_BASE_URL}/component/ui/Card.js`);
    expect(pageAsset!.source).not.toContain("@component/");
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
      assets: TEST_ASSETS,
      preactRuntimeHref: TEST_PREACT_RUNTIME_HREF,
      builtAssetsBaseUrl: TEST_BUILT_ASSETS_BASE_URL,
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
      { html: "<html></html>", jsAssets: [{ jsPath: "page.js", source: "export default function(){}" }], deps: [{ resource: "blog", version: 2 }], inSitemap: true },
      { pagesBuildEndpoint: "/dry/api/pages-build", pathname: "/blogs/abc", entryPath: "pages/blogs/abc/page.tsx", buildId: "build-1", sourceHash: "abc123" },
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/dry/api/pages-build");
    expect(JSON.parse(init.body as string)).toEqual({
      pathname: "/blogs/abc",
      entryPath: "pages/blogs/abc/page.tsx",
      html: "<html></html>",
      jsAssets: [{ jsPath: "page.js", source: "export default function(){}" }],
      buildId: "build-1",
      deps: [{ resource: "blog", version: 2 }],
      inSitemap: true,
      sourceHash: "abc123",
    });

    vi.unstubAllGlobals();
  });

  it("throws PageBuildError on a non-OK response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
    await expect(
      publishBuiltPage(
        { html: "", jsAssets: [], deps: [], inSitemap: true },
        { pagesBuildEndpoint: "/dry/api/pages-build", pathname: "/x", entryPath: "pages/x/page.tsx", sourceHash: "abc123" },
      ),
    ).rejects.toThrow(PageBuildError);
    vi.unstubAllGlobals();
  });
});

describe("computeSourceHash", () => {
  const SOURCE = {
    "pages/layout.tsx": `import Nav from "@component/Nav";\nexport default function Layout({ children }) { return <div><Nav />{children}</div>; }`,
    "pages/page.tsx": `export default function Page() { return <div />; }`,
    "pages/blogs/[slug]/page.tsx": `export default function Blog() { return <div />; }`,
    "pages/unrelated/page.tsx": `export default function Unrelated() { return <div />; }`,
    "component/Nav.tsx": `export default function Nav() { return <nav />; }`,
  };

  it("is stable regardless of sourceByPath key-insertion order", async () => {
    const reordered = Object.fromEntries(Object.entries(SOURCE).reverse());
    const a = await computeSourceHash({ entryPath: "pages/page.tsx", layoutPaths: ["pages/layout.tsx"] }, SOURCE);
    const b = await computeSourceHash({ entryPath: "pages/page.tsx", layoutPaths: ["pages/layout.tsx"] }, reordered);
    expect(a).toBe(b);
  });

  it("changes when the entry page's own source changes", async () => {
    const before = await computeSourceHash({ entryPath: "pages/page.tsx", layoutPaths: [] }, SOURCE);
    const after = await computeSourceHash({ entryPath: "pages/page.tsx", layoutPaths: [] }, { ...SOURCE, "pages/page.tsx": `export default function Page() { return <span />; }` });
    expect(after).not.toBe(before);
  });

  it("changes when a layout's source changes", async () => {
    const target = { entryPath: "pages/page.tsx", layoutPaths: ["pages/layout.tsx"] };
    const before = await computeSourceHash(target, SOURCE);
    const after = await computeSourceHash(target, { ...SOURCE, "pages/layout.tsx": SOURCE["pages/layout.tsx"] + "\n// edited" });
    expect(after).not.toBe(before);
  });

  it("changes when an indirectly-imported component changes", async () => {
    const target = { entryPath: "pages/page.tsx", layoutPaths: ["pages/layout.tsx"] };
    const before = await computeSourceHash(target, SOURCE);
    const after = await computeSourceHash(target, { ...SOURCE, "component/Nav.tsx": SOURCE["component/Nav.tsx"] + "\n// edited" });
    expect(after).not.toBe(before);
  });

  it("is unaffected by an unrelated file elsewhere in sourceByPath", async () => {
    const target = { entryPath: "pages/page.tsx", layoutPaths: [] };
    const before = await computeSourceHash(target, SOURCE);
    const after = await computeSourceHash(target, { ...SOURCE, "pages/unrelated/page.tsx": SOURCE["pages/unrelated/page.tsx"] + "\n// edited" });
    expect(after).toBe(before);
  });

  it("hashes identically across dynamic-route instances sharing one template", async () => {
    // Same entryPath/layoutPaths (one `page.tsx` template) - `params` never
    // enters the hash, since code didn't change between resolved instances.
    const target = { entryPath: "pages/blogs/[slug]/page.tsx", layoutPaths: [] };
    const a = await computeSourceHash(target, SOURCE);
    const b = await computeSourceHash(target, SOURCE);
    expect(a).toBe(b);
  });
});

describe("canSkipBuild", () => {
  it("is false when the page was never built before", () => {
    expect(canSkipBuild(undefined, "hash-1")).toBe(false);
  });

  it("is false when content is stale", () => {
    expect(canSkipBuild({ staleResource: "blog", sourceHash: "hash-1" }, "hash-1")).toBe(false);
  });

  it("is false when the recorded hash is null (legacy row / caller didn't attach one)", () => {
    expect(canSkipBuild({ staleResource: null, sourceHash: null }, "hash-1")).toBe(false);
  });

  it("is false when the source hash changed", () => {
    expect(canSkipBuild({ staleResource: null, sourceHash: "hash-1" }, "hash-2")).toBe(false);
  });

  it("is true when content is current and the source hash matches", () => {
    expect(canSkipBuild({ staleResource: null, sourceHash: "hash-1" }, "hash-1")).toBe(true);
  });
});

describe("pagesAffectedBy", () => {
  const SOURCE = {
    "pages/layout.tsx": `import Nav from "@component/Nav";\nexport default function Layout({ children }) { return <div><Nav />{children}</div>; }`,
    "pages/page.tsx": `export default function Page() { return <div />; }`,
    "pages/about/page.tsx": `import Card from "@component/Card";\nexport default function About() { return <Card />; }`,
    "pages/blogs/page.tsx": `export default function Blogs() { return <div />; }`,
    "component/Card.tsx": `export default function Card() { return <div />; }`,
    "component/Nav.tsx": `export default function Nav() { return <nav />; }`,
  };

  it("finds the pages that import a component directly", () => {
    expect(pagesAffectedBy("component/Card.tsx", SOURCE)).toEqual(["pages/about/page.tsx"]);
  });

  it("finds pages reached only through a layout that imports the component", () => {
    // Every page is wrapped by the root layout, and the root layout is what
    // imports `Nav` - none of the pages import it themselves.
    expect(pagesAffectedBy("component/Nav.tsx", SOURCE).sort()).toEqual([
      "pages/about/page.tsx",
      "pages/blogs/page.tsx",
      "pages/page.tsx",
    ]);
  });

  it("returns a page itself when the changed file IS that page", () => {
    expect(pagesAffectedBy("pages/blogs/page.tsx", SOURCE)).toEqual(["pages/blogs/page.tsx"]);
  });
});

describe("candidatePathsFor", () => {
  it("resolves a relative import to its .tsx/.ts candidates", () => {
    expect(candidatePathsFor("pages/blogs/page.tsx", "./Greeting.js")).toEqual({
      kind: "candidates",
      paths: ["pages/blogs/Greeting.tsx", "pages/blogs/Greeting.ts"],
    });
  });

  it("resolves a @component alias from the storage root, not relative to the importer", () => {
    expect(candidatePathsFor("pages/blogs/[slug]/page.tsx", "@component/Card")).toEqual({
      kind: "candidates",
      paths: ["component/Card.tsx", "component/Card.ts"],
    });
  });

  it("treats preact/preact-hooks as external", () => {
    expect(candidatePathsFor("pages/page.tsx", "preact/hooks").kind).toBe("external");
  });

  it("throws on a bare specifier that isn't relative/aliased/preact", () => {
    expect(() => candidatePathsFor("pages/page.tsx", "lodash")).toThrow(PageBuildError);
  });

  it("evaluates hook imports against a caller-provided Preact runtime", () => {
    const customHook = () => "custom";
    const result = evalModule(
      "component/Test.tsx",
      { "component/Test.tsx": 'import { useEffect } from "preact/hooks"; export const hook = useEffect; export default () => null;' },
      new Map(),
      { h: (() => null) as never, Fragment: Symbol("fragment") as never, hooks: { useEffect: customHook } },
    );
    expect(result.exports.hook).toBe(customHook);
  });
});
