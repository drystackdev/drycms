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
    pagesCacheStorage: { kind: "local", root: join(tempDirBox.path, "pages-cache") },
  };
});

const { GET, POST } = await import("./pages-build.js");
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

function postContext(body: unknown): DryRouteContext {
  const url = new URL("http://localhost/dry/api/pages-build");
  const request = new Request(url, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
  return { params: {}, request, url, env: {}, session: null };
}

function onePage(pathname: string) {
  return {
    pathname,
    html: `<html><body>${pathname}</body></html>`,
    jsAssets: [{ jsPath: `${pathname.replace(/^\//, "") || "index"}.js`, source: "export default function(){}" }],
    buildId: crypto.randomUUID(),
    deps: [],
    inSitemap: true,
  };
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

describe("POST /dry/api/pages-build { pages: [...] } (batch)", () => {
  it("publishes every page in one call and each is readable back individually", async () => {
    const response = await POST(postContext({ pages: [onePage("/batch-a"), onePage("/batch-b"), onePage("/batch-c")] }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { records: { path: string }[]; errors: unknown[] };
    expect(body.errors).toEqual([]);
    expect(body.records.map((r) => r.path).sort()).toEqual(["/batch-a", "/batch-b", "/batch-c"]);

    for (const pathname of ["/batch-a", "/batch-b", "/batch-c"]) {
      const get = await GET(context({ path: pathname }));
      expect(get.status).toBe(200);
      expect(await get.text()).toContain(pathname);
    }
  });

  it("reports a per-page error without failing the pages that ARE valid", async () => {
    const response = await POST(postContext({ pages: [onePage("/batch-ok"), { pathname: "/batch-bad" }] }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { records: { path: string }[]; errors: { pathname: string }[] };
    expect(body.records.map((r) => r.path)).toEqual(["/batch-ok"]);
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0]?.pathname).toBe("/batch-bad");
  });

  it("still accepts the original single-page body shape unchanged", async () => {
    const response = await POST(postContext(onePage("/single-page")));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { record: { path: string } };
    expect(body.record.path).toBe("/single-page");
  });
});
