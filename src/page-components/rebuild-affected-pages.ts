import type { ContentTypeDefinition } from "../content-types/types.js";
import { PAGE_BUILDER_RESOURCE_ID } from "../content-types/permissions.js";
import { canAccess } from "../store/auth.js";
import { fetchJson, loadAllPagesSource, type AssetHrefs } from "./pages-source-http.js";

/**
 * Background rebuild of every published page that depends on `typeName`,
 * meant to be fired right after a collection/singleton entry Save succeeds
 * (`ContentEntryEditor.tsx`'s `handleSave`). Mirrors what VEI's `saveAll()`
 * already does for its own saves (`apps/vei/overlay.ts`'s
 * `rebuildAffectedPages`, via a hidden iframe pointed at `PageBuild.tsx`'s
 * `?autoBuild=` mode) - that iframe indirection exists only because VEI
 * ships inside the PUBLIC site bundle, which can't afford to carry the
 * Sucrase/Tailwind build pipeline. `ContentEntryEditor.tsx` already runs in
 * the admin SPA alongside `PageEditor.tsx`/`PageBuild.tsx`, so this calls
 * the same low-level primitives (`buildPage`, `publishBuiltPage`,
 * `resolveAllPageTargets`) directly, in-process - `page-build.js` is
 * dynamic-imported here (not a static top-level import) so its
 * Sucrase/Tailwind weight is only ever fetched on a save that actually has
 * affected pages to rebuild, not on every entry form's initial load.
 *
 * Never throws and never blocks the caller on anything but this work
 * itself - a missing Page Builder permission, an offline network, or a
 * build failure all just resolve/report through `onStatus`; the entry Save
 * this follows has already succeeded by the time this runs and must never
 * be reported as failed because of it.
 */
export async function rebuildAffectedPages(
  adminPath: string,
  typeName: string,
  allTypes: ContentTypeDefinition[],
  onStatus?: (message: string) => void,
): Promise<void> {
  if (!canAccess(PAGE_BUILDER_RESOURCE_ID, "setting")) return;
  try {
    const response = await fetch(`${adminPath}/api/pages-build?byResource=${encodeURIComponent(typeName)}`, { credentials: "same-origin" });
    if (!response.ok) return;
    const body = (await response.json()) as { paths?: string[] };
    const paths = body.paths ?? [];
    if (paths.length === 0) return;

    onStatus?.(`Publishing ${paths.length} ${paths.length === 1 ? "page" : "pages"}…`);

    const [{ buildPage, publishBuiltPage, resolveAllPageTargets }, [sourceByPath, assetHrefs]] = await Promise.all([
      import("./page-build.js"),
      Promise.all([loadAllPagesSource(adminPath), fetchJson<AssetHrefs>(`${adminPath}/api/asset-hrefs`)]),
    ]);

    const { targets } = await resolveAllPageTargets(sourceByPath, allTypes, `${adminPath}/api/dry-http`);
    const origin = window.location.origin;
    let built = 0;
    for (const pathname of paths) {
      const target = targets.get(pathname);
      if (!target) continue;
      const result = await buildPage({
        pathname,
        origin,
        adminPath,
        siteLang: "en",
        assets: { globalsCssHref: assetHrefs.globalsCssHref, hydrateEntryHref: assetHrefs.hydrateBuiltHref, veiOverlayHref: assetHrefs.veiOverlayHref },
        preactRuntimeHref: assetHrefs.preactRuntimeHref,
        builtAssetsBaseUrl: `${adminPath}/api/built-assets`,
        dryHttpEndpoint: `${adminPath}/api/dry-http`,
        allTypes,
        sourceByPath,
        entryPath: target.entryPath,
        layoutPaths: target.layoutPaths,
        params: target.params,
      });
      await publishBuiltPage(result, { pagesBuildEndpoint: `${adminPath}/api/pages-build`, pathname });
      built += 1;
    }
    onStatus?.(built > 0 ? `Published ${built} ${built === 1 ? "page" : "pages"}` : "No pages needed rebuilding");
  } catch {
    // Best-effort - see this function's own doc comment.
  }
}
