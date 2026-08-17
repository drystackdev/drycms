import renderToString, { renderToStringAsync } from "preact-render-to-string";
import { runWithDryContext, type DryRequestContext } from "../../content-types/dry-context.js";
import { path as adminPath, lang as siteLang } from "../config.js";
import {
  BODY_AND_HTML_CLOSE,
  DOC_BODY_OPEN,
  ISODATA_MARKER,
  buildHeadPrefix,
  buildSeoTags,
  buildStructuredData,
  editConfigScript,
} from "./build-document.js";
import { GLOBALS_CSS_HREF, HYDRATE_ENTRY_HREF, EDIT_LAUNCHER_HREF } from "./assets.js";
import { encodeCallLog } from "./dry-replay-codec.js";
import type { RouteMatch } from "./match.js";
import { resolveMatchToVNode } from "./resolve-match.js";
import type { ModuleLoader } from "./route-tree.js";

export type { PageProps, LayoutProps } from "./render-types.js";

/** `render.ts` owns the outer HTML document - `page.tsx`/`layout.tsx`
 * return inner content only (not `<html>`/`<body>` themselves, unlike real
 * Next.js). The static part of `<head>` (charset/viewport/css/scripts,
 * `build-document.ts`'s `buildHeadPrefix`) never depended on `dry()`, but
 * the SEO cascade's `<title>`/meta tags (`plans/reader.md`) now do -
 * `renderPage` below waits for `resolveMatchToVNode` to resolve before
 * enqueuing ANY of `<head>`, not just the SEO tags, since it's one document
 * prefix. This used to be enqueued immediately (see `render.test.ts`'s git
 * history) - that no longer costs anything real: `resolveMatchToVNode`
 * already has to finish before `renderToStringAsync` can run, so this only
 * moves 1 enqueue call later, not a full response buffer.
 *
 * The document-assembly pieces this file used to define inline now live in
 * `build-document.ts` (`plans/app-r2.md` mục 2) - extracted so the browser
 * build pipeline can share them without pulling in `config.ts`
 * (`node:fs`/`node:path` via `options.ts`) or `dry-context.ts`'s
 * `AsyncLocalStorage` VALUE import, neither of which is portable to a real
 * browser tab (confirmed by the app-r2 spike). `renderPage` itself keeps
 * its own streaming shape unchanged - head-first TTFB matters for a live
 * SSR response, which is exactly what `buildDocument` (the non-streaming
 * sibling in that file) doesn't provide.
 */
export function renderPage(
  match: RouteMatch,
  dryContext: DryRequestContext,
  options: RenderPageOptions = {},
): Response {
  const encoder = new TextEncoder();
  let headSent = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const vnode = await runWithDryContext(dryContext, () => resolveMatchToVNode(match));
        const seoLayers = dryContext.seo ?? {};
        const origin = dryContext.origin ?? "";
        const pathname = dryContext.pathname ?? "";
        const head =
          buildHeadPrefix(adminPath, siteLang, { globalsCssHref: GLOBALS_CSS_HREF, hydrateEntryHref: HYDRATE_ENTRY_HREF, editLauncherHref: EDIT_LAUNCHER_HREF }) +
          buildSeoTags(seoLayers, origin, pathname) +
          buildStructuredData(seoLayers, origin, pathname, dryContext.seoEntryDates) +
          DOC_BODY_OPEN;
        controller.enqueue(encoder.encode(head));
        headSent = true;
        // Inside the context too, not just `resolveMatchToVNode`: nested
        // components render HERE, and a `dry()` call from one of them would
        // otherwise land outside the request it belongs to.
        const bodyHtml = await runWithDryContext(dryContext, () => renderToStringAsync(vnode as never));
        const replayData = `<script type="application/json" id="dry-replay-data">${encodeCallLog(dryContext.callLog ?? [])}</script>`;
        const devManifest = options.devHydrateManifest
          ? `<script type="application/json" id="dry-dev-hydrate-manifest">${JSON.stringify(options.devHydrateManifest).replace(/</g, "\\u003c")}</script>`
          : "";
        const rest = bodyHtml + replayData + devManifest + editConfigScript(adminPath) + ISODATA_MARKER + BODY_AND_HTML_CLOSE;
        controller.enqueue(encoder.encode(rest));
        controller.close();
        options.onDocumentReady?.(head + rest);
      } catch (error) {
        console.error("[drycms] page render failed:", error);
        if (!headSent && options.onRenderError) {
          try {
            controller.enqueue(encoder.encode(await options.onRenderError(error)));
            controller.close();
            return;
          } catch {
            // Fall through - the fallback itself failed, nothing left to do
            // but error the stream below.
          }
        }
        controller.error(error);
      }
    },
  });
  return new Response(stream, {
    status: options.status ?? 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export interface RenderPageOptions {
  /** Fires with the FULL document (head+body+tail, same bytes already
   * streamed to the client) once rendering finishes - `page-handler.ts`
   * uses this to populate `pages-cache` without making the client wait on
   * the cache write, and without `render.ts` needing to know caching
   * exists at all. */
  onDocumentReady?: (fullHtml: string) => void;
  /** HTTP status for the response `renderPage` returns - e.g. `404` when
   * `page-handler.ts` renders the `404.tsx` fallback through this same
   * pipeline for a route miss. Fixed at the synchronous `new Response(...)`
   * call below, same as `headers` - unrelated to `onRenderError`, whose
   * fallback (see its own doc comment) can never change this. @default 200 */
  status?: number;
  /**
   * Renders a fallback document when resolving/rendering `match` throws -
   * `page-handler.ts` passes one that renders `500.tsx`. Only takes effect
   * if the failure happens before `<head>` has been enqueued: this
   * function already returned a `Response` with `status`/200 baked in
   * before any of this runs, so a fallback can still deliver a real error
   * page's MARKUP into the body, but can never correct the status code -
   * the same limitation every streaming-SSR framework has once bytes are in
   * flight. Once `<head>` IS already out, there's no clean recovery left at
   * all (real content bytes already sent) - the stream errors exactly as it
   * did before this option existed. Absent, or itself throwing, is the same
   * "stream errors" fallback too. */
  onRenderError?: (error: unknown) => Promise<string>;
  /** Dev-only, from `page-handler.ts`'s `devPagesSource` branch (see
   * `route-tree.ts`'s `DevPagesSource` doc comment) - `hydrate-client.ts`
   * `import()`s these already-resolved URLs directly. Absent for production,
   * which hydrates browser-built assets instead. */
  devHydrateManifest?: { entryUrl: string; layoutUrls: string[]; params: Record<string, string | string[]> };
}

/**
 * A minimal, standalone HTML document for `loader` (typically the
 * `500.tsx`/`404.tsx` fallback) - no `dry()` context, no hydrate script, no
 * replay log, no VEI config, no layouts, just the site's CSS + a synchronous
 * `renderToString`. Used both as `page-handler.ts`'s `RenderPageOptions.
 * onRenderError` (the mid-stream fallback above) and directly for a failure
 * caught before `renderPage` was ever called (e.g. the content layer itself
 * failing to list its schema) - see that module's own doc comment. Kept
 * maximally independent of the content/DB layer deliberately: it must stay
 * renderable even when that's exactly what's broken.
 */
export async function renderErrorHtml(loader: ModuleLoader): Promise<string> {
  const { default: Component } = await loader();
  const vnode = await Component({ params: {} } as never);
  const body = renderToString(vnode as never);
  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<link rel="stylesheet" href="${GLOBALS_CSS_HREF}"></head><body>${body}</body></html>`
  );
}

/** Exported for `render.test.ts`/callers that want a synchronous render of
 * an already-resolved vnode without going through the streamed `Response`
 * (e.g. a future static-export path) - re-exported rather than importing
 * `preact-render-to-string` a second time elsewhere. */
export { renderToString, renderToStringAsync };

/** Re-exported so an existing `from "./render.js"` import of the
 * document-assembly pieces (if any) keeps working - the real definitions
 * now live in `build-document.ts` (see this file's own doc comment). */
export { buildDocument, type BuildDocumentContext } from "./build-document.js";
