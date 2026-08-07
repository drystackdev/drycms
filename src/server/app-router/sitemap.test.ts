import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { SYSTEM_COMPONENT_IDS } from "../../content-types/system-fields.js";
import type { ContentEngineAdapter } from "../../content-types/engine/types.js";
import type { ContentTypeDefinition } from "../../content-types/types.js";

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
 * This repo's own `dry.seed.json` (an app-specific packaged seed - see
 * `seed.ts`'s `resolveDefaultContentTypeDefinitions`) takes over content-type
 * seeding COMPLETELY, so a fresh test DB's built-in `seo` component reflects
 * whatever `dry.seed.json` was last snapshotted with, not this branch's
 * `seed.ts` edits - same gap a real admin hits on an existing/live DB (adding
 * a field to `seed.ts` doesn't reach an already-seeded install; it has to be
 * added through the schema editor + "Apply and build", see
 * `status/seo-standard.md`). Mirrors that exact fix here: fetches the live
 * `seo` component and adds the `noIndex` field to it directly, the same way
 * an admin's schema-editor Save would.
 */
async function ensureSeoNoIndexField(schema: ContentEngineAdapter): Promise<void> {
  const seoComponent = await schema.getContentType(SYSTEM_COMPONENT_IDS.seo);
  if (!seoComponent || seoComponent.fields.some((f) => f.name === "noIndex")) return;
  const next: ContentTypeDefinition = {
    ...seoComponent,
    fields: [
      ...seoComponent.fields,
      { id: "test-seo-no-index", name: "noIndex", label: "Hide from search engines", type: "boolean", config: {}, validation: {}, order: seoComponent.fields.length },
    ],
  };
  await schema.applySave(next, await schema.planSave(next));
}

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
  it("includes every static page from the real route tree, absolute to the request's own origin when APP_DOMAIN is unset", async () => {
    delete process.env.APP_DOMAIN;
    const response = await buildSitemapResponse(new URL("http://localhost/sitemap.xml"), routeContext);
    expect(response.headers.get("Content-Type")).toBe("application/xml; charset=utf-8");
    const xml = await response.text();
    expect(xml).toContain("<loc>http://localhost/</loc>");
    expect(xml).toContain("<loc>http://localhost/about</loc>");
    expect(xml).toContain("<loc>http://localhost/blogs</loc>");
    // The dynamic [slug] route itself can't be enumerated from the tree.
    expect(xml).not.toContain("[slug]");
  });

  it("includes a published entry of a seo+slug-enabled collection with seoUrlPattern set, substituting {slug}", async () => {
    const schema = createContentEngineAdapter(content);
    const entries = createContentEntryEngineAdapter(content);
    await ensureSeoNoIndexField(schema);
    const story: ContentTypeDefinition = {
      id: "test-story",
      kind: "collection",
      name: "story",
      label: "Story",
      features: { slug: true, seo: true },
      seoUrlPattern: "/stories/{slug}",
      fields: [],
      version: 0,
    };
    await schema.applySave(story, await schema.planSave(story));
    const allTypes = await schema.listContentTypes();
    const storyType = allTypes.find((t) => t.id === "test-story")!;
    await entries.createEntry(storyType, allTypes, { title: "My Story", slug: "my-story" });

    const response = await buildSitemapResponse(new URL("http://localhost/sitemap.xml"), routeContext);
    const xml = await response.text();
    expect(xml).toContain("<loc>http://localhost/stories/my-story</loc>");
  });

  it("excludes an entry whose own seo.noIndex is true", async () => {
    const schema = createContentEngineAdapter(content);
    const entries = createContentEntryEngineAdapter(content);
    const allTypes = await schema.listContentTypes();
    const storyType = allTypes.find((t) => t.id === "test-story")!;
    await entries.createEntry(storyType, allTypes, { title: "Hidden", slug: "hidden-story", seo: { noIndex: true } });

    const response = await buildSitemapResponse(new URL("http://localhost/sitemap.xml"), routeContext);
    const xml = await response.text();
    expect(xml).toContain("my-story");
    expect(xml).not.toContain("hidden-story");
  });

  // The site-wide `noIndex` gate (empty urlset when the SEO Defaults
  // singleton itself is set to noIndex) is covered in
  // `sitemap-site-noindex.test.ts` instead of here, via a mocked
  // `loadSeoDefaults` - see that file's own doc comment for why: this file's
  // shared `seo` component only picks up the real `dry.seed.json`'s stale
  // (pre-`noIndex`) shape (`ensureSeoNoIndexField` above works around that
  // for a COLLECTION entry field by resaving the component directly, but
  // `migration.ts`'s `SavePlan.cascaded` - "dependents" of a saved component
  // - only tracks a type that references the component through an explicit
  // `fields[]` entry; `features.seo`'s embed is synthetic (added by
  // `system-fields.ts`'s `systemFieldsFor` at resolve time, never stored in
  // `fields[]`), so `seoDefaults` is invisible to that cascade and its table
  // never picks up the new column this way).
});
