/**
 * "Does this page compile and render?" check for the MCP `preview_page_source`
 * tool (`src/server/routes/mcp.ts`) - answers the question a human gets for
 * free from `PageEditor.tsx`'s own `srcdoc` iframe preview, for an MCP
 * client that has no browser to look at one.
 *
 * Deliberately NOT a call to `page-build.ts`'s own `buildPage()` - that
 * function is the browser build orchestrator (`buildPage.ts`'s own doc
 * comment), wired to `dry-reader-http.ts`'s HTTP-based `dry()` (an
 * unauthenticated self-fetch to `${adminPath}/api/dry-http` that would 401
 * from server-side code today - `/api/dry-http` only accepts a session
 * cookie or `handler.ts`'s `mcp`-segment-only PAT bearer check, neither of
 * which an MCP tool call's own request carries forward automatically). Real
 * `dry()`-backed data would need either widening what a PAT can reach (a
 * real security-scope decision, not something to fold silently into a
 * preview tool) or a second, DB-backed render path - out of scope here; see
 * `status/page-editor-magic-chat.md`.
 *
 * Instead, this reuses `page-build.ts`'s GENERIC pieces (`resolveModulePath`,
 * `CJS_OPTIONS`, `resolveMatchToVNode`, `buildDocument` - all already proven
 * to run outside a browser, `page-build.test.ts` exercises them under plain
 * Node/vitest) with its own small eval loop that injects a STUBBED `dry()` -
 * every call resolves to empty/null instead of doing a network request. That
 * means: real compile errors, real render-time crashes (an undefined access,
 * a bad prop, a broken import) all surface exactly as they would in a real
 * build; a page's actual CONTENT does not - this checks the code works, not
 * what a real visitor would see. `params()`/`setTitle()`/`dryBind` are pure
 * local state either way (no network involved), so those are reused
 * verbatim from their real modules, not stubbed.
 *
 * Only static routes are supported (no `[param]` segments) - resolving a
 * dynamic route to a real example page would itself need a real content
 * lookup, the same data-access problem this module exists to avoid.
 */
import { h, Fragment } from "preact";
import { transform } from "sucrase";
import { resolveModulePath, CJS_OPTIONS, PageBuildError } from "./page-build.js";
import { params, setCurrentParams } from "../content-types/params-reader-client.js";
import { resetHttpTitle, setTitle } from "../content-types/dry-title-http.js";
import { dryBind } from "../content-types/dry-vei.js";
import { resolveMatchToVNode } from "../server/app-router/resolve-match.js";
import { buildDocument } from "../server/app-router/build-document.js";
import type { RouteMatch } from "../server/app-router/match.js";
import { buildManifestRouteTree, matchSourceRoute } from "../server/app-router/route-manifest.js";
import { PAGES_ROOT } from "../server/app-router/source-roots.js";
import { GLOBALS_CSS_HREF, HYDRATE_ENTRY_HREF, VEI_OVERLAY_HREF } from "../server/app-router/assets.js";
import type { DryCollectionReader, DryReader, DrySingletonReader } from "../content-types/dry-reader.js";

function createStubDryReader(): DryReader {
  const collectionReader = {
    get: async () => null,
    list: async () => ({ rows: [], total: 0 }),
  } as DryCollectionReader<Record<string, unknown>>;
  const singletonReader = {
    get: async () => ({}),
  } as DrySingletonReader<Record<string, unknown>>;
  return {
    collection: () => collectionReader,
    singleton: () => singletonReader,
  };
}

/** Same shape as `page-build.ts`'s own private `evalModule`, minus the ESM/
 * hydration half (never needed here - nothing this produces is published or
 * hydrated) and with `dry` passed in as a parameter instead of imported at
 * module scope, so it can be the stub above instead of the real HTTP one. */
function evalModule(path: string, sourceByPath: Record<string, string>, cache: Map<string, { exports: unknown }>, dryFn: () => DryReader): { exports: any } {
  const cached = cache.get(path);
  if (cached) return cached as { exports: any };
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
    return resolved.kind === "external" ? resolved.value : evalModule(resolved.path, sourceByPath, cache, dryFn).exports;
  };

  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function("module", "exports", "require", "h", "Fragment", "dry", "params", "setTitle", "dryBind", transformed);
    fn(moduleObj, moduleObj.exports, require, h, Fragment, dryFn, params, setTitle, dryBind);
  } catch (error) {
    cache.delete(path);
    throw error instanceof PageBuildError ? error : new PageBuildError(`Failed to run "${path}": ${error instanceof Error ? error.message : String(error)}`);
  }
  return moduleObj;
}

function moduleDefault(path: string, sourceByPath: Record<string, string>, cache: Map<string, { exports: unknown }>, dryFn: () => DryReader): (props: never) => unknown {
  const mod = evalModule(path, sourceByPath, cache, dryFn);
  const exported = mod.exports?.default ?? mod.exports;
  if (typeof exported !== "function") throw new PageBuildError(`"${path}" has no default export function.`);
  return exported;
}

export type PageSourcePreviewResult = { ok: true; html: string } | { ok: false; message: string };

export async function checkPageSourceBuild(path: string, sourceByPath: Record<string, string>, origin: string, adminPath: string, siteLang: string): Promise<PageSourcePreviewResult> {
  if (!path.startsWith(`${PAGES_ROOT}/`) || !/(^|\/)page\.tsx$/.test(path)) {
    return { ok: false, message: `"${path}" is not a page.tsx route entry - only a page.tsx file can be previewed.` };
  }
  const withoutRoot = path.slice(PAGES_ROOT.length + 1);
  const segments = withoutRoot === "page.tsx" ? [] : withoutRoot.replace(/\/page\.tsx$/, "").split("/");
  if (segments.some((segment) => segment.startsWith("["))) {
    return { ok: false, message: `"${path}" is a dynamic route (has a [param] segment) - previewing dynamic routes isn't supported yet.` };
  }
  const pathname = segments.length === 0 ? "/" : `/${segments.join("/")}`;

  const manifest = buildManifestRouteTree(Object.keys(sourceByPath));
  const match = matchSourceRoute(manifest, pathname);
  if (!match || match.entryPath !== path) {
    return { ok: false, message: `Could not resolve a route for "${path}".` };
  }

  try {
    setCurrentParams(match.params);
    resetHttpTitle();
    const cache = new Map<string, { exports: unknown }>();
    const dryFn = () => createStubDryReader();
    const routeMatch: RouteMatch = {
      page: async () => ({ default: moduleDefault(match.entryPath, sourceByPath, cache, dryFn) }),
      layouts: match.layoutPaths.map((layoutPath) => async () => ({ default: moduleDefault(layoutPath, sourceByPath, cache, dryFn) })),
      params: match.params,
    };
    const vnode = await resolveMatchToVNode(routeMatch);
    const html = await buildDocument(vnode, {
      seo: {},
      origin,
      pathname,
      adminPath,
      siteLang,
      assets: { globalsCssHref: GLOBALS_CSS_HREF, hydrateEntryHref: HYDRATE_ENTRY_HREF, veiOverlayHref: VEI_OVERLAY_HREF },
      callLog: [],
      editMode: false,
    });
    return { ok: true, html };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}
