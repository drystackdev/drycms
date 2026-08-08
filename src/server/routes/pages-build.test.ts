import type { DryRouteContext } from "../context.js";
import { afterAll, describe, expect, it, vi } from "vitest";

const tempDirBox = vi.hoisted(() => ({ path: "" }));

vi.mock("../config.js", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  tempDirBox.path = mkdtempSync(join(tmpdir(), "drycms-pages-build-route-"));
  return {
    content: { engine: "sqlite", file: join(tempDirBox.path, "content.sqlite") },
  };
});

const { GET } = await import("./pages-build.js");
const { createPagesRegistryAdapter } = await import("../../content-types/engine/index.js");
const { content } = await import("../config.js");

afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(tempDirBox.path, { recursive: true, force: true });
});

function context(query: Record<string, string> = {}): DryRouteContext {
  const url = new URL("http://localhost/dry/api/pages-build");
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return { params: {}, request: new Request(url), url, env: {}, session: null };
}

describe("GET /dry/api/pages-build?byResource=", () => {
  it("returns an empty list when nothing depends on the resource", async () => {
    const response = await GET(context({ byResource: "nothing-reads-this" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ paths: [] });
  });

  it("returns every path recorded as depending on the resource", async () => {
    const registry = createPagesRegistryAdapter(content);
    await registry.recordBuild(
      { path: "/blogs/hello-world", objectKey: "pages/x/blogs/hello-world.html", buildId: "x", builtAt: Date.now(), inSitemap: true, publishAt: null },
      [{ resource: "blog", version: 1 }],
    );
    await registry.recordBuild(
      { path: "/", objectKey: "pages/x/index.html", buildId: "x", builtAt: Date.now(), inSitemap: true, publishAt: null },
      [{ resource: "blog", version: 1 }, { resource: "homepage", version: 1 }],
    );
    await registry.recordBuild(
      { path: "/about", objectKey: "pages/x/about.html", buildId: "x", builtAt: Date.now(), inSitemap: true, publishAt: null },
      [{ resource: "aboutPage", version: 1 }],
    );

    const response = await GET(context({ byResource: "blog" }));
    const body = (await response.json()) as { paths: string[] };
    expect(new Set(body.paths)).toEqual(new Set(["/blogs/hello-world", "/"]));
  });

  it("unions and deduplicates across a comma-separated resource list", async () => {
    const response = await GET(context({ byResource: "homepage,aboutPage" }));
    const body = (await response.json()) as { paths: string[] };
    expect(new Set(body.paths)).toEqual(new Set(["/", "/about"]));
  });
});
