import type { ContentTypeDefinition } from "../content-types/types.js";
import { fetchJson, loadAllPagesSource, type AssetHrefs } from "./pages-source-http.js";

/**
 * Background rebuild of every published page that depends on `typeName`,
 * meant to be fired right after a collection/singleton entry Save succeeds
 * (`ContentEntryEditor.tsx`'s `handleSave`). The deleted public-site VEI
 * overlay used to do the same thing through a hidden iframe pointed at
 * `PageBuild.tsx`'s `?autoBuild=` mode - that indirection existed only
 * because the overlay shipped inside the PUBLIC site bundle, which can't
 * afford to carry the Sucrase/Tailwind build pipeline.
 * `ContentEntryEditor.tsx` already runs in the admin SPA, so this calls
 * the same low-level primitives (`buildPage`, `publishBuiltPage`,
 * `resolveAllPageTargets`) directly, in-process - `page-build.js` is
 * dynamic-imported here (not a static top-level import) so its
 * Sucrase/Tailwind weight is only ever fetched on a save that actually has
 * affected pages to rebuild, not on every entry form's initial load.
 *
 * "Code + content = page" (`routes/pages-build.ts`'s own doc comment): the
 * caller doesn't need the code-edit permission at all - the server
 * authorizes per-resource, and grants this whenever the caller can already
 * view whatever the affected page(s) depend on (which a save that just
 * succeeded on `typeName` already implies). No client-side permission
 * pre-check here anymore; the server is the one source of truth.
 *
 * Never throws and never blocks the caller on anything but this work
 * itself - the entry Save this follows has already succeeded by the time
 * this runs and must never be reported as failed because of it. It DOES,
 * however, always report a real FAILURE through `onStatus` (an unexpected
 * non-2xx response, or a build error mid-loop) instead of swallowing it
 * silently the way it used to - see `ContentEntryEditor.tsx`'s `handleSave`,
 * which turns each `onStatus` call into a toast. The one case that stays
 * silent on purpose is "no published page depends on this resource yet" -
 * the common case for most saves, not something worth a toast every time.
 */
export async function rebuildAffectedPages(
  adminPath: string,
  typeName: string,
  allTypes: ContentTypeDefinition[],
  onStatus?: (message: string) => void,
): Promise<void> {
  try {
    const response = await fetch(`${adminPath}/api/pages-build?byResource=${encodeURIComponent(typeName)}`, { credentials: "same-origin" });
    if (!response.ok) {
      onStatus?.(`Saved, but couldn't check which pages to publish (HTTP ${response.status}).`);
      return;
    }
    const body = (await response.json()) as { paths?: string[] };
    const paths = body.paths ?? [];
    // No toast for the common "nothing to publish" case (most content types
    // don't back any page) - unlike the failure branches above, this isn't
    // something the editor needs to be alerted to on every single save.
    if (paths.length === 0) return;

    onStatus?.(`Publishing ${paths.length} ${paths.length === 1 ? "page" : "pages"}…`);

    const [{ buildPage, computeSourceHash, publishBuiltPage, resolveAllPageTargets }, [sourceByPath, assetHrefs]] = await Promise.all([
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
        assets: { globalsCssHref: assetHrefs.globalsCssHref, hydrateEntryHref: assetHrefs.hydrateBuiltHref, editLauncherHref: assetHrefs.editLauncherHref },
        preactRuntimeHref: assetHrefs.preactRuntimeHref,
        builtAssetsBaseUrl: `${adminPath}/api/built-assets`,
        dryHttpEndpoint: `${adminPath}/api/dry-http`,
        allTypes,
        sourceByPath,
        entryPath: target.entryPath,
        layoutPaths: target.layoutPaths,
        params: target.params,
      });
      const sourceHash = await computeSourceHash(target, sourceByPath);
      await publishBuiltPage(result, { pagesBuildEndpoint: `${adminPath}/api/pages-build`, pathname, entryPath: target.entryPath, sourceHash });
      built += 1;
    }
    onStatus?.(built > 0 ? `Published ${built} ${built === 1 ? "page" : "pages"}` : "No pages needed rebuilding");
  } catch (error) {
    // Best-effort (see this function's own doc comment) - but still surface
    // it, so a mid-loop failure (a build error, the network dropping) never
    // leaves the "Publishing N pages…" toast stuck forever with nothing to
    // resolve it.
    onStatus?.(`Saved, but publishing failed: ${error instanceof Error ? error.message : "unknown error"}.`);
  }
}
