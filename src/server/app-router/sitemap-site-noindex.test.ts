import { afterAll, describe, expect, it, vi } from "vitest";

const tempDirBox = vi.hoisted(() => ({ path: "" }));

vi.mock("../config.js", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  tempDirBox.path = mkdtempSync(join(tmpdir(), "drycms-sitemap-noindex-test-"));
  return { path: "/dry", content: { engine: "sqlite", file: join(tempDirBox.path, "content.sqlite") }, pagesSourceStorage: { kind: "local", root: join(tempDirBox.path, "pages-source") } };
});

/**
 * Isolated from `sitemap.test.ts`. Mocking `loadSeoDefaults` sidesteps
 * actually writing a real `seoDefaults` singleton row through the engine
 * adapter (`saveSingletonEntry`, reachable in principle but not otherwise
 * exercised by this suite) and tests exactly what `buildSitemapResponse`
 * itself is responsible for: reacting to whatever `loadSeoDefaults` returns.
 * A real end-to-end check (an actual admin setting the SEO Defaults
 * singleton's "Hide from search engines" toggle, on a real dev server) is
 * the appropriate way to verify the full chain.
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
