import renderToString, { renderToStringAsync } from "preact-render-to-string";
import { runWithDryContext, type DryRequestContext } from "../../content-types/dry-context.js";
import { mergeSeoLayers, type DrySeoValue } from "../../content-types/dry-seo.js";
import { resolveImageSrc } from "../../storage/http-source.js";
import { GLOBALS_CSS_HREF, HYDRATE_ENTRY_HREF } from "./assets.js";
import { encodeCallLog } from "./dry-replay-codec.js";
import type { RouteMatch } from "./match.js";
import { resolveMatchToVNode } from "./resolve-match.js";

export type { PageProps, LayoutProps } from "./render-types.js";

/** `render.ts` owns the outer HTML document - `page.tsx`/`layout.tsx`
 * return inner content only (not `<html>`/`<body>` themselves, unlike real
 * Next.js). The static part of `<head>` (charset/viewport/css/scripts)
 * never depended on `dry()`, but the SEO cascade's `<title>`/meta tags
 * (`plans/reader.md`) now do - `renderPage` below waits for
 * `resolveMatchToVNode` to resolve before enqueuing ANY of `<head>`, not
 * just the SEO tags, since it's one document prefix. This used to be
 * enqueued immediately (see `render.test.ts`'s git history) - that no
 * longer costs anything real: `resolveMatchToVNode` already has to finish
 * before `renderToStringAsync` can run, so this only moves 1 enqueue call
 * later, not a full response buffer.
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
const DOC_HEAD_PREFIX =
  '<!DOCTYPE html><html><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">' +
  `<link rel="stylesheet" href="${GLOBALS_CSS_HREF}">` +
  (import.meta.env.DEV ? '<script type="module" src="/@vite/client"></script>' : "") +
  `<script type="module" src="${HYDRATE_ENTRY_HREF}"></script>`;
const DOC_BODY_OPEN = "</head><body>";
const BODY_AND_HTML_CLOSE = "</body></html>";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, "&quot;");
}

/** Turns the SEO cascade's final merged value (`dry-seo.ts`'s
 * `mergeSeoLayers`, already Default < Singleton < Entry priority applied)
 * into real `<head>` tags. A field unset at every layer emits nothing - a
 * page with no SEO configured anywhere renders exactly like before this
 * feature existed (no `<title>` tag at all). `image` goes through
 * `resolveImageSrc` (`storage/http-source.ts`) for the same stored-id vs.
 * raw-URL resolution any other `image` field's `<img src>` already gets. */
function buildSeoTags(seo: DrySeoValue): string {
  let html = "";
  if (seo.metaTitle) {
    html += `<title>${escapeHtml(seo.metaTitle)}</title>`;
    html += `<meta property="og:title" content="${escapeAttr(seo.metaTitle)}">`;
  }
  if (seo.description) {
    html += `<meta name="description" content="${escapeAttr(seo.description)}">`;
    html += `<meta property="og:description" content="${escapeAttr(seo.description)}">`;
  }
  if (seo.image) {
    html += `<meta property="og:image" content="${escapeAttr(resolveImageSrc(seo.image))}">`;
  }
  return html;
}

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
 * `async function` component's own promise): the page + layout tree is
 * resolved bottom-up (`resolveMatchToVNode`) first - this is also where
 * every `dry()` call in the render happens, so `dryContext.seo` (the SEO
 * cascade's 3 layers, `dry-seo.ts`) is fully settled the moment this
 * resolves, before `<head>` is built. `<head>` (now including the SEO
 * tags) is enqueued, then the resolved vnode goes through
 * `renderToStringAsync` and is enqueued once ready, followed by the
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
      try {
        const vnode = await runWithDryContext(dryContext, () => resolveMatchToVNode(match));
        const head = DOC_HEAD_PREFIX + buildSeoTags(mergeSeoLayers(dryContext.seo)) + DOC_BODY_OPEN;
        controller.enqueue(encoder.encode(head));
        const bodyHtml = await renderToStringAsync(vnode as never);
        const replayData = `<script type="application/json" id="dry-replay-data">${encodeCallLog(dryContext.callLog ?? [])}</script>`;
        const rest = bodyHtml + replayData + ISODATA_MARKER + BODY_AND_HTML_CLOSE;
        controller.enqueue(encoder.encode(rest));
        controller.close();
        options.onDocumentReady?.(head + rest);
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
