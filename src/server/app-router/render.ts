import renderToString, { renderToStringAsync } from "preact-render-to-string";
import { runWithDryContext, type DryRequestContext } from "../../content-types/dry-context.js";
import { mergeSeoLayers, type DrySeoLayers } from "../../content-types/dry-seo.js";
import { resolveImageSrc } from "../../storage/http-source.js";
import { path as adminPath, lang as siteLang } from "../config.js";
import { GLOBALS_CSS_HREF, HYDRATE_ENTRY_HREF, VEI_OVERLAY_HREF } from "./assets.js";
import { encodeCallLog } from "./dry-replay-codec.js";
import type { RouteMatch } from "./match.js";
import { resolveMatchToVNode } from "./resolve-match.js";
import type { ModuleLoader } from "./route-tree.js";
import { installVeiMarkerHook } from "./vei-marker-hook.js";

installVeiMarkerHook();

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
// `lang` is a resolved process-wide constant (`options.ts`'s `resolveOptions`,
// `config.ts`), not per-request - so `<html lang>` bakes into this prefix the
// same way charset/viewport/css do, rather than being threaded through
// `buildSeoTags` alongside the per-request `origin`/`pathname`.
const DOC_HEAD_PREFIX =
  `<!DOCTYPE html><html lang="${siteLang}"><head><meta charset="utf-8">` +
  '<meta name="viewport" content="width=device-width, initial-scale=1">' +
  `<link rel="stylesheet" href="${GLOBALS_CSS_HREF}">` +
  (import.meta.env.DEV ? '<script type="module" src="/@vite/client"></script>' : "") +
  `<script type="module" src="${HYDRATE_ENTRY_HREF}"></script>` +
  `<script type="module" src="${VEI_OVERLAY_HREF}"></script>`;
const DOC_BODY_OPEN = "</head><body>";
const BODY_AND_HTML_CLOSE = "</body></html>";

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, "&quot;");
}

/** `resolveImageSrc` (`storage/http-source.ts`) returns either an already-
 * absolute `http(s)://` URL or a root-relative path (`/api/storage/...` or a
 * raw value that already started with `/`) - Open Graph/Twitter/JSON-LD
 * image URLs must be absolute per spec, so a relative result gets `origin`
 * prefixed here. `origin` itself can be `""` (no request context, e.g. a
 * unit test) - in that case this deliberately still returns the bare
 * relative path rather than fabricating a fake origin. */
function absoluteUrl(origin: string, urlOrPath: string): string {
  return /^https?:\/\//i.test(urlOrPath) ? urlOrPath : `${origin}${urlOrPath}`;
}

/** Turns the SEO cascade's final merged value (`dry-seo.ts`'s
 * `mergeSeoLayers`, already Default < Singleton < Entry < Page priority
 * applied) into real `<head>` tags: `<title>`/description/Open Graph/
 * Twitter Card (as before), plus canonical, `robots`, and `og:url`/
 * `og:type`/`og:site_name`. A field unset at every layer emits nothing - a
 * page with no SEO configured anywhere renders exactly like before this
 * feature existed (no `<title>` tag at all). `image` goes through
 * `resolveImageSrc` (`storage/http-source.ts`) for the same stored-id vs.
 * raw-URL resolution any other `image` field's `<img src>` already gets,
 * then `absoluteUrl` above for Open Graph/Twitter's absolute-URL
 * requirement. `origin`/`pathname` are this request's own
 * (`dryContext.origin`/`.pathname`, seeded by `page-handler.ts` via
 * `site-origin.ts`'s `resolveSiteOrigin`) - canonical/`og:url` are only
 * emitted when both are present, same "unset emits nothing" convention as
 * every other tag here (a unit test with no real request context just gets
 * `""` for both and skips them, rather than emitting a broken empty href). */
function buildSeoTags(layers: DrySeoLayers, origin: string, pathname: string): string {
  const seo = mergeSeoLayers(layers);
  let html = "";
  if (seo.metaTitle) {
    html += `<title>${escapeHtml(seo.metaTitle)}</title>`;
    html += `<meta property="og:title" content="${escapeAttr(seo.metaTitle)}">`;
    html += `<meta name="twitter:title" content="${escapeAttr(seo.metaTitle)}">`;
  }
  if (seo.description) {
    html += `<meta name="description" content="${escapeAttr(seo.description)}">`;
    html += `<meta property="og:description" content="${escapeAttr(seo.description)}">`;
    html += `<meta name="twitter:description" content="${escapeAttr(seo.description)}">`;
  }
  if (seo.image) {
    const absoluteImage = absoluteUrl(origin, resolveImageSrc(seo.image));
    html += `<meta property="og:image" content="${escapeAttr(absoluteImage)}">`;
    html += `<meta name="twitter:image" content="${escapeAttr(absoluteImage)}">`;
  }
  if (seo.noIndex === true) {
    html += '<meta name="robots" content="noindex">';
  }
  if (origin && pathname) {
    const canonical = `${origin}${pathname}`;
    html += `<link rel="canonical" href="${escapeAttr(canonical)}">`;
    html += `<meta property="og:url" content="${escapeAttr(canonical)}">`;
  }
  // `og:type`/`twitter:card`/`og:site_name` describe THIS page as a social
  // object - skipped entirely on a page with no SEO data at all (nothing
  // above set `seo.metaTitle`/`description`/`image`), same as everything
  // else in this function.
  if (seo.metaTitle || seo.description || seo.image) {
    html += `<meta property="og:type" content="${layers.entry ? "article" : "website"}">`;
    html += `<meta name="twitter:card" content="${seo.image ? "summary_large_image" : "summary"}">`;
    // Reuses the SEO Defaults singleton's own Title field as the site name
    // (`layers.default.metaTitle`) rather than adding a dedicated "site
    // name" field - see `status/seo-standard.md`.
    if (layers.default?.metaTitle) {
      html += `<meta property="og:site_name" content="${escapeAttr(layers.default.metaTitle)}">`;
    }
  }
  return html;
}

/** JSON-LD structured data: a `WebSite`/`Organization` pair whenever there's
 * a real site origin to anchor them to (from `layers.default`, the SEO
 * Defaults singleton - reusing `metaTitle`/`image` as `name`/`logo` rather
 * than adding dedicated fields), plus an `Article` object when this render's
 * `entry` tier is set (i.e. the page is a seo-enabled collection entry) -
 * `headline`/`description`/`image` off the same merged `seo`, `datePublished`/
 * `dateModified` off `entryDates` (`dry-context.ts`'s `seoEntryDates`, only
 * ever populated from a real `features.timestamps` column - never
 * fabricated). Escapes `<` in the serialized JSON so a title/description
 * containing `</script>` can't break out of the tag. */
function buildStructuredData(
  layers: DrySeoLayers,
  origin: string,
  pathname: string,
  entryDates: DryRequestContext["seoEntryDates"],
): string {
  const seo = mergeSeoLayers(layers);
  const graph: Record<string, unknown>[] = [];

  if (origin) {
    const siteName = layers.default?.metaTitle;
    const website: Record<string, unknown> = { "@type": "WebSite", url: origin };
    if (siteName) website.name = siteName;
    graph.push(website);

    const organization: Record<string, unknown> = { "@type": "Organization", url: origin };
    if (siteName) organization.name = siteName;
    if (layers.default?.image) organization.logo = absoluteUrl(origin, resolveImageSrc(layers.default.image));
    graph.push(organization);
  }

  if (layers.entry) {
    const article: Record<string, unknown> = { "@type": "Article" };
    if (seo.metaTitle) article.headline = seo.metaTitle;
    if (seo.description) article.description = seo.description;
    if (seo.image) article.image = absoluteUrl(origin, resolveImageSrc(seo.image));
    if (entryDates?.createdAt) article.datePublished = entryDates.createdAt;
    if (entryDates?.updatedAt) article.dateModified = entryDates.updatedAt;
    if (origin && pathname) article.url = `${origin}${pathname}`;
    // Only a bare `{ "@type": "Article" }` (nothing real to report) is
    // skipped - same "no real data, no tag" rule as everything above.
    if (Object.keys(article).length > 1) graph.push(article);
  }

  if (graph.length === 0) return "";
  const json = JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">${json}</script>`;
}

/** Must be the LAST node inside `<body>` - `preact-iso/hydrate`'s own
 * `parent = isodata.parentNode` convention (see its source), which
 * `hydrate-client.ts` relies on to find its mount root without being told
 * one explicitly. Matches `preact-iso/prerender`'s own precedent exactly
 * (append after the fully rendered content, not before). */
const ISODATA_MARKER = '<script type="isodata"></script>';

/**
 * What `apps/vei/overlay.ts` needs before it can decide anything: the admin
 * base path (the site bundle has no other source for it) and whether THIS
 * render carries edit markers. Emitted on every page, including cached and
 * anonymous ones - it names no user and grants nothing, and leaving it out
 * of the cached variant would mean the overlay could never offer its button
 * to a signed-in admin browsing normally. `path` is a config value matching
 * `/^\/[a-z0-9/-]*$/` (`options.ts`), so it needs no escaping here.
 */
function veiConfigScript(editMode: boolean): string {
  return `<script type="application/json" id="dry-vei-config">{"path":${JSON.stringify(adminPath)},"edit":${editMode}}</script>`;
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
  let headSent = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const vnode = await runWithDryContext(dryContext, () => resolveMatchToVNode(match));
        const seoLayers = dryContext.seo ?? {};
        const origin = dryContext.origin ?? "";
        const pathname = dryContext.pathname ?? "";
        const head =
          DOC_HEAD_PREFIX +
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
        const rest = bodyHtml + replayData + veiConfigScript(dryContext.vei !== undefined) + ISODATA_MARKER + BODY_AND_HTML_CLOSE;
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
