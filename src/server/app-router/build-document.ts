import { renderToStringAsync } from "preact-render-to-string";
import type { DryCallLogEntry, DryRequestContext } from "../../content-types/dry-context.js";
import { mergeSeoLayers, type DrySeoLayers } from "../../content-types/dry-seo.js";
import { resolveImageSrc } from "../../storage/http-source.js";
import { encodeCallLog } from "./dry-replay-codec.js";
import { installMediaSrcHook } from "./media-src-hook.js";
import { installVeiMarkerHook } from "./vei-marker-hook.js";

/**
 * `plans/app-r2.md` mục 2 - the "dựng document" half of what used to be one
 * function in `render.ts` (`renderPage`, which still owns the OTHER half:
 * streaming). Deliberately free of any import that isn't browser-portable -
 * no `server/config.ts` (pulls `node:fs`/`node:path` via `options.ts`), no
 * `content-types/dry-context.ts`'s `runWithDryContext`/`AsyncLocalStorage`
 * VALUE import (only its TYPES, erased at compile time - see the import
 * above). Confirmed by the app-r2 spike (`status/app-r2-spike.md`):
 * `resolveMatchToVNode` + `renderToStringAsync` both run fine in a real
 * browser tab; this file adds the document-shell assembly around them
 * without reintroducing anything that doesn't.
 *
 * `GLOBALS_CSS_HREF`/`HYDRATE_ENTRY_HREF`/`EDIT_LAUNCHER_HREF` do NOT come from
 * `./assets.js` here (an earlier version of this file imported them from
 * there, on the assumption that module was safe - WRONG, caught live: that
 * module RE-EXPORTS from `resolve-asset-href.ts`, which imports `node:fs`
 * at module scope; a static `export {...} from` pulls in the whole module
 * graph regardless of which names are actually used, so ANY import from
 * `assets.js` transitively breaks in a real browser build - confirmed via
 * Playwright, `status/app-r2-build.md`). `buildHeadPrefix` takes all 3 as
 * plain arguments instead, same "explicit, not read from ambient state"
 * discipline `BuildDocumentContext.origin`'s own doc comment below already
 * applies to the site origin and to `adminPath`/`siteLang`.
 */

installVeiMarkerHook();
// Also installed client-side proper (`apps/hydrate-client.ts`) - unlike the
// marker hook, whose attributes hydration never rewrites, a `src` that
// isn't resolved on both sides reverts to its raw storage id on any
// re-render. Installing it here too means any caller of `buildDocument`
// (the browser build pipeline included) gets correct `<img src>` output
// without having to know this hook exists.
installMediaSrcHook();

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/"/g, "&quot;");
}

/** See `render.ts`'s original doc comment (moved here verbatim) -
 * `resolveImageSrc` returns either an absolute `http(s)://` URL or a
 * root-relative path; Open Graph/Twitter/JSON-LD image URLs must be
 * absolute per spec, so a relative result gets `origin` prefixed. `origin`
 * can be `""` (e.g. a unit test with no real request context) - in that
 * case this deliberately still returns the bare relative path rather than
 * fabricating a fake origin. */
function absoluteUrl(origin: string, urlOrPath: string): string {
  return /^https?:\/\//i.test(urlOrPath) ? urlOrPath : `${origin}${urlOrPath}`;
}

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
  if (seo.metaTitle || seo.description || seo.image) {
    html += `<meta property="og:type" content="${layers.entry ? "article" : "website"}">`;
    html += `<meta name="twitter:card" content="${seo.image ? "summary_large_image" : "summary"}">`;
    if (layers.default?.metaTitle) {
      html += `<meta property="og:site_name" content="${escapeAttr(layers.default.metaTitle)}">`;
    }
  }
  return html;
}

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
    if (Object.keys(article).length > 1) graph.push(article);
  }

  if (graph.length === 0) return "";
  const json = JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replace(/</g, "\\u003c");
  return `<script type="application/ld+json">${json}</script>`;
}

/** Must be the LAST node inside `<body>` - see `render.ts`'s original doc
 * comment (`preact-iso/hydrate`'s own `parent = isodata.parentNode`
 * convention). */
export const ISODATA_MARKER = '<script type="isodata"></script>';

/** The admin base path, handed to `apps/edit-launcher.ts` - the site bundle
 * has no other way to know it. Deliberately carries nothing session-shaped:
 * built HTML is cached and shared across visitors, so whether the Edit button
 * renders is decided client-side off the `drycms_admin` hint cookie, never
 * baked into the document. */
function editConfigScript(adminPath: string): string {
  return `<script type="application/json" id="dry-edit-config">{"path":${JSON.stringify(adminPath)}}</script>`;
}

export const DOC_BODY_OPEN = "</head><body>";
export const BODY_AND_HTML_CLOSE = "</body></html>";

export interface AssetHrefs {
  globalsCssHref: string;
  /** `""` omits the script tag entirely - see `buildHeadPrefix`'s own use
   * of it below. */
  hydrateEntryHref: string;
  editLauncherHref: string;
}

/** The static, non-SEO part of `<head>` - `adminPath`/`siteLang`/asset hrefs
 * all passed in explicitly rather than imported from `config.ts`/`assets.ts`
 * (see this file's own doc comment for why). Identical bytes to what
 * `render.ts` built inline before this file existed. */
export function buildHeadPrefix(adminPath: string, siteLang: string, assets: AssetHrefs): string {
  const faviconIcoHref = `${adminPath}/api/storage/favicon.ico`;
  const faviconPngHref = `${adminPath}/api/storage/favicon.png`;
  return (
    `<!DOCTYPE html><html lang="${siteLang}"><head><meta charset="utf-8">` +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    `<link rel="icon" href="${faviconIcoHref}">` +
    `<link rel="icon" type="image/png" href="${faviconPngHref}">` +
    // Empty on a CI build with no live pages-source content yet
    // (`resolve-asset-href.ts`'s `resolveGlobalsCssHref` doc comment) -
    // omit the tag rather than emit `<link ... href="">` (which a browser
    // resolves to the CURRENT document URL and tries to parse as CSS).
    (assets.globalsCssHref ? `<link rel="stylesheet" href="${assets.globalsCssHref}">` : "") +
    (import.meta.env.DEV ? '<script type="module" src="/@vite/client"></script>' : "") +
    // `""` omits the tag entirely - a caller that renders a document nothing
    // hydrates has no `<script type="isodata">` marker for `preact-iso` to
    // find either.
    (assets.hydrateEntryHref ? `<script type="module" src="${assets.hydrateEntryHref}"></script>` : "") +
    `<script type="module" src="${assets.editLauncherHref}"></script>`
  );
}

/**
 * Plain data `buildDocument` needs - deliberately NOT `DryRequestContext`
 * (that type carries `entries`/`allTypes`/`touchedTypes`, server/DB-shaped
 * concerns already resolved before this runs). `origin`/`adminPath`/
 * `siteLang` have no fallback the way `render.ts`'s old inline code read
 * them off `config.ts`/`dryContext.origin ?? ""` - every caller must
 * resolve them itself (`render.ts` from `config.ts`/`site-origin.ts`; the
 * browser build orchestrator from wherever the admin configured the site's
 * public origin) - see `plans/app-r2.md` mục 2's "không được lấy
 * `window.location`".
 */
export interface BuildDocumentContext {
  seo?: DrySeoLayers;
  origin: string;
  pathname: string;
  adminPath: string;
  siteLang: string;
  assets: AssetHrefs;
  seoEntryDates?: DryRequestContext["seoEntryDates"];
  callLog?: DryCallLogEntry[];
}

/**
 * Pure, non-streaming document assembly - the exact same bytes
 * `render.ts`'s `renderPage` streams (head + SEO tags + structured data +
 * body + replay log + VEI config + isodata marker), just returned as one
 * string instead of enqueued in two chunks. `renderPage` itself still
 * streams (head-first TTFB matters for a live SSR response; a document
 * assembled in one shot never gets to send bytes early) - it now calls the
 * pieces exported from this file instead of keeping its own copies, so
 * there's exactly one definition of each, but its own streaming shape is
 * unchanged.
 *
 * `vnode` must already be fully resolved (`resolveMatchToVNode`'s result) -
 * this function doesn't call it and doesn't run inside `runWithDryContext`;
 * that's the caller's setup (`dry-reader-http.ts`'s module-level config for
 * the browser build path; `runWithDryContext` for `render.ts`'s server
 * caller, if it's ever switched to call this instead of streaming inline).
 */
export async function buildDocument(vnode: unknown, ctx: BuildDocumentContext): Promise<string> {
  const seoLayers = ctx.seo ?? {};
  const head =
    buildHeadPrefix(ctx.adminPath, ctx.siteLang, ctx.assets) +
    buildSeoTags(seoLayers, ctx.origin, ctx.pathname) +
    buildStructuredData(seoLayers, ctx.origin, ctx.pathname, ctx.seoEntryDates) +
    DOC_BODY_OPEN;
  const bodyHtml = await renderToStringAsync(vnode as never);
  const replayData = `<script type="application/json" id="dry-replay-data">${encodeCallLog(ctx.callLog ?? [])}</script>`;
  return head + bodyHtml + replayData + editConfigScript(ctx.adminPath) + ISODATA_MARKER + BODY_AND_HTML_CLOSE;
}

export { buildSeoTags, buildStructuredData, editConfigScript };
