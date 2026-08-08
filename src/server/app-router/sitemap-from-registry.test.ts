import { mkdtempSync, rmSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";

const tempDirBox = vi.hoisted(() => ({ path: "" }));

vi.mock("../config.js", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  tempDirBox.path = mkdtempSync(join(tmpdir(), "drycms-sitemap-registry-test-"));
  return { path: "/dry", content: { engine: "sqlite", file: join(tempDirBox.path, "content.sqlite") } };
});

const { buildSitemapResponseFromRegistry, sitemapEdgeCacheTtlSeconds } = await import("./sitemap.js");
const { createPagesRegistryAdapter } = await import("../../content-types/engine/index.js");
const { content } = await import("../config.js");

afterAll(async () => {
  await rm(tempDirBox.path, { recursive: true, force: true });
});

const routeContext = { request: new Request("http://localhost/sitemap.xml"), url: new URL("http://localhost/sitemap.xml"), params: {}, env: {}, session: null } as never;

describe("buildSitemapResponseFromRegistry", () => {
  it("lists every in-sitemap, already-live page from _pages, with a real <lastmod>", async () => {
    const registry = createPagesRegistryAdapter(content);
    await registry.recordBuild(
      { path: "/about", objectKey: "k1", buildId: "b1", builtAt: Date.parse("2026-01-01T00:00:00.000Z"), inSitemap: true, publishAt: null },
      [],
    );
    await registry.recordBuild(
      { path: "/hidden", objectKey: "k2", buildId: "b1", builtAt: Date.now(), inSitemap: false, publishAt: null },
      [],
    );
    await registry.recordBuild(
      { path: "/scheduled", objectKey: "k3", buildId: "b1", builtAt: Date.now(), inSitemap: true, publishAt: Date.now() + 1_000_000 },
      [],
    );

    const response = await buildSitemapResponseFromRegistry(new URL("http://localhost/sitemap.xml"), routeContext);
    const xml = await response.text();
    expect(xml).toContain("<loc>http://localhost/about</loc><lastmod>2026-01-01T00:00:00.000Z</lastmod>");
    expect(xml).not.toContain("/hidden");
    expect(xml).not.toContain("/scheduled");
  });
});

describe("sitemapEdgeCacheTtlSeconds", () => {
  it("defaults to 24h when nothing is scheduled to publish", async () => {
    // A fresh, throwaway registry - NOT the shared file-level `content`
    // temp DB above, which already has a `/scheduled` row by the time this
    // runs (both describe blocks share one temp DB/file in this test file),
    // making "nothing scheduled" untrue there.
    const dir = mkdtempSync(join(tmpdir(), "drycms-sitemap-ttl-test-"));
    const registry = createPagesRegistryAdapter({ engine: "sqlite", file: join(dir, "content.sqlite") });
    await registry.recordBuild({ path: "/a", objectKey: "k", buildId: "b", builtAt: Date.now(), inSitemap: true, publishAt: null }, []);
    expect(await sitemapEdgeCacheTtlSeconds(registry, Date.now())).toBe(86_400);
    rmSync(dir, { recursive: true, force: true });
  });

  it("caps below 24h when a page is scheduled to publish sooner (a row already exists from the describe block above)", async () => {
    const registry = createPagesRegistryAdapter(content);
    const ttl = await sitemapEdgeCacheTtlSeconds(registry, Date.now());
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThan(86_400);
  });
});
