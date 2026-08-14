import { h } from "preact";
import { describe, expect, it, vi } from "vitest";
import type { DryRequestContext } from "../../content-types/dry-context.js";
import type { RouteMatch } from "./match.js";
import { buildVeiShellDocument, renderErrorHtml, renderPage, spliceVeiScripts } from "./render.js";

/** Never actually read by these tests - nothing here calls `dry()`. */
const fakeDryContext = { entries: {} as never, allTypes: [] } as DryRequestContext;

describe("renderPage", () => {
  it("waits for the page tree to resolve before emitting the head chunk, then streams the body separately", async () => {
    let resolvePage: () => void = () => {};
    const pageGate = new Promise<void>((resolve) => {
      resolvePage = resolve;
    });

    const match: RouteMatch = {
      page: () =>
        Promise.resolve({
          default: (async () => {
            await pageGate;
            return h("article", null, "page-content");
          }) as never,
        }),
      layouts: [],
      params: {},
    };

    const response = renderPage(match, fakeDryContext);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    // Head enqueue is gated behind the SAME promise the page component
    // awaits - proves `resolveMatchToVNode` (where every `dry()` call, and
    // so the SEO cascade, resolves) finishes before ANY byte is sent, not
    // just before the body. 1 `read()` call, raced against a timeout
    // WITHOUT issuing a second `read()` - a second concurrent call would
    // just queue behind the first and silently observe the wrong chunk.
    const headReadPromise = reader.read();
    const raceResult = await Promise.race([
      headReadPromise.then(() => "read"),
      new Promise((resolve) => setTimeout(() => resolve("timeout"), 20)),
    ]);
    expect(raceResult).toBe("timeout");

    resolvePage();
    const first = await headReadPromise;
    expect(first.done).toBe(false);
    const headChunk = decoder.decode(first.value!);
    expect(headChunk).toContain("<!DOCTYPE html>");
    expect(headChunk).toMatch(/<script type="module" src="[^"]*hydrate-client[^"]*"><\/script>/);
    expect(headChunk).not.toContain("page-content");

    const rest = await reader.read();
    const bodyChunk = decoder.decode(rest.value!);
    expect(bodyChunk).toContain("<article>page-content</article>");
    expect(bodyChunk).toContain("</body></html>");
    // The `dry()` replay payload + isodata marker must both land AFTER the
    // rendered content and BEFORE `</body>` - `preact-iso/hydrate` uses
    // the isodata script's `parentNode` as its mount root, so it must be
    // the LAST node in `<body>` (see `render.ts`'s `ISODATA_MARKER` doc).
    expect(bodyChunk).toMatch(
      /<article>page-content<\/article><script type="application\/json" id="dry-replay-data">.*<\/script><script type="isodata"><\/script><\/body><\/html>$/,
    );
  });

  it("emits SEO tags from the merged cascade in the head chunk", async () => {
    const match: RouteMatch = {
      page: () => Promise.resolve({ default: (async () => h("article", null, "content")) as never }),
      layouts: [],
      params: {},
    };
    const dryContext = {
      entries: {} as never,
      allTypes: [],
      seo: {
        default: { metaTitle: "Default title", description: "Default description" },
        entry: { metaTitle: "Entry title", image: "hero.jpg" },
      },
    } as DryRequestContext;

    const html = await renderPage(match, dryContext).text();
    // Entry overrides Default for metaTitle; Default's description survives
    // since Entry never set one.
    expect(html).toContain("<title>Entry title</title>");
    expect(html).toContain('<meta property="og:title" content="Entry title">');
    expect(html).toContain('<meta name="description" content="Default description">');
    expect(html).toContain('<meta property="og:image" content="');
  });

  it("omits SEO tags entirely when no layer sets anything", async () => {
    const match: RouteMatch = {
      page: () => Promise.resolve({ default: (async () => h("article", null, "content")) as never }),
      layouts: [],
      params: {},
    };
    const html = await renderPage(match, fakeDryContext).text();
    expect(html).not.toContain("<title>");
    expect(html).not.toContain('meta name="description"');
  });

  it("wraps the page with layouts root-to-leaf and threads params as a prop (not a global)", async () => {
    const match: RouteMatch = {
      page: () =>
        Promise.resolve({
          default: (async ({ params }: { params: Record<string, string> }) =>
            h("article", null, `slug:${params.slug}`)) as never,
        }),
      layouts: [
        () =>
          Promise.resolve({
            default: (async ({ children }: { children: unknown }) =>
              h("section", { class: "root" }, children as never)) as never,
          }),
        () =>
          Promise.resolve({
            default: (async ({ children }: { children: unknown }) =>
              h("section", { class: "blog" }, children as never)) as never,
          }),
      ],
      params: { slug: "hello" },
    };

    const response = renderPage(match, fakeDryContext);
    const html = await response.text();
    expect(html).toContain(
      '<section class="root"><section class="blog"><article>slug:hello</article></section></section>',
    );
  });

  it("uses options.status for the response - e.g. 404 when rendering the notFound fallback", async () => {
    const match: RouteMatch = {
      page: () => Promise.resolve({ default: (async () => h("p", null, "not found")) as never }),
      layouts: [],
      params: {},
    };
    const response = renderPage(match, fakeDryContext, { status: 404 });
    expect(response.status).toBe(404);
    expect(await response.text()).toContain("not found");
  });

  it("defaults to status 200 when options.status is omitted", async () => {
    const match: RouteMatch = {
      page: () => Promise.resolve({ default: (async () => h("p", null, "ok")) as never }),
      layouts: [],
      params: {},
    };
    expect(renderPage(match, fakeDryContext).status).toBe(200);
  });

  it("falls back to onRenderError's markup when resolving the match throws before <head> is sent, but keeps the response's original status", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const match: RouteMatch = {
      page: () =>
        Promise.resolve({
          default: (async () => {
            throw new Error("boom");
          }) as never,
        }),
      layouts: [],
      params: {},
    };
    const response = renderPage(match, fakeDryContext, {
      onRenderError: async () => "<!DOCTYPE html><html><body>fallback page</body></html>",
    });
    expect(response.status).toBe(200); // fixed at construction, before the failure was even known
    expect(await response.text()).toBe("<!DOCTYPE html><html><body>fallback page</body></html>");
    spy.mockRestore();
  });

  it("errors the stream (no clean recovery) when onRenderError is absent", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const match: RouteMatch = {
      page: () =>
        Promise.resolve({
          default: (async () => {
            throw new Error("boom");
          }) as never,
        }),
      layouts: [],
      params: {},
    };
    await expect(renderPage(match, fakeDryContext).text()).rejects.toThrow();
    spy.mockRestore();
  });
});

describe("spliceVeiScripts", () => {
  it("flips a real build's inert edit:false config to edit:true and appends the live-render script before </body></html>", async () => {
    const built = await renderPage(
      { page: () => Promise.resolve({ default: (async () => h("article", null, "content")) as never }), layouts: [], params: {} },
      fakeDryContext,
    ).text();
    expect(built).toContain('"edit":false');

    const spliced = spliceVeiScripts(built);
    expect(spliced).not.toContain('"edit":false');
    expect(spliced).toContain('"edit":true');
    expect(spliced).toContain("<article>content</article>");
    expect(spliced).toMatch(/<script type="module" src="[^"]*vei-live-refresh[^"]*"><\/script><\/body><\/html>$/);
  });

  it("still appends the live-render script before </body></html> even when there's no dry-vei-config to flip (doesn't crash on an unexpected input)", () => {
    const spliced = spliceVeiScripts("<html><body>plain</body></html>");
    expect(spliced).toBe('<html><body>plain<script type="module" src="/src/apps/vei-live-refresh.ts"></script></body></html>');
  });
});

describe("buildVeiShellDocument", () => {
  it("carries the overlay + live-render scripts with edit:true, but no hydrate script and no isodata marker", () => {
    const html = buildVeiShellDocument();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('"edit":true');
    expect(html).toMatch(/<script type="module" src="[^"]*vei\/overlay[^"]*"><\/script>/);
    expect(html).toMatch(/<script type="module" src="[^"]*vei-live-refresh[^"]*"><\/script>/);
    expect(html).not.toContain("hydrate-client");
    expect(html).not.toContain("isodata");
  });
});

describe("renderErrorHtml", () => {
  it("renders a standalone document (CSS link + the component's markup) with no dry() context involved", async () => {
    const html = await renderErrorHtml(() =>
      Promise.resolve({ default: (() => h("p", null, "Something went wrong")) as never }),
    );
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain('<link rel="stylesheet"');
    expect(html).toContain("<p>Something went wrong</p>");
    // None of the normal page machinery - no hydrate script, no replay data, no VEI config.
    expect(html).not.toContain("hydrate-client");
    expect(html).not.toContain("dry-replay-data");
    expect(html).not.toContain("dry-vei-config");
  });
});
