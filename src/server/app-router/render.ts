import renderToString, { renderToStringAsync } from "preact-render-to-string";
import { runWithDryContext, type DryRequestContext } from "../../content-types/dry-context.js";
import { GLOBALS_CSS_HREF, HYDRATE_ENTRY_HREF } from "./assets.js";
import { encodeCallLog } from "./dry-replay-codec.js";
import type { RouteMatch } from "./match.js";
import { resolveMatchToVNode } from "./resolve-match.js";

export type { PageProps, LayoutProps } from "./render-types.js";

/** `render.ts` owns the outer HTML document for Giai đoạn 1 - `page.tsx`/
 * `layout.tsx` return inner content only (not `<html>`/`<body>` themselves,
 * unlike real Next.js) so the head/body-open prefix below can be enqueued
 * before any `dry()` call resolves. No per-page `<title>`/meta yet -
 * deferred to Giai đoạn 4 same as `plans/app-router.md` notes.
 *
 * `GLOBALS_CSS_HREF`/`HYDRATE_ENTRY_HREF` (`./assets.js`) are the SOURCE
 * paths in dev (Vite's dev server compiles+serves them directly) and the
 * built, hashed asset paths in production (Giai đoạn 3, read from the
 * client build's `manifest.json`).
 *
 * `/@vite/client` (dev only) is Vite's own HMR WebSocket client - needed
 * for `app-router-plugin.ts`'s full-reload broadcast to reach this page at
 * all. Never included in production (no dev server there to connect to).
 *
 * `HYDRATE_ENTRY_HREF`'s `<script type="module">` runs in BOTH dev and
 * prod, unlike `/@vite/client` - it's `hydrate-client.ts` (Giai đoạn 2),
 * not a dev-only debugging aid. */
const HEAD_AND_BODY_OPEN =
  '<!DOCTYPE html><html><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">' +
  `<link rel="stylesheet" href="${GLOBALS_CSS_HREF}">` +
  (import.meta.env.DEV ? '<script type="module" src="/@vite/client"></script>' : "") +
  `<script type="module" src="${HYDRATE_ENTRY_HREF}"></script>` +
  "</head><body>";
const BODY_AND_HTML_CLOSE = "</body></html>";
/** Must be the LAST node inside `<body>` - `preact-iso/hydrate`'s own
 * `parent = isodata.parentNode` convention (see its source), which
 * `hydrate-client.ts` relies on to find its mount root without being told
 * one explicitly. Matches `preact-iso/prerender`'s own precedent exactly
 * (append after the fully rendered content, not before). */
const ISODATA_MARKER = '<script type="isodata"></script>';

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
 * the page + layout tree is resolved bottom-up (`resolveMatchToVNode`)
 * through `renderToStringAsync` and enqueued once ready, followed by the
 * embedded `dry()` replay log (`dry-replay-codec.ts`) `hydrate-client.ts`
 * needs to reconstruct the same tree client-side, then the isodata marker.
 * This is a real `ReadableStream` body the whole way, so it flows straight
 * through `adapters/node.ts`'s `sendFetchResponse` unchanged.
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
        const vnode = await runWithDryContext(dryContext, () => resolveMatchToVNode(match));
        const bodyHtml = await renderToStringAsync(vnode as never);
        const replayData = `<script type="application/json" id="dry-replay-data">${encodeCallLog(dryContext.callLog ?? [])}</script>`;
        const rest = bodyHtml + replayData + ISODATA_MARKER + BODY_AND_HTML_CLOSE;
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

/** Exported for `render.test.ts`/callers that want a synchronous render of
 * an already-resolved vnode without going through the streamed `Response`
 * (e.g. a future static-export path) - re-exported rather than importing
 * `preact-render-to-string` a second time elsewhere. */
export { renderToString, renderToStringAsync };
