import { h } from "preact";
import { describe, expect, it } from "vitest";
import renderToStringAsync from "preact-render-to-string";
import { renderToReadableStream } from "preact-render-to-string/stream";

/**
 * Documents the Giai đoạn 1 spike result from `plans/app-router.md`'s
 * "Quyết định kiến trúc" #1: `renderToReadableStream` does NOT await a
 * plain `async function` component's own promise (it only supports
 * Suspense-style thrown promises, like `preact-iso/lazy`) - it silently
 * renders empty output instead, because the returned Promise has a
 * `.constructor` and gets treated as an opaque, unrenderable object. This
 * is why `render.ts` resolves the page/layout tree bottom-up itself and
 * uses `renderToStringAsync` for the body instead of streaming the whole
 * tree through `renderToReadableStream`. Kept as a real (not skipped) test
 * so a future `preact-render-to-string` upgrade that changes this behavior
 * gets caught here, prompting a reconsideration of `render.ts`'s approach.
 */
async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

describe("renderToReadableStream + async function component (confirmed limitation)", () => {
  it("does NOT await an async component's own promise - renders empty", async () => {
    async function Async() {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return h("div", null, "resolved");
    }
    const stream = renderToReadableStream(h(Async, null));
    await stream.allReady;
    const html = await readAll(renderToReadableStream(h(Async, null)));
    expect(html).toBe("");
  });
});

describe("renderToStringAsync + bottom-up tree resolution (render.ts's actual approach)", () => {
  it("renders a page wrapped by an async layout when resolved bottom-up", async () => {
    async function Layout({ children }: { children?: unknown }) {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return h("section", { class: "layout" }, children as never);
    }
    async function Page() {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return h("article", null, "page-content");
    }
    const pageVnode = await Page();
    const layoutVnode = await Layout({ children: pageVnode });
    const html = await renderToStringAsync(layoutVnode);
    expect(html).toBe('<section class="layout"><article>page-content</article></section>');
  });
});
