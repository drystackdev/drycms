import { h } from "preact";
import { describe, expect, it } from "vitest";
import type { DryRequestContext } from "../../content-types/dry-context.js";
import type { RouteMatch } from "./match.js";
import { renderPage } from "./render.js";

/** Never actually read by these tests - nothing here calls `dry()`. */
const fakeDryContext = { entries: {} as never, allTypes: [] } as DryRequestContext;

describe("renderPage", () => {
  it("streams the static head/body-open chunk before the page tree resolves", async () => {
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

    const first = await reader.read();
    expect(first.done).toBe(false);
    const headChunk = decoder.decode(first.value!);
    expect(headChunk).toContain("<!DOCTYPE html>");
    expect(headChunk).toMatch(/<script type="module" src="[^"]*hydrate-client[^"]*"><\/script>/);
    expect(headChunk).not.toContain("page-content");

    resolvePage();
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
