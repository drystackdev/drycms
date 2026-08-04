import renderToString, { renderToStringAsync } from "preact-render-to-string";
import { runWithDryContext, type DryRequestContext } from "../../content-types/dry-context.js";
import type { RouteMatch } from "./match.js";

/** `render.ts` owns the outer HTML document for Giai đoạn 1 - `page.tsx`/
 * `layout.tsx` return inner content only (not `<html>`/`<body>` themselves,
 * unlike real Next.js) so the head/body-open prefix below can be enqueued
 * before any `dry()` call resolves. No hydrate marker yet - that's the rest
 * of Giai đoạn 2 (`preact-iso/hydrate`). No per-page `<title>`/meta yet
 * either - deferred to Giai đoạn 4 same as `plans/app-router.md` notes.
 *
 * The `<link>` below points at the SOURCE path (`/src/apps/globals.css`) -
 * Vite's dev server compiles+serves real CSS text for a direct `<link>`
 * request like this (same mechanism `index.html` relies on, just not going
 * through `transformIndexHtml` here). Giai đoạn 3 (production build) needs
 * to swap this for the built, hashed asset path once that pipeline exists -
 * not done yet, this only works in dev.
 *
 * `/@vite/client` (dev only) is Vite's own HMR WebSocket client - needed
 * for `hmr-plugin.ts`'s full-reload broadcast to reach this page at all,
 * since nothing else here ever loads client JS yet (no hydrate bundle
 * until later in Giai đoạn 2). Never included in production (no dev
 * server there to connect to). */
const HEAD_AND_BODY_OPEN =
  '<!DOCTYPE html><html><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">' +
  '<link rel="stylesheet" href="/src/apps/globals.css">' +
  (import.meta.env.DEV ? '<script type="module" src="/@vite/client"></script>' : "") +
  "</head><body>";
const BODY_AND_HTML_CLOSE = "</body></html>";

export interface PageProps {
  params: Record<string, string | string[]>;
}

export interface LayoutProps extends PageProps {
  children?: unknown;
}

export interface RenderPageOptions {
  /** Fires with the FULL document (head+body+tail, same bytes already
   * streamed to the client) once rendering finishes - `page-handler.ts`
   * uses this to populate `pages-cache` without making the client wait on
   * the cache write, and without `render.ts` needing to know caching
   * exists at all. */
  onDocumentReady?: (fullHtml: string) => void;
}

/**
 * Renders 1 matched route to a streamed `Response`. See
 * `plans/app-router.md`'s "Quyết định kiến trúc" #1 for why this isn't
 * `renderToReadableStream` (confirmed, by spike, not to await a plain
 * `async function` component's own promise): the static head/body-open
 * prefix is enqueued immediately since it depends on no `dry()` call, then
 * the page + layout tree is resolved bottom-up (`await` the page first,
 * then `await` each layout wrapping outward) through `renderToStringAsync`
 * and enqueued once ready. This is a real `ReadableStream` body the whole
 * way, so it flows straight through `adapters/node.ts`'s
 * `sendFetchResponse` unchanged.
 */
export function renderPage(
  match: RouteMatch,
  dryContext: DryRequestContext,
  options: RenderPageOptions = {},
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(HEAD_AND_BODY_OPEN));
      try {
        const bodyHtml = await runWithDryContext(dryContext, () => renderMatchToHtml(match));
        const rest = bodyHtml + BODY_AND_HTML_CLOSE;
        controller.enqueue(encoder.encode(rest));
        controller.close();
        options.onDocumentReady?.(HEAD_AND_BODY_OPEN + rest);
      } catch (error) {
        controller.error(error);
      }
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

async function renderMatchToHtml(match: RouteMatch): Promise<string> {
  const props: PageProps = { params: match.params };
  const { default: PageComponent } = await match.page();
  let vnode = await PageComponent(props as never);

  for (const layoutLoader of [...match.layouts].reverse()) {
    const { default: LayoutComponent } = await layoutLoader();
    vnode = await LayoutComponent({ children: vnode, params: match.params } as never);
  }

  return renderToStringAsync(vnode as never);
}

/** Exported for `render.test.ts`/callers that want a synchronous render of
 * an already-resolved vnode without going through the streamed `Response`
 * (e.g. a future static-export path) - re-exported rather than importing
 * `preact-render-to-string` a second time elsewhere. */
export { renderToString, renderToStringAsync };
