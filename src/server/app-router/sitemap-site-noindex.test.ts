import { afterAll, describe, expect, it, vi } from "vitest";

const tempDirBox = vi.hoisted(() => ({ path: "" }));

vi.mock("../config.js", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  tempDirBox.path = mkdtempSync(join(tmpdir(), "drycms-sitemap-noindex-test-"));
  return { path: "/dry", content: { engine: "sqlite", file: join(tempDirBox.path, "content.sqlite") } };
});

/**
 * Isolated from `sitemap.test.ts`: this repo's own `dry.seed.json` (an
 * app-specific packaged seed, see `seed.ts`'s
 * `resolveDefaultContentTypeDefinitions`) freezes the shared `seo`
 * component's shape from whenever it was last snapshotted (pre-`noIndex`,
 * on this branch), and `migration.ts`'s `SavePlan.cascaded` doesn't reach a
 * `features.seo`-driven dependent like the built-in `seoDefaults` singleton
 * (that embed is synthetic - added by `system-fields.ts`'s `systemFieldsFor`
 * at resolve time, never a real `fields[]` entry `findDependents` can see) -
 * so there's no way to get a real `seoDefaults` row carrying `noIndex`
 * through the public engine adapter API in this test environment. Mocking
 * `loadSeoDefaults` sidesteps that entirely and tests exactly what
 * `buildSitemapResponse` itself is responsible for: reacting to whatever
 * `loadSeoDefaults` returns. A real end-to-end check (an actual admin
 * setting the SEO Defaults singleton's "Hide from search engines" toggle,
 * on a real dev server) is the appropriate way to verify the full chain,
 * not something a fresh-per-test sqlite file in this repo can do today.
 */
vi.mock("../../content-types/dry-seo.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../content-types/dry-seo.js")>();
  return { ...actual, loadSeoDefaults: async () => ({ noIndex: true }) };
});

const { buildSitemapResponse } = await import("./sitemap.js");

afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(tempDirBox.path, { recursive: true, force: true });
});

describe("buildSitemapResponse", () => {
  it("returns an empty (but valid) urlset when loadSeoDefaults reports the site-wide default as noIndex - even though the real route tree has static pages that would otherwise appear", async () => {
    const routeContext = {
      request: new Request("http://localhost/sitemap.xml"),
      url: new URL("http://localhost/sitemap.xml"),
      params: {},
      env: {},
      session: null,
    } as never;
    const response = await buildSitemapResponse(new URL("http://localhost/sitemap.xml"), routeContext);
    const xml = await response.text();
    expect(xml).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>',
    );
  });
});
