import { h, Fragment } from "preact";
import * as preactHooks from "preact/hooks";
import { transform, type Options as SucraseOptions } from "sucrase";
import { dry, configureHttpDryReader, type HttpDryReaderConfig, type HttpDryReaderDependency } from "../content-types/dry-reader-http.js";
import { fetchDryHttp } from "../content-types/dry-http-cache.js";
import { params, setCurrentParams } from "../content-types/params-reader-client.js";
import { resetHttpTitle, readHttpTitleLayer, setTitle } from "../content-types/dry-title-http.js";
import { dryBind } from "../content-types/dry-vei.js";
import { mergeSeoLayers, type DrySeoLayers, type DrySeoValue } from "../content-types/dry-seo.js";
import { decodeCallLog } from "../server/app-router/dry-replay-codec.js";
import { resolveMatchToVNode } from "../server/app-router/resolve-match.js";
import { buildDocument } from "../server/app-router/build-document.js";
import type { RouteMatch } from "../server/app-router/match.js";
import type { ContentTypeDefinition } from "../content-types/types.js";
import { compileTailwindCss } from "./tailwind-build.js";
import { buildManifestRouteTree, listDynamicPageTemplates, matchSourceRoute, staticPagePaths } from "../server/app-router/route-manifest.js";
import { COMPONENT_ALIAS, PAGES_ROOT, PAGES_SOURCE_ROOTS, resolveAliasSpecifier } from "../server/app-router/source-roots.js";
import { resolveDynamicPages } from "./dynamic-routes.js";
import { minifyEsmSource } from "./minify-js.js";

/**
 * The browser build orchestrator (`plans/app-r2.md` mục 7's "một nguồn
 * trigger build", built ahead of the UI that will call it - see
 * `status/app-r2-build.md`). Ties together every piece built for this plan:
 * `dry-reader-http.ts` (mục 3), `resolveMatchToVNode`/`buildDocument`
 * (mục 2, confirmed browser-safe by the spike), and an extended eval that
 * allowlists `preact`/`preact/hooks` on top of `sucrase-eval.ts`'s existing
 * "only relative file imports" rule (mục on the spike's unknown #1).
 *
 * NOT wired into `routes/pages-build.ts` automatically and not reachable
 * from any admin UI yet - callers invoke `buildPage`/`publishBuiltPage`
 * directly. Nothing here runs unless something calls it.
 */

export class PageBuildError extends Error {}

// Same bare-specifier rule as `sucrase-eval.ts`'s `resolveModulePath`
// (Component Builder's "only file imports"), extended with exactly the 2
// npm-style packages a real page/layout can legitimately `import` (as
// opposed to `dry`/`params`/`setTitle`/`dryBind`, which arrive as ambient
// globals - see the `new Function` call below, not this allowlist).
const NPM_ALLOWLIST: Record<string, Record<string, unknown>> = {
  preact: { h, Fragment },
  "preact/hooks": preactHooks as unknown as Record<string, unknown>,
};

export function resolveModulePath(
  fromPath: string,
  specifier: string,
  sourceByPath: Record<string, string>,
): { kind: "external"; value: Record<string, unknown> } | { kind: "local"; path: string } {
  if (specifier in NPM_ALLOWLIST) return { kind: "external", value: NPM_ALLOWLIST[specifier]! };
  // `@component/Card` (`source-roots.ts`) resolves from the STORAGE ROOT, not
  // relative to the importing file - a page at any depth writes the exact
  // same specifier. Same alias `vite.config.ts` resolves for the dev/prod
  // compile paths and `ts-worker.ts` for the editor's type-checking.
  const aliased = resolveAliasSpecifier(specifier);
  if (aliased === null && !specifier.startsWith(".")) {
    throw new PageBuildError(
      `Cannot import "${specifier}" from "${fromPath}" - only relative file imports, ${COMPONENT_ALIAS}/*, and preact/preact-hooks are allowed.`,
    );
  }
  let base: string;
  if (aliased !== null) {
    base = aliased;
  } else {
    const fromDir = fromPath.includes("/") ? fromPath.slice(0, fromPath.lastIndexOf("/")) : "";
    const segments = (fromDir ? fromDir.split("/") : []).concat(specifier.split("/"));
    const resolved: string[] = [];
    for (const segment of segments) {
      if (segment === "" || segment === ".") continue;
      if (segment === "..") resolved.pop();
      else resolved.push(segment);
    }
    base = resolved.join("/");
  }
  // Real page/layout source in this codebase writes explicit `.js`
  // extensions on relative imports (this project's own NodeNext-style
  // convention, e.g. `import Foo from "./Foo.js"`) - unlike
  // `sucrase-eval.ts`'s Component Builder tree, which only ever sees
  // extensionless specifiers. `base` alone (`Foo.js`) never matches a
  // `.tsx`/`.ts` source key, so a trailing `.js`/`.jsx` is stripped before
  // generating candidates too - found by this module's own test suite
  // using a realistic `.js`-suffixed import, not assumed.
  const withoutJsExt = base.replace(/\.jsx?$/, "");
  const candidates = base === withoutJsExt
    ? [base, `${base}.tsx`, `${base}.ts`]
    : [base, withoutJsExt, `${withoutJsExt}.tsx`, `${withoutJsExt}.ts`];
  for (const candidate of candidates) {
    if (candidate in sourceByPath) return { kind: "local", path: candidate };
  }
  throw new PageBuildError(`Cannot find "${specifier}" imported from "${fromPath}".`);
}

export const CJS_OPTIONS: SucraseOptions = { transforms: ["jsx", "typescript", "imports"], jsxPragma: "h", jsxFragmentPragma: "Fragment", production: true };
const ESM_OPTIONS: SucraseOptions = { transforms: ["jsx", "typescript"], jsxPragma: "h", jsxFragmentPragma: "Fragment", production: true };

/** `"blogs/[slug]/page.tsx"` -> `"blogs/[slug]/page.js"` - the public JS
 * asset key (mục 7) a SOURCE file compiles to, regardless of which page
 * references it (`built-pages-storage.ts`'s `liveAssetKeyFor` doc
 * comment). */
function toJsAssetPath(sourcePath: string): string {
  return sourcePath.replace(/\.tsx?$/, ".js");
}

/** The encode/join half of `toBuiltAssetUrl`, exported on its own for
 * `PageEditor.tsx`'s interactive preview: it only ever has a `PageBuildResult
 * .jsAssets` entry's already-`.js` `jsPath` in hand (not the original source
 * path `toBuiltAssetUrl` expects), and needs the EXACT same URL string
 * `compileEsmAsset`'s rewritten imports/the hydrate manifest embed for that
 * file - to key an import map that remaps it to a blob URL. Safe to skip
 * `toJsAssetPath` here: a `jsPath` already ends in `.js`, which that
 * function's `\.tsx?$` pattern never matches, so calling it again on an
 * already-converted path is already a no-op today - this just skips the
 * redundant call rather than depending on that being true. */
export function builtAssetUrlForJsPath(builtAssetsBaseUrl: string, jsPath: string): string {
  return `${builtAssetsBaseUrl}/${jsPath.split("/").map(encodeURIComponent).join("/")}`;
}

function toBuiltAssetUrl(builtAssetsBaseUrl: string, sourcePath: string): string {
  return builtAssetUrlForJsPath(builtAssetsBaseUrl, toJsAssetPath(sourcePath));
}

/** Built from `PAGES_SOURCE_ROOTS` rather than spelled out, so declaring a
 * new aliased source root there is enough for the import SCANNERS below
 * (`localImportsOf`/`rewriteEsmImports`) to follow it too - a specifier this
 * regex doesn't match is invisible to them, which would silently drop the
 * file from `transitiveDependencies` (no JS asset uploaded) even though
 * `resolveModulePath` resolves it fine. */
const ALIAS_ALTERNATION = PAGES_SOURCE_ROOTS.filter((root) => root.alias)
  .map((root) => root.alias!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
  .join("|");

const IMPORT_FROM_RE = new RegExp(
  `\\bfrom\\s*(["'])((?:\\.[^"']*)|(?:(?:${ALIAS_ALTERNATION})/[^"']*)|preact(?:/hooks)?)\\1`,
  "g",
);

/** Every relative-import specifier in `source`, resolved to real tree
 * paths - shared by `transitiveDependencies` (which needs to know what to
 * visit next) and `rewriteEsmImports` (which needs to know what URL to
 * point at) so the 2 never drift apart on what counts as "this file's own
 * dependencies". */
function localImportsOf(path: string, source: string, sourceByPath: Record<string, string>): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(IMPORT_FROM_RE)) {
    const specifier = match[2]!;
    if (specifier === "preact" || specifier === "preact/hooks") continue;
    const resolved = resolveModulePath(path, specifier, sourceByPath);
    if (resolved.kind === "local") found.push(resolved.path);
  }
  return found;
}

/** Every file reachable from `roots` by following relative imports,
 * `roots` included - mục 7's ESM output needs ALL of them compiled+
 * uploaded (a visitor's browser resolves `page.js`'s own `import
 * "./Greeting.js"` natively, so that URL has to actually exist), unlike
 * the CJS eval path above, which resolves the same closure lazily/on
 * demand via `require()`'s cache instead. */
function transitiveDependencies(roots: string[], sourceByPath: Record<string, string>): Set<string> {
  const visited = new Set<string>();
  function visit(path: string): void {
    if (visited.has(path)) return;
    visited.add(path);
    const source = sourceByPath[path];
    if (source === undefined) return;
    for (const dep of localImportsOf(path, source, sourceByPath)) visit(dep);
  }
  for (const root of roots) visit(root);
  return visited;
}

/** Every `layout.tsx` wrapping `pagePath`, root-first - derived from the
 * path string alone (a folder's layout wraps every page below it), the same
 * way `PageEditor.tsx`'s own `ancestorLayoutChain` does for a layout. */
function ancestorLayoutsOf(pagePath: string, sourceByPath: Record<string, string>): string[] {
  const segments = pagePath.split("/").slice(0, -1);
  const chain: string[] = [];
  for (let i = 0; i <= segments.length; i++) {
    const prefix = segments.slice(0, i).join("/");
    const candidate = prefix ? `${prefix}/layout.tsx` : "layout.tsx";
    if (sourceByPath[candidate] !== undefined) chain.push(candidate);
  }
  return chain;
}

/**
 * Every `page.tsx` whose rendered output can change because `path` changed -
 * it either imports `path` (at any depth) or is wrapped by a `layout.tsx`
 * that does. Used by the Page Editor to flag pages as "saved but not built"
 * after a shared component is edited: without it, editing `@component/Card`
 * silently leaves every page using it stale with no indication in the tree.
 *
 * `path` itself is included when it IS a page (a page trivially depends on
 * itself), so callers don't need to special-case that.
 */
export function pagesAffectedBy(path: string, sourceByPath: Record<string, string>): string[] {
  const pagePaths = Object.keys(sourceByPath).filter((p) => p.startsWith(`${PAGES_ROOT}/`) && /(^|\/)page\.tsx$/.test(p));
  return pagePaths.filter((pagePath) => transitiveDependencies([pagePath, ...ancestorLayoutsOf(pagePath, sourceByPath)], sourceByPath).has(path));
}

/** Rewrites a compiled ESM module's bare `"preact"`/`"preact/hooks"`
 * imports to point at the shared runtime chunk, and its relative imports to
 * point at sibling files' own public JS asset URLs - real `import`
 * statements a VISITOR's browser resolves natively (no eval, unlike the
 * CJS/`new Function` path this module also builds). */
function rewriteEsmImports(
  source: string,
  fromPath: string,
  sourceByPath: Record<string, string>,
  preactRuntimeHref: string,
  builtAssetsBaseUrl: string,
): string {
  return source.replace(IMPORT_FROM_RE, (whole, quote: string, specifier: string) => {
    if (specifier === "preact" || specifier === "preact/hooks") {
      return `from ${quote}${preactRuntimeHref}${quote}`;
    }
    const resolved = resolveModulePath(fromPath, specifier, sourceByPath);
    if (resolved.kind !== "local") return whole;
    return `from ${quote}${toBuiltAssetUrl(builtAssetsBaseUrl, resolved.path)}${quote}`;
  });
}

/**
 * Compiles one file to real, standalone ESM (mục 7) - the `page.js`/
 * `layout.js` a VISITOR's browser `import()`s directly to hydrate, as
 * opposed to `evalModule` below (CJS + `new Function`, used to RENDER the
 * page once, client-side, in the admin tab only).
 *
 * sucrase's CLASSIC jsx pragma (`jsxPragma:"h"`) never auto-injects an
 * `h`/`Fragment` import (confirmed live, the app-r2 spike) - prepended
 * unconditionally here. Real page/layout source in this codebase never
 * explicitly imports `"preact"` itself (classic-pragma-only convention, no
 * exception found while building this) - a page that DID would collide
 * with this prepended import (`h`/`Fragment` declared twice); a real
 * limitation, not exercised by anything in this codebase today.
 *
 * The result is minified (`minify-js.ts`) before being returned - sucrase
 * only strips types/JSX, it never touches whitespace, so without this a
 * shipped `page.js`/`layout.js` would be close to byte-for-byte the
 * original source's own indentation/line breaks.
 */
async function compileEsmAsset(
  path: string,
  sourceByPath: Record<string, string>,
  preactRuntimeHref: string,
  builtAssetsBaseUrl: string,
): Promise<string> {
  const source = sourceByPath[path];
  if (source === undefined) throw new PageBuildError(`"${path}" is not loaded.`);
  let esm: string;
  try {
    esm = transform(source, ESM_OPTIONS).code;
  } catch (error) {
    throw new PageBuildError(`Failed to compile "${path}" (ESM): ${error instanceof Error ? error.message : String(error)}`);
  }
  const rewritten = rewriteEsmImports(esm, path, sourceByPath, preactRuntimeHref, builtAssetsBaseUrl);
  const withRuntimeImport = `import { h, Fragment } from ${JSON.stringify(preactRuntimeHref)};\n${rewritten}`;
  try {
    return await minifyEsmSource(withRuntimeImport);
  } catch (error) {
    throw new PageBuildError(`Failed to minify "${path}": ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Evaluates one `.tsx`/`.ts` module, resolving its relative imports against
 * `sourceByPath` and its `preact`/`preact/hooks` import (if any) against
 * `NPM_ALLOWLIST`. `dry`/`params`/`setTitle`/`dryBind` are NOT resolved
 * through `require()` at all - real page/layout source calls them as BARE
 * ambient globals with no import statement (`dry.generated.d.ts`'s
 * `declare global`), which sucrase's `imports` transform leaves untouched
 * (it only rewrites EXISTING import statements into `require()` calls, it
 * never invents one for an identifier that was never imported). They
 * resolve instead through plain JS function-parameter scoping - the same
 * trick this function already uses for `h`/`Fragment` (`sucrase-eval.ts`'s
 * own precedent), just with 4 more names.
 */
function evalModule(path: string, sourceByPath: Record<string, string>, cache: Map<string, { exports: any }>): { exports: any } {
  const cached = cache.get(path);
  if (cached) return cached;
  const moduleObj = { exports: {} as any };
  cache.set(path, moduleObj);

  const source = sourceByPath[path];
  if (source === undefined) throw new PageBuildError(`"${path}" is not loaded.`);
  let transformed: string;
  try {
    transformed = transform(source, CJS_OPTIONS).code;
  } catch (error) {
    cache.delete(path);
    throw new PageBuildError(`Failed to compile "${path}": ${error instanceof Error ? error.message : String(error)}`);
  }

  const require = (specifier: string) => {
    const resolved = resolveModulePath(path, specifier, sourceByPath);
    return resolved.kind === "external" ? resolved.value : evalModule(resolved.path, sourceByPath, cache).exports;
  };

  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function("module", "exports", "require", "h", "Fragment", "dry", "params", "setTitle", "dryBind", transformed);
    fn(moduleObj, moduleObj.exports, require, h, Fragment, dry, params, setTitle, dryBind);
  } catch (error) {
    cache.delete(path);
    throw error instanceof PageBuildError ? error : new PageBuildError(`Failed to run "${path}": ${error instanceof Error ? error.message : String(error)}`);
  }
  return moduleObj;
}

function moduleDefault(path: string, sourceByPath: Record<string, string>, cache: Map<string, { exports: any }>): (props: never) => unknown {
  const mod = evalModule(path, sourceByPath, cache);
  const exported = mod.exports?.default ?? mod.exports;
  if (typeof exported !== "function") throw new PageBuildError(`"${path}" has no default export function.`);
  return exported;
}

export interface PageBuildInput {
  pathname: string;
  /** Explicit site origin - NEVER read from `window.location` (the build
   * runs in the admin tab, not on the site's own domain) - see
   * `build-document.ts`'s `BuildDocumentContext.origin` doc comment. */
  origin: string;
  adminPath: string;
  siteLang: string;
  /** `globals.css`/`hydrate-built.ts`/`vei/overlay.ts` hrefs
   * (`build-document.ts`'s `AssetHrefs`) - fetch real values from
   * `GET <adminPath>/api/asset-hrefs` (`routes/asset-hrefs.ts`), NOT
   * `assets.ts` directly (that module transitively imports `node:fs` via a
   * re-export - breaks in a real browser build, `status/app-r2-build.md`).
   * `hydrateEntryHref` here should be that response's `hydrateBuiltHref`
   * (mục 7's dedicated bootstrap for a browser-compiled page), NOT
   * `hydrateEntryHref` (that one does `import.meta.glob`, meaningless for a
   * page Vite never saw). */
  assets: { globalsCssHref: string; hydrateEntryHref: string; veiOverlayHref: string };
  /** Same `GET /api/asset-hrefs` response's `preactRuntimeHref` - what
   * `page.js`/`layout.js`'s compiled `"preact"`/`"preact/hooks"` imports get
   * rewritten to point at (mục 7). */
  preactRuntimeHref: string;
  /** `${adminPath}/api/built-assets` - where compiled JS assets are
   * published to and where a visitor's browser fetches them from
   * (`routes/built-assets.ts`, public GET). */
  builtAssetsBaseUrl: string;
  /** `${adminPath}/api/dry-http` */
  dryHttpEndpoint: string;
  allTypes: ContentTypeDefinition[];
  /** Every `.tsx`/`.ts` this page/layout chain (and anything they import)
   * needs, keyed by path relative to the pages tree root. */
  sourceByPath: Record<string, string>;
  entryPath: string;
  /** Root-to-leaf order - same convention `match.ts`'s `RouteMatch.layouts`
   * already uses; `resolveMatchToVNode` reverses it internally. */
  layoutPaths: string[];
  params: Record<string, string | string[]>;
  /** Skip compiling `jsAssets` (the ESM bundle `publishBuiltPage` uploads) -
   * for `PageEditor`'s live preview, which only ever reads `result.html`
   * and deliberately never touches `jsAssets` (see that component's own
   * comment on `result.jsAssets`). Measured live (2026-08-09): sucrase's
   * ESM `compileEsmAsset` pass costs roughly as much synchronous,
   * main-thread-blocking time as the CJS eval pass this function also
   * does - about half of `buildPage`'s total cost thrown away on every
   * debounced preview rebuild before this flag existed. `PageBuild.tsx`'s
   * real publish path never sets this, so publishing is unaffected. */
  skipJsAssets?: boolean;
  /** Reuse `dry()` responses cached in IndexedDB when they're younger than
   * this, instead of refetching them (see `dry-http-cache.ts`) - the same
   * "a debounced preview rebuild shouldn't redo work that can't have
   * changed between two keystrokes" motivation as `skipJsAssets`, applied
   * to the network side. Set ONLY by `PageEditor`'s live preview; leave it
   * unset (every publishing caller does) and every `dry()` call fetches
   * fresh exactly as before. */
  dryCacheTtlMs?: number;
}

export interface PageBuildResult {
  html: string;
  /** ESM `page.js`/`layout.js`/every transitively-imported component -
   * mục 7. `publishBuiltPage` uploads each; `html` already references their
   * URLs via the embedded `#dry-hydrate-manifest` (`buildPage` below). */
  jsAssets: { jsPath: string; source: string }[];
  /** Deduped, keep-latest-version per resource - a page that calls
   * `dry().collection("blog").get(1)` twice shouldn't produce 2 `_page_deps`
   * rows for `"blog"`. */
  deps: HttpDryReaderDependency[];
  /** Computed from the ACTUAL rendered SEO cascade (`mergeSeoLayers(...).
   * noIndex !== true`), not a caller-supplied flag - matches how a real
   * page's `noIndex` is decided everywhere else in this codebase. */
  inSitemap: boolean;
}

function dedupeDeps(deps: HttpDryReaderDependency[]): HttpDryReaderDependency[] {
  const byResource = new Map<string, number>();
  for (const dep of deps) byResource.set(dep.resource, dep.version);
  return [...byResource.entries()].map(([resource, version]) => ({ resource, version }));
}

/** Site-wide SEO defaults (`seoDefaults` singleton), fetched directly -
 * deliberately NOT through `dry-reader-http.ts`'s tracked `dry()`: that
 * would append a phantom entry to the page's OWN replay log that its code
 * never actually called, breaking `dry-reader-client.ts`'s strictly
 * POSITIONAL hydration replay. Mirrors `page-handler.ts`'s own
 * `loadSeoDefaults` call, which bypasses `dry()`'s tracking machinery for
 * exactly the same reason - see that module's call site. Still recorded as
 * a real `_page_deps` entry (every page implicitly depends on site-wide
 * defaults), just added to `deps` manually here instead. */
async function fetchSeoDefaults(dryHttpEndpoint: string, cacheTtlMs: number | undefined): Promise<{ value: DrySeoValue | undefined; dep: HttpDryReaderDependency | null }> {
  let response;
  try {
    response = await fetchDryHttp(dryHttpEndpoint, { kind: "singleton", name: "seoDefaults", method: "get" }, cacheTtlMs);
  } catch {
    return { value: undefined, dep: null };
  }
  const [entry] = decodeCallLog(response.text);
  const seo = (entry?.result as Record<string, unknown> | null)?.seo;
  return {
    value: seo && typeof seo === "object" ? (seo as DrySeoValue) : undefined,
    dep: response.resource ? { resource: response.resource, version: response.version } : null,
  };
}

/**
 * Compiles + renders one page to a complete HTML document. Does NOT write
 * anything anywhere - see `publishBuiltPage` for the storage/registry half
 * (`routes/pages-build.ts`).
 */
export async function buildPage(input: PageBuildInput): Promise<PageBuildResult> {
  setCurrentParams(input.params);
  resetHttpTitle();
  const seo: DrySeoLayers = {};
  const dryConfig: HttpDryReaderConfig = {
    endpoint: input.dryHttpEndpoint,
    callLog: [],
    deps: [],
    allTypes: input.allTypes,
    seo,
    cacheTtlMs: input.dryCacheTtlMs,
  };
  configureHttpDryReader(dryConfig);

  const { value: defaultSeo, dep: defaultsDep } = await fetchSeoDefaults(input.dryHttpEndpoint, input.dryCacheTtlMs);
  seo.default = defaultSeo;

  const cache = new Map<string, { exports: any }>();
  const match: RouteMatch = {
    page: async () => ({ default: moduleDefault(input.entryPath, input.sourceByPath, cache) }),
    layouts: input.layoutPaths.map((path) => async () => ({ default: moduleDefault(path, input.sourceByPath, cache) })),
    params: input.params,
  };

  const vnode = await resolveMatchToVNode(match);
  const titleLayer = readHttpTitleLayer();
  if (titleLayer) seo.page = { ...seo.page, ...titleLayer };

  const rawHtml = await buildDocument(vnode, {
    seo,
    origin: input.origin,
    pathname: input.pathname,
    adminPath: input.adminPath,
    siteLang: input.siteLang,
    assets: input.assets,
    seoEntryDates: dryConfig.seoEntryDates,
    callLog: dryConfig.callLog,
    editMode: false,
  });
  const withCss = await inlinePageCss(rawHtml);

  // mục 7: compile the WHOLE reachable closure (entry + layouts + anything
  // THEY import) to real ESM, and embed a manifest telling
  // `hydrate-built.ts` which uploaded URLs are the entry/layout chain -
  // everything else in the closure is reached by the browser's OWN native
  // `import` resolution once hydration starts, not listed here directly.
  const roots = [input.entryPath, ...input.layoutPaths];
  const jsAssets = input.skipJsAssets
    ? []
    : await Promise.all(
        [...transitiveDependencies(roots, input.sourceByPath)].map(async (path) => ({
          jsPath: toJsAssetPath(path),
          source: await compileEsmAsset(path, input.sourceByPath, input.preactRuntimeHref, input.builtAssetsBaseUrl),
        })),
      );
  const hydrateManifest = {
    entryUrl: toBuiltAssetUrl(input.builtAssetsBaseUrl, input.entryPath),
    layoutUrls: input.layoutPaths.map((p) => toBuiltAssetUrl(input.builtAssetsBaseUrl, p)),
    // Same URL every compiled asset's own `h`/`Fragment`/hooks imports got
    // rewritten to above (`compileEsmAsset`) - `hydrate-built.ts` needs it
    // too, to `import()` `hydrate` from that exact same Preact module
    // instance rather than bundling its own copy (see that file's doc
    // comment for why the two must match).
    preactRuntimeUrl: input.preactRuntimeHref,
  };
  const manifestScripts =
    `<script type="application/json" id="dry-hydrate-manifest">${JSON.stringify(hydrateManifest).replace(/</g, "\\u003c")}</script>` +
    `<script type="application/json" id="dry-hydrate-params">${JSON.stringify(input.params).replace(/</g, "\\u003c")}</script>`;
  const html = withCss.replace("</body>", `${manifestScripts}</body>`);

  const deps = dedupeDeps(defaultsDep ? [...dryConfig.deps, defaultsDep] : dryConfig.deps);
  const inSitemap = mergeSeoLayers(seo).noIndex !== true;
  return { html, jsAssets, deps, inSitemap };
}

/**
 * Compiles this page's OWN Tailwind CSS (mục 6, `tailwind-build.ts`) and
 * inlines it as a `<style>` tag - simpler than a separate cached asset
 * (mục 6's original text envisioned a content-hashed file), and still
 * strictly per-page (only the classes this page actually uses, no global
 * stylesheet, no "build dư" for an unrelated page's class change). A
 * separate asset is a reasonable future upgrade if inline size ever
 * matters; not built now (YAGNI - nothing has measured a real page's size
 * yet).
 *
 * `typeof document === "undefined"` guard: `compileTailwindCss` needs a
 * real browser (a hidden iframe, confirmed live - `status/app-r2-build.md`)
 * - under vitest's default Node environment there's no DOM at all, so this
 * degrades to "no CSS inlined" rather than crashing every test that calls
 * `buildPage`. Real usage (the browser build pipeline) always has a
 * `document`.
 */
async function inlinePageCss(html: string): Promise<string> {
  if (typeof document === "undefined") return html;
  const bodyMatch = /<body>([\s\S]*)<\/body>/.exec(html);
  if (!bodyMatch) return html;
  const css = await compileTailwindCss(bodyMatch[1]!);
  if (!css) return html;
  return html.replace("</head>", `<style>${css}</style></head>`);
}

export interface PublishOptions {
  pagesBuildEndpoint: string;
  pathname: string;
  /** The route-entry SOURCE file this build compiled from (same value
   * passed as `buildPage()`'s own `PageBuildInput.entryPath`) - forwarded to
   * `routes/pages-build.ts` so it can clear `ai-page-source-flags.ts`'s red
   * dot for this file once the publish actually succeeds. */
  entryPath: string;
  buildId?: string;
}

function toWireBody(result: PageBuildResult, options: PublishOptions): Record<string, unknown> {
  return {
    pathname: options.pathname,
    entryPath: options.entryPath,
    html: result.html,
    jsAssets: result.jsAssets,
    buildId: options.buildId ?? crypto.randomUUID(),
    deps: result.deps,
    inSitemap: result.inSitemap,
  };
}

/** POSTs a `buildPage` result to `routes/pages-build.ts` - the network half
 * kept separate from `buildPage` itself so a caller can build without
 * necessarily publishing (e.g. a future preview feature). */
export async function publishBuiltPage(result: PageBuildResult, options: PublishOptions): Promise<void> {
  const response = await fetch(options.pagesBuildEndpoint, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(toWireBody(result, options)),
  });
  if (!response.ok) {
    throw new PageBuildError(`Publishing "${options.pathname}" failed: HTTP ${response.status}.`);
  }
}

/** Batch counterpart of `publishBuiltPage` (`plans/app-r2.md` mục 11's
 * "Batch PUT lên storage, đừng 500 request rời rạc") - several pages' worth
 * of already-built results in ONE POST, for `PageBuild.tsx`'s "Build all"
 * (a one-off single-page "Build" click still uses `publishBuiltPage` above -
 * batching a single page would just add overhead). Throws with every
 * per-page failure message joined together if the server reports ANY -
 * `PageBuild.tsx` decides what to do with a partial batch failure (some
 * pages published, some didn't) by re-checking `_pages` status afterward,
 * not from this function's return value. */
export async function publishBuiltPages(
  entries: { result: PageBuildResult; options: PublishOptions }[],
  pagesBuildEndpoint: string,
): Promise<void> {
  const response = await fetch(pagesBuildEndpoint, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pages: entries.map(({ result, options }) => toWireBody(result, options)) }),
  });
  if (!response.ok) {
    throw new PageBuildError(`Publishing ${entries.length} pages failed: HTTP ${response.status}.`);
  }
  const body = (await response.json()) as { errors?: { pathname: string; message: string }[] };
  if (body.errors && body.errors.length > 0) {
    throw new PageBuildError(body.errors.map((e) => `"${e.pathname}": ${e.message}`).join("; "));
  }
}

/** One buildable page, static or dynamic - what `resolveAllPageTargets`
 * resolves the whole site down to and `PageBuildInput.entryPath`/
 * `layoutPaths`/`params` are built from directly. For a dynamic page these
 * come from `dynamic-routes.ts`'s real resolved slug, NOT re-derivable from
 * the pathname alone the way a static page's `entryPath`/`layoutPaths` are
 * (`matchSourceRoute` has no way to turn `/blogs/hello-world` back into
 * `blogs/[slug]/page.tsx` without already knowing which template it came
 * from). */
export interface PageTarget {
  pathname: string;
  entryPath: string;
  layoutPaths: string[];
  params: Record<string, string | string[]>;
}

/** A `[param]` template whose route exists but whose own source names no
 * slug-enabled collection to enumerate (`page-collection.ts`) - shown as a
 * warning, not silently dropped (`dynamic-routes.ts`'s own
 * `DynamicTemplateResolution.type: null`). */
export interface UnmatchedTemplate {
  pathnameTemplate: string;
}

/** Every buildable page on the site - static `page.tsx` routes plus every
 * dynamic `[param]` template resolved against the published rows of
 * whichever collection its own source reads (`dynamic-routes.ts`). Shared by `PageBuild.tsx`
 * ("Build all") and `PageEditor.tsx` (its own "Build all" shortcut) so the
 * 2 never compute a different notion of "every page" from the same
 * `sourceByPath`. */
export async function resolveAllPageTargets(
  sourceByPath: Record<string, string>,
  allTypes: ContentTypeDefinition[],
  dryHttpEndpoint: string,
): Promise<{ targets: Map<string, PageTarget>; unmatchedTemplates: UnmatchedTemplate[] }> {
  const manifest = buildManifestRouteTree(Object.keys(sourceByPath));
  const targets = new Map<string, PageTarget>();
  for (const pathname of staticPagePaths(manifest)) {
    const match = matchSourceRoute(manifest, pathname);
    if (match) targets.set(pathname, { pathname, ...match });
  }
  const unmatchedTemplates: UnmatchedTemplate[] = [];
  const dynamicTemplates = listDynamicPageTemplates(manifest);
  if (dynamicTemplates.length > 0) {
    const resolutions = await resolveDynamicPages(dynamicTemplates, allTypes, sourceByPath, dryHttpEndpoint);
    for (const resolution of resolutions) {
      if (!resolution.type) {
        unmatchedTemplates.push({ pathnameTemplate: resolution.template.pathnameTemplate });
        continue;
      }
      for (const page of resolution.pages) targets.set(page.pathname, page);
    }
  }
  return { targets, unmatchedTemplates };
}
