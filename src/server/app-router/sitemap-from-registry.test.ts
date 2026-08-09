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

const { buildSitemapResponseFromRegistry } = await import("./sitemap.js");
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
      { path: "/about", objectKey: "k1", buildId: "b1", builtAt: Date.parse("2026-01-01T00:00:00.000Z"), inSitemap: true },
      [],
    );
    await registry.recordBuild(
      { path: "/hidden", objectKey: "k2", buildId: "b1", builtAt: Date.now(), inSitemap: false },
      [],
    );

    const response = await buildSitemapResponseFromRegistry(new URL("http://localhost/sitemap.xml"), routeContext);
    const xml = await response.text();
    expect(xml).toContain("<loc>http://localhost/about</loc><lastmod>2026-01-01T00:00:00.000Z</lastmod>");
    expect(xml).not.toContain("/hidden");
  });
});
