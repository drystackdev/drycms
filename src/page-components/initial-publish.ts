import type { ContentTypeDefinition } from "../content-types/types.js";
import type { PageBuildResult, PublishOptions } from "./page-build.js";
import { fetchJson, loadAllPagesSource, type AssetHrefs } from "./pages-source-http.js";

/**
 * Background "publish everything" - the client half of the server's
 * pages-source auto-seed (`routes/auth.ts`'s `maybeSeedPagesSource`): a
 * fresh tenant deploy now ships with real starter `pages/**` content in
 * `pagesSourceStorage` but zero BUILT pages, since building needs THIS admin
 * SPA's own Sucrase/Tailwind pipeline (`page-build.ts`) - the server never
 * compiles a page itself (`routes/pages-build.ts`'s own doc comment).
 * `routers/App.tsx`'s `AuthenticatedApp` fires this once, automatically, the
 * first time an authenticated admin's session reports `needsInitialPublish`.
 *
 * Mirrors `rebuild-affected-pages.ts`'s `rebuildAffectedPages` (same
 * primitives, same "never throws" contract, same dynamic `import("./
 * page-build.js")` so its Sucrase/Tailwind weight is only ever fetched when
 * actually needed) but publishes EVERY resolvable target instead of a
 * `byResource`-filtered list, batching the publish call the way
 * `PageBuild.tsx`'s own "Build all" does rather than one request per page.
 */
const PUBLISH_ALL_BATCH_SIZE = 5;

export async function publishAllPages(
  adminPath: string,
  allTypes: ContentTypeDefinition[],
  onStatus?: (message: string) => void,
): Promise<{ built: number; error?: string }> {
  try {
    const [{ buildPage, publishBuiltPages, resolveAllPageTargets }, sourceByPath, assetHrefs] = await Promise.all([
      import("./page-build.js"),
      loadAllPagesSource(adminPath),
      fetchJson<AssetHrefs>(`${adminPath}/api/asset-hrefs`),
    ]);

    const { targets } = await resolveAllPageTargets(sourceByPath, allTypes, `${adminPath}/api/dry-http`);
    const pathnames = [...targets.keys()];
    if (pathnames.length === 0) return { built: 0 };

    const origin = window.location.origin;
    let batch: { result: PageBuildResult; options: PublishOptions }[] = [];
    let built = 0;

    async function flush(): Promise<void> {
      if (batch.length === 0) return;
      await publishBuiltPages(batch, `${adminPath}/api/pages-build`);
      built += batch.length;
      batch = [];
    }

    for (const pathname of pathnames) {
      const target = targets.get(pathname);
      if (!target) continue;
      const result = await buildPage({
        pathname,
        origin,
        adminPath,
        siteLang: "en",
        assets: {
          globalsCssHref: assetHrefs.globalsCssHref,
          hydrateEntryHref: assetHrefs.hydrateBuiltHref,
          veiOverlayHref: assetHrefs.veiOverlayHref,
        },
        preactRuntimeHref: assetHrefs.preactRuntimeHref,
        builtAssetsBaseUrl: `${adminPath}/api/built-assets`,
        dryHttpEndpoint: `${adminPath}/api/dry-http`,
        allTypes,
        sourceByPath,
        entryPath: target.entryPath,
        layoutPaths: target.layoutPaths,
        params: target.params,
      });
      batch.push({ result, options: { pagesBuildEndpoint: `${adminPath}/api/pages-build`, pathname, entryPath: target.entryPath } });
      if (batch.length >= PUBLISH_ALL_BATCH_SIZE) await flush();
    }
    await flush();
    onStatus?.(built > 0 ? `Published ${built} ${built === 1 ? "page" : "pages"}` : "No pages needed publishing");
    return { built };
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    onStatus?.(`Initial publish failed: ${message}.`);
    return { built: 0, error: message };
  }
}
