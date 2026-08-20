import { h } from "preact";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { DevPagesSource } from "./app-router/route-tree.js";

vi.mock("./pages-source-seed.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./pages-source-seed.js")>();
  return { ...actual, ensurePagesSourceSeeded: vi.fn(actual.ensurePagesSourceSeeded) };
});

const tempDirBox = vi.hoisted(() => ({ path: "" }));

vi.mock("./config.js", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  tempDirBox.path = mkdtempSync(join(tmpdir(), "drycms-page-handler-test-"));
  return {
    path: "/dry",
    lang: "en",
    content: { engine: "sqlite", file: join(tempDirBox.path, "content.sqlite") },
    // `readBuiltPage`/`writeBuiltPage` (mục 12) need this too, unlike the
    // old `PageCacheEnvelope` scheme this replaced - `kind: "local"` under
    // its own subdirectory, same shape `options.ts`'s `resolveStorageOption`
    // produces for a real local dev instance.
    pagesCacheStorage: { kind: "local", root: join(tempDirBox.path, "pages-cache") },
    // `pages-source-seed.ts`'s `ensurePagesSourceSeeded` (called from
    // `handlePageRequest`) no-ops for `kind !== "r2"` - `kind: "local"` here
    // matches every real `bun run dev`/Node instance, which never needs it.
    pagesSourceStorage: { kind: "local", root: join(tempDirBox.path, "pages-source") },
  };
});

const { path: adminPath } = await import("./config.js");
const { handlePageRequest } = await import("./page-handler.js");
const { createContentEngineAdapter, createContentEntryEngineAdapter } = await import("../content-types/engine/index.js");
const { createStorageSchemaDocumentStore } = await import("./schema-document-storage.js");
/** The engine adapters this file builds by hand must read and write the SAME
 * `content/types.json` the route handlers under test do - a default in-memory
 * document would make each side seed its own schema over the other's tables. */
const docStore = () => createStorageSchemaDocumentStore({ env: {} });
const { content } = await import("./config.js");
const { writeBuiltPage, readBuiltPage } = await import("./app-router/built-pages-storage.js");
const { ensurePagesSourceSeeded } = await import("./pages-source-seed.js");

afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(tempDirBox.path, { recursive: true, force: true });
});

/** A minimal in-memory `DevPagesSource` (`route-tree.ts`) for the dev-branch
 * tests below, decoupled from the checkout's live `.dry/pages-source` content.
 * Plain `h()` vnodes, no `dry()` call
 * (this repo's real root `layout.tsx`/`404.tsx` don't call it either - a
 * page/layout module loaded this way never goes through the real Vite
 * pipeline's `app-router-plugin.ts` ambient-global injection, same
 * limitation the module-mocked `config.js` above already accepts). */
function fixtureDevPagesSource(): DevPagesSource {
  // Keyed by storage-root-relative path, so both files sit under the `pages`
  // source root (`source-roots.ts`) - what `discoverRoutes`'s dev branch
  // filters on since the root split.
  const modules: Record<string, () => Promise<{ default: (props: never) => unknown }>> = {
    "pages/layout.tsx": async () => ({ default: (({ children }: { children?: unknown }) => h("div", null, children as never)) as never }),
    "pages/404.tsx": async () => ({ default: (() => h("p", null, "not found")) as never }),
  };
  return {
    async listPaths() {
      return Object.keys(modules);
    },
    async loadModule(relPath) {
      const loader = modules[relPath];
      if (!loader) throw new Error(`[test] no fixture module for "${relPath}"`);
      return loader();
    },
    // Only `sitemap.ts` reads this, and only for a `[param]` page - the
    // fixture tree has none, so nothing here ever calls it.
    async readSource() {
      return "";
    },
    browserUrlFor(relPath) {
      return `/__test-pages-source/${relPath}`;
    },
  };
}

/**
 * `handlePageRequest`'s 3rd `isDev` param exists ONLY for this file - found
 * live writing these tests: Vitest's own `mode` is `"test"`, and Vite
 * defines `DEV` as `mode !== "production"`, so a plain `import.meta.env.DEV`
 * read is `true` under Vitest, same as a real dev server, with NO way to
 * reach mục 12's prod-only branch from that alone (confirmed by first
 * writing these tests against the ambient value, which silently exercised
 * the DEV branch throughout and made "serves a built page" fail with a
 * confusing 404 - the request never even got as far as `readBuiltPage`).
 * A real production build (`entry-node.ts`/`entry-worker.ts`, both built via
 * `vite build --ssr ...`) never has this ambiguity - a build command's
 * `mode` defaults to `"production"` regardless of Vitest - so passing
 * `isDev` explicitly below changes nothing about what ships, only what
 * this file can observe.
 */

describe("handlePageRequest", () => {
  it("returns null for the admin's own path (exact and nested)", async () => {
    expect(await handlePageRequest(new Request(`http://localhost${adminPath}`))).toBeNull();
    expect(await handlePageRequest(new Request(`http://localhost${adminPath}/dashboard`))).toBeNull();
  });

  it("serves the built /500 artifact when production request setup fails", async () => {
    await writeBuiltPage({ env: {} }, "/500", "error-build", "<html><body>built server error</body></html>");
    vi.mocked(ensurePagesSourceSeeded).mockRejectedValueOnce(new Error("boom"));
    const response = await handlePageRequest(new Request("http://localhost/anything"), {}, false);
    expect(response!.status).toBe(500);
    expect(response!.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(await response!.text()).toContain("built server error");
  });

  it("301s to the redirect's `to` slug when the URL's last segment matches a redirect row's `from` - checked BEFORE routing, so it also catches a still-syntactically-matching dynamic route (e.g. a renamed /blogs/[slug]) - true in both prod and dev", async () => {
    const schema = createContentEngineAdapter(content, undefined, docStore());
    const entries = createContentEntryEngineAdapter(content);
    const allTypes = await schema.listContentTypes();
    const redirectType = allTypes.find((t) => t.name === "redirect")!;
    await entries.createEntry(redirectType, allTypes, { from: "old-post", to: "new-post" });

    for (const isDev of [false, true]) {
      const response = await handlePageRequest(new Request("http://localhost/blogs/old-post?ref=x"), {}, isDev);
      expect(response).not.toBeNull();
      expect(response!.status).toBe(301);
      expect(response!.headers.get("Location")).toBe("http://localhost/blogs/new-post?ref=x");
    }
  });

  describe("prod (isDev: false)", () => {
    it("serves a built page's HTML verbatim when one exists at built/live/* (mục 12)", async () => {
      const ctx = { env: {} };
      await writeBuiltPage(ctx, "/promo", "build-1", "<html><body>promo v3</body></html>");

      const response = await handlePageRequest(new Request("http://localhost/promo"), {}, false);
      expect(response).not.toBeNull();
      expect(response!.status).toBe(200);
      expect(response!.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
      expect(await response!.text()).toBe("<html><body>promo v3</body></html>");
    });

    it("serves the built /404 artifact when nothing is built for the requested path", async () => {
      await writeBuiltPage({ env: {} }, "/404", "not-found-build", "<html><body>built not found</body></html>");
      // Neither path has ever been through `writeBuiltPage` above, nor
      // matches a `redirect` row - one is a totally bogus path, the other
      // LOOKS like it could be a dynamic `[slug]` route (it isn't: this
      // fixture has no `blogs/` route at all).
      // Both now take the exact same branch and get the exact same
      // `404.tsx` render - `page-handler.ts` never calls `discoverRoutes()`'s
      // `matchRoute` result to decide this, only `routeTree.notFound` (see
      // its own doc comment on why prod still never runs a MATCHED route's
      // `page.tsx` live).
      for (const path of ["/this-route-does-not-exist-anywhere", "/blogs/some-slug-with-no-redirect"]) {
        const response = await handlePageRequest(new Request(`http://localhost${path}`), {}, false);
        expect(response).not.toBeNull();
        expect(response!.status).toBe(404);
        expect(response!.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
        const html = await response!.text();
        expect(html).toContain("built not found");
        expect(html).not.toContain("hydrate-client.ts");
        expect(html).not.toContain("edit-launcher.ts");
      }
    });

    it("returns error status when /404 or /500 is requested directly", async () => {
      expect((await handlePageRequest(new Request("http://localhost/404"), {}, false))!.status).toBe(404);
      expect((await handlePageRequest(new Request("http://localhost/500"), {}, false))!.status).toBe(500);
    });

  });

  describe("dev (isDev: true) - unchanged from before mục 12", () => {
    it("renders the pages-root 404.tsx live (full SSR) at status 404 for a path with no built page, no route match, and no redirect", async () => {
      // `fixtureDevPagesSource()` supplies the live-source fixture here; the
      // status code is fixed independently of
      // which source rendered the page (see `render.ts`'s
      // `RenderPageOptions.status` doc comment); the hydrate/edit-launcher
      // script tags are what actually distinguish this from prod's bare
      // fallback above, not the exact body markup.
      const response = await handlePageRequest(new Request("http://localhost/this-route-does-not-exist-anywhere"), {}, true, fixtureDevPagesSource());
      expect(response).not.toBeNull();
      expect(response!.status).toBe(404);
      const html = await response!.text();
      expect(html).toContain("hydrate-client.ts");
      expect(html).toContain("edit-launcher.ts");
    });

    it("never even looks at built/live/* - a built page is ignored in favor of a live re-render", async () => {
      const ctx = { env: {} };
      await writeBuiltPage(ctx, "/dev-check", "build-1", "<html><body>STALE BUILT COPY</body></html>");

      const response = await handlePageRequest(new Request("http://localhost/dev-check"), {}, true, fixtureDevPagesSource());
      expect(response).not.toBeNull();
      // Not the built copy's exact bytes - a route miss still 404s via live
      // SSR, same as the test above, proving `readBuiltPage` was never
      // consulted at all on this branch.
      expect(await response!.text()).not.toContain("STALE BUILT COPY");
    });
  });
});
