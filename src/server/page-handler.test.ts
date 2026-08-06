import { afterAll, describe, expect, it, vi } from "vitest";

const tempDirBox = vi.hoisted(() => ({ path: "" }));

vi.mock("./config.js", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  tempDirBox.path = mkdtempSync(join(tmpdir(), "drycms-page-handler-test-"));
  return { path: "/dry", content: { engine: "sqlite", file: join(tempDirBox.path, "content.sqlite") } };
});

const { path: adminPath } = await import("./config.js");
const { handlePageRequest } = await import("./page-handler.js");
const { createContentEngineAdapter, createContentEntryEngineAdapter } = await import("../content-types/engine/index.js");
const { content } = await import("./config.js");

afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(tempDirBox.path, { recursive: true, force: true });
});

describe("handlePageRequest", () => {
  it("returns null for the admin's own path (exact and nested)", async () => {
    expect(await handlePageRequest(new Request(`http://localhost${adminPath}`))).toBeNull();
    expect(await handlePageRequest(new Request(`http://localhost${adminPath}/dashboard`))).toBeNull();
  });

  it("301s to the redirect's `to` slug when the URL's last segment matches a redirect row's `from` - checked BEFORE routing, so it also catches a still-syntactically-matching dynamic route (e.g. a renamed /blogs/[slug])", async () => {
    const schema = createContentEngineAdapter(content);
    const entries = createContentEntryEngineAdapter(content);
    const allTypes = await schema.listContentTypes();
    const redirectType = allTypes.find((t) => t.name === "redirect")!;
    await entries.createEntry(redirectType, allTypes, { from: "old-post", to: "new-post" });

    const response = await handlePageRequest(new Request("http://localhost/blogs/old-post?ref=x"));
    expect(response).not.toBeNull();
    expect(response!.status).toBe(301);
    expect(response!.headers.get("Location")).toBe("http://localhost/blogs/new-post?ref=x");
  });

  it("renders the pages-root 404.tsx at status 404 when the path matches no route and no redirect applies", async () => {
    // The real `404.tsx`/root `layout.tsx` call the ambient `dry()` global,
    // which only resolves under the real Vite pipeline's `app-router-
    // plugin.ts` transform (not part of `vitest.config.ts`) - expected to
    // throw here and fall back to `500.tsx`'s markup, same as it would for
    // any other render failure. The status code is fixed independently of
    // that (see `render.ts`'s `RenderPageOptions.status` doc comment), so
    // it's still the one thing worth asserting in this environment.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await handlePageRequest(new Request("http://localhost/this-route-does-not-exist-anywhere"));
    expect(response).not.toBeNull();
    expect(response!.status).toBe(404);
    spy.mockRestore();
  });

  it("leaves an ordinary route match at status 200 - a page's own 'not found' state (e.g. an unknown slug) is that page's responsibility, not the router's", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await handlePageRequest(new Request("http://localhost/blogs/some-slug-with-no-redirect"));
    expect(response).not.toBeNull();
    expect(response!.status).toBe(200);
    spy.mockRestore();
  });
});
