import { h } from "preact";
import { describe, expect, it } from "vitest";
import type { DryRequestContext } from "../../content-types/dry-context.js";
import type { RouteMatch } from "./match.js";
import { renderPage } from "./render.js";

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
});
