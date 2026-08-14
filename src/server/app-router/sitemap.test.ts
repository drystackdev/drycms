import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { ContentTypeDefinition } from "../../content-types/types.js";
import type { DevPagesSource, RouteModule } from "./route-tree.js";

const tempDirBox = vi.hoisted(() => ({ path: "" }));

vi.mock("../config.js", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  tempDirBox.path = mkdtempSync(join(tmpdir(), "drycms-sitemap-test-"));
  return { path: "/dry", content: { engine: "sqlite", file: join(tempDirBox.path, "content.sqlite") } };
});

const { content, path: adminPath } = await import("../config.js");
const { createContentEngineAdapter, createContentEntryEngineAdapter } = await import("../../content-types/engine/index.js");
const { buildRobotsResponse, buildSitemapResponse } = await import("./sitemap.js");

const ORIGINAL_APP_DOMAIN = process.env.APP_DOMAIN;

afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(tempDirBox.path, { recursive: true, force: true });
});

afterEach(() => {
  if (ORIGINAL_APP_DOMAIN === undefined) delete process.env.APP_DOMAIN;
  else process.env.APP_DOMAIN = ORIGINAL_APP_DOMAIN;
});

const routeContext = { request: new Request("http://localhost/sitemap.xml"), url: new URL("http://localhost/sitemap.xml"), params: {}, env: {}, session: null } as never;

/**
 * A fixture route tree, injected through `buildSitemapResponse`'s own
 * `devSource` test seam (`route-tree.ts`'s `DevPagesSource`) so the unit test
 * does not depend on the checkout's live `.dry/pages-source` content.
 */
function fixturePagesSource(sourceByPath: Record<string, string>): DevPagesSource {
  const routeModule: RouteModule = { default: () => null };
  return {
    listPaths: async () => Object.keys(sourceByPath),
    loadModule: async () => routeModule,
    readSource: async (relPath) => sourceByPath[relPath] ?? "",
    browserUrlFor: (relPath) => `/${relPath}`,
  };
}

/** The `[slug]` page's body is what maps that route to a collection now
 * (`page-collection.ts`) - a real page's `dry().collection(x).get(param)`
 * call, condensed to the one line this actually reads. */
const staticPages = fixturePagesSource({
  "pages/page.tsx": "",
  "pages/about/page.tsx": "",
  "pages/blogs/page.tsx": "",
  "pages/blogs/[slug]/page.tsx": 'const post = await dry().collection("story").get(String(slug));',
});

describe("buildRobotsResponse", () => {
  it("disallows the admin path and points at sitemap.xml, absolute to APP_DOMAIN when set", () => {
    process.env.APP_DOMAIN = "https://example.com";
    const response = buildRobotsResponse(new URL("http://localhost/robots.txt"));
    expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
    return response.text().then((body) => {
      expect(body).toContain(`Disallow: ${adminPath}/`);
      expect(body).toContain("Sitemap: https://example.com/sitemap.xml");
    });
  });
});

describe("buildSitemapResponse", () => {
  it("includes every static page from the route tree, absolute to the request's own origin when APP_DOMAIN is unset", async () => {
    delete process.env.APP_DOMAIN;
    const response = await buildSitemapResponse(new URL("http://localhost/sitemap.xml"), routeContext, staticPages);
    expect(response.headers.get("Content-Type")).toBe("application/xml; charset=utf-8");
    const xml = await response.text();
    expect(xml).toContain("<loc>http://localhost/</loc>");
    expect(xml).toContain("<loc>http://localhost/about</loc>");
    expect(xml).toContain("<loc>http://localhost/blogs</loc>");
    // The dynamic [slug] route itself can't be enumerated from the tree.
    expect(xml).not.toContain("[slug]");
  });

  it("includes a published entry of the collection the [slug] page itself reads, at that route's own pathname", async () => {
    const schema = createContentEngineAdapter(content);
    const entries = createContentEntryEngineAdapter(content);
    const story: ContentTypeDefinition = {
      id: "test-story",
      kind: "collection",
      name: "story",
      label: "Story",
      features: { slug: true, seo: true },
      fields: [],
      version: 0,
    };
    await schema.applySave(story, await schema.planSave(story));
    const allTypes = await schema.listContentTypes();
    const storyType = allTypes.find((t) => t.id === "test-story")!;
    await entries.createEntry(storyType, allTypes, { title: "My Story", slug: "my-story" });

    const response = await buildSitemapResponse(new URL("http://localhost/sitemap.xml"), routeContext, staticPages);
    const xml = await response.text();
    expect(xml).toContain("<loc>http://localhost/blogs/my-story</loc>");
  });

  it("excludes an entry whose own seo.noIndex is true", async () => {
    const schema = createContentEngineAdapter(content);
    const entries = createContentEntryEngineAdapter(content);
    const allTypes = await schema.listContentTypes();
    const storyType = allTypes.find((t) => t.id === "test-story")!;
    await entries.createEntry(storyType, allTypes, { title: "Hidden", slug: "hidden-story", seo: { noIndex: true } });

    const response = await buildSitemapResponse(new URL("http://localhost/sitemap.xml"), routeContext, staticPages);
    const xml = await response.text();
    expect(xml).toContain("my-story");
    expect(xml).not.toContain("hidden-story");
  });

  /** The point of reading the route tree instead of the content types: a
   * collection nothing renders has no URL to advertise, so it can't end up
   * in the sitemap as a 404 waiting to be crawled. */
  it("leaves out a slug-enabled collection that no [param] page reads", async () => {
    const schema = createContentEngineAdapter(content);
    const entries = createContentEntryEngineAdapter(content);
    const note: ContentTypeDefinition = {
      id: "test-note",
      kind: "collection",
      name: "note",
      label: "Note",
      features: { slug: true, seo: true },
      fields: [],
      version: 0,
    };
    await schema.applySave(note, await schema.planSave(note));
    const allTypes = await schema.listContentTypes();
    const noteType = allTypes.find((t) => t.id === "test-note")!;
    await entries.createEntry(noteType, allTypes, { title: "Routeless", slug: "routeless-note" });

    const response = await buildSitemapResponse(new URL("http://localhost/sitemap.xml"), routeContext, staticPages);
    const xml = await response.text();
    expect(xml).toContain("my-story");
    expect(xml).not.toContain("routeless-note");
  });

  // The site-wide `noIndex` gate (empty urlset when the SEO Defaults
  // singleton itself is set to noIndex) is covered in
  // `sitemap-site-noindex.test.ts` instead of here, via a mocked
  // `loadSeoDefaults` - see that file's own doc comment for why (setting a
  // real `seoDefaults` row through this test harness would need a full
  // admin-driven write path this suite doesn't otherwise exercise, not
  // anything specific to this file).
});
