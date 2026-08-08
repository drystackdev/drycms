import { useEffect, useMemo, useState } from "preact/hooks";
const { path } = window.__DRY_CONFIG__;
import DataTable, { type DataTableColumn } from "../components/DataTable.js";
import { createContentTypesApi, listCached } from "../content-types/http-api.js";
import { SYSTEM_BUILD_RESOURCE_ID } from "../content-types/permissions.js";
import type { ContentTypeDefinition } from "../content-types/types.js";
import { canAccess } from "../store/auth.js";
import { toast } from "../components/Toast.js";
import TextField from "../components/fields/TextField.js";
import { useDocumentTitle } from "./page-common.js";
import { buildManifestRouteTree, listDynamicPageTemplates, matchSourceRoute, staticPagePaths } from "../server/app-router/route-manifest.js";
import { resolveDynamicPages } from "../page-components/dynamic-routes.js";
import { buildPage, publishBuiltPage, PageBuildError } from "../page-components/page-build.js";

/**
 * Minimal admin "Build" page (`plans/app-r2.md` mục 11 - a first, real cut,
 * not the full status/stale/progress/resume UI that mục envisions). Lists
 * every page found under `pagesSourceStorage` (via `route-manifest.ts`,
 * mục 1 - static AND dynamic `[slug]` pages, resolved through mục 4's
 * `dynamic-routes.ts`) next to its current `_pages` status, with a Build
 * button per row that runs the REAL pipeline (`page-build.ts`) client-side
 * and publishes the result.
 */

// Deliberately NOT named `FileEntry` (that's `storage/entry-types.ts`'s real
// exported type, which this doesn't import) - a relative storage path lives
// on `.id`, NOT `.path` (`storage/entry.ts`'s `toFileEntry`:
// `id: stat.path`). Caught live: the first version of this file guessed
// `.path` and crashed ("Cannot read properties of undefined (reading
// 'split')") the moment a real R2-backed pages-source tree was loaded under
// `wrangler dev` - `?tree` isn't supported there (R2 has no `listAll`), so
// the `list()`-fallback path is what actually exercised this field.
interface TreeEntry {
  id: string;
  name: string;
  kind: "file" | "folder";
}

interface PageStatusRow {
  path: string;
  objectKey: string;
  buildId: string;
  builtAt: number;
  inSitemap: boolean;
  publishAt: number | null;
  staleResource: string | null;
}

interface Row extends Record<string, unknown> {
  path: string;
  status: "not-built" | "stale" | "scheduled" | "live";
  builtAt: number | null;
  staleResource: string | null;
}

/** One buildable page, static or dynamic - what `buildOne` actually needs.
 * For a dynamic page these come from `dynamic-routes.ts`'s real resolved
 * slug, NOT re-derivable from the pathname alone the way a static page's
 * `entryPath`/`layoutPaths` are (`matchSourceRoute` has no way to turn
 * `/blogs/hello-world` back into `blogs/[slug]/page.tsx` without already
 * knowing which template it came from). */
interface PageTarget {
  pathname: string;
  entryPath: string;
  layoutPaths: string[];
  params: Record<string, string | string[]>;
}

/** A `[param]` template whose route exists but no content type's
 * `seoUrlPattern` matches it - shown as a warning, not silently dropped
 * (`dynamic-routes.ts`'s own `DynamicTemplateResolution.type: null`). */
interface UnmatchedTemplate {
  pathnameTemplate: string;
}

/** `routes/asset-hrefs.ts`'s response shape (mục 7). */
interface AssetHrefs {
  globalsCssHref: string;
  hydrateEntryHref: string;
  veiOverlayHref: string;
  preactRuntimeHref: string;
  hydrateBuiltHref: string;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`GET ${url} failed: HTTP ${response.status}`);
  return (await response.json()) as T;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { credentials: "same-origin" });
  if (!response.ok) throw new Error(`GET ${url} failed: HTTP ${response.status}`);
  return response.text();
}

function toUrlPath(relativePath: string): string {
  return relativePath.split("/").map(encodeURIComponent).join("/");
}

/** `?tree` is only implemented for `kind: "local"` (`storage/types.ts`'s
 * `StorageAdapter.listAll` doc comment - deliberately absent for R2/S3,
 * which paginate by prefix/delimiter). Confirmed live under `wrangler dev`
 * (real R2 simulation, `kind: "cloudflare"`): `{"supported":false}`, not an
 * error - this recursive per-folder fallback is required for production,
 * not a defensive nicety. */
async function listAllFilesRecursive(folder: string): Promise<TreeEntry[]> {
  const url = folder === "" ? `${path}/api/pages-source` : `${path}/api/pages-source/${toUrlPath(folder)}`;
  const { entries } = await fetchJson<{ path: string; entries: TreeEntry[] }>(url);
  const files: TreeEntry[] = [];
  for (const entry of entries) {
    if (entry.kind === "folder") files.push(...(await listAllFilesRecursive(entry.id)));
    else files.push(entry);
  }
  return files;
}

export default function PageBuild() {
  useDocumentTitle("Page Build");
  const typesApi = useMemo(() => createContentTypesApi(`${path}/api/content-types`), []);
  const canBuild = canAccess(SYSTEM_BUILD_RESOURCE_ID, "setting");

  const [allTypes, setAllTypes] = useState<ContentTypeDefinition[] | null>(null);
  const [sourceByPath, setSourceByPath] = useState<Record<string, string> | null>(null);
  const [targets, setTargets] = useState<Map<string, PageTarget>>(new Map());
  const [unmatchedTemplates, setUnmatchedTemplates] = useState<UnmatchedTemplate[]>([]);
  const [statusByPath, setStatusByPath] = useState<Map<string, PageStatusRow>>(new Map());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [building, setBuilding] = useState<Set<string>>(new Set());
  const [origin, setOrigin] = useState(() => window.location.origin);
  const [assetHrefs, setAssetHrefs] = useState<AssetHrefs | null>(null);

  async function reloadStatus() {
    const { pages } = await fetchJson<{ pages: PageStatusRow[] }>(`${path}/api/pages-build`);
    setStatusByPath(new Map(pages.map((p) => [p.path, p])));
  }

  useEffect(() => {
    if (!canBuild) return;
    void (async () => {
      try {
        const [types, tree, hrefs] = await Promise.all([
          listCached(typesApi),
          fetchJson<{ supported: boolean; entries?: TreeEntry[] }>(`${path}/api/pages-source?tree`),
          fetchJson<AssetHrefs>(`${path}/api/asset-hrefs`),
        ]);
        setAllTypes(types);
        setAssetHrefs(hrefs);

        const allEntries = tree.supported && tree.entries ? tree.entries : await listAllFilesRecursive("");
        const files = allEntries.filter((e) => e.kind === "file" && /\.(tsx|ts)$/.test(e.name));
        const sources: Record<string, string> = {};
        await Promise.all(
          files.map(async (file) => {
            sources[file.id] = await fetchText(`${path}/api/pages-source/${toUrlPath(file.id)}`);
          }),
        );
        setSourceByPath(sources);

        const manifest = buildManifestRouteTree(Object.keys(sources));
        const nextTargets = new Map<string, PageTarget>();
        for (const pathname of staticPagePaths(manifest)) {
          const match = matchSourceRoute(manifest, pathname);
          if (match) nextTargets.set(pathname, { pathname, ...match });
        }
        const dynamicTemplates = listDynamicPageTemplates(manifest);
        if (dynamicTemplates.length > 0) {
          const resolutions = await resolveDynamicPages(dynamicTemplates, types, `${path}/api/dry-http`);
          const unmatched: UnmatchedTemplate[] = [];
          for (const resolution of resolutions) {
            if (!resolution.type) {
              unmatched.push({ pathnameTemplate: resolution.template.pathnameTemplate });
              continue;
            }
            for (const page of resolution.pages) nextTargets.set(page.pathname, page);
          }
          setUnmatchedTemplates(unmatched);
        }
        setTargets(nextTargets);

        await reloadStatus();
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "Failed to load pages.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canBuild]);

  const pathnames = useMemo(() => {
    const fromTargets = [...targets.keys()];
    const fromRegistry = [...statusByPath.keys()];
    return [...new Set([...fromTargets, ...fromRegistry])].sort();
  }, [targets, statusByPath]);

  async function buildOne(pathname: string) {
    if (!sourceByPath || !allTypes || !assetHrefs) return;
    const target = targets.get(pathname);
    if (!target) {
      toast.add({ type: "error", title: `"${pathname}" no longer has a page.tsx`, description: "Its source was removed (or a dynamic entry's slug was deleted) - build skipped." });
      return;
    }
    setBuilding((current) => new Set(current).add(pathname));
    try {
      const result = await buildPage({
        pathname,
        origin,
        adminPath: path,
        siteLang: "en",
        assets: {
          globalsCssHref: assetHrefs.globalsCssHref,
          // mục 7's dedicated bootstrap, NOT hydrateEntryHref - see
          // `page-build.ts`'s `PageBuildInput.assets` doc comment for why.
          hydrateEntryHref: assetHrefs.hydrateBuiltHref,
          veiOverlayHref: assetHrefs.veiOverlayHref,
        },
        preactRuntimeHref: assetHrefs.preactRuntimeHref,
        builtAssetsBaseUrl: `${path}/api/built-assets`,
        dryHttpEndpoint: `${path}/api/dry-http`,
        allTypes,
        sourceByPath,
        entryPath: target.entryPath,
        layoutPaths: target.layoutPaths,
        params: target.params,
      });
      await publishBuiltPage(result, { pagesBuildEndpoint: `${path}/api/pages-build`, pathname });
      toast.add({ type: "success", title: `Built "${pathname}"` });
      await reloadStatus();
    } catch (error) {
      const message = error instanceof PageBuildError || error instanceof Error ? error.message : "Build failed.";
      toast.add({ type: "error", title: `Failed to build "${pathname}"`, description: message });
    } finally {
      setBuilding((current) => {
        const next = new Set(current);
        next.delete(pathname);
        return next;
      });
    }
  }

  async function buildAll() {
    for (const pathname of pathnames) await buildOne(pathname);
  }

  const rows: Row[] = pathnames.map((pathname) => {
    const status = statusByPath.get(pathname);
    let state: Row["status"] = "not-built";
    if (status) {
      if (status.staleResource) state = "stale";
      else if (status.publishAt) state = "scheduled";
      else state = "live";
    }
    return { path: pathname, status: state, builtAt: status?.builtAt ?? null, staleResource: status?.staleResource ?? null };
  });

  const columns: DataTableColumn<Row>[] = [
    { key: "path", label: "Path", sortable: true },
    {
      key: "status",
      label: "Status",
      render: (value, row) => {
        const state = value as Row["status"];
        const labels: Record<Row["status"], string> = { "not-built": "Not built", stale: "Stale", scheduled: "Scheduled", live: "Live" };
        const title = state === "stale" && row.staleResource ? `"${row.staleResource}" changed since last build` : undefined;
        return <span class={`badge ${state}`} title={title}>{labels[state]}</span>;
      },
    },
    {
      key: "builtAt",
      label: "Last built",
      render: (value) => <>{value ? new Date(value as number).toLocaleString() : <i class="hint">never</i>}</>,
    },
    {
      key: "path",
      label: "",
      render: (_value, row) => (
        <button type="button" class="sm" disabled={building.has(row.path)} aria-busy={building.has(row.path) || undefined} onClick={() => void buildOne(row.path)}>
          {building.has(row.path) ? "Building…" : "Build"}
        </button>
      ),
    },
  ];

  if (!canBuild) return <span class="error">You don't have permission to build pages.</span>;
  if (loadError) return <span class="error">{loadError}</span>;

  return (
    <>
      <div class="page-header">
        <div style={{ flex: 1 }}>
          <h1>Page Build</h1>
          <p>Compiles and renders `src/apps/pages/**` in this browser tab, then publishes the result (`plans/app-r2.md`).</p>
        </div>
        <div class="row">
          <button type="button" disabled={pathnames.length === 0 || building.size > 0} onClick={() => void buildAll()}>
            Build all
          </button>
        </div>
      </div>

      <section class="card">
        <header>
          <h2>Site origin</h2>
          <p>Used for canonical/og:url tags in built pages - never read from this admin tab's own URL.</p>
        </header>
        <div class="under stack">
          <TextField label="Origin" placeholder="https://example.com" value={origin} onChange={setOrigin} />
        </div>
      </section>

      {unmatchedTemplates.length > 0 && (
        <section class="card">
          <header>
            <h2>Unresolved dynamic routes</h2>
            <p>No content type's `seoUrlPattern` matches these - nothing tells the build which slugs to enumerate (`plans/app-r2.md` mục 4).</p>
          </header>
          <div class="under stack">
            {unmatchedTemplates.map((t) => (
              <span key={t.pathnameTemplate} class="error">{t.pathnameTemplate}</span>
            ))}
          </div>
        </section>
      )}

      <section class="card">
        <header>
          <h2>Pages</h2>
          <p>
            {pathnames.length} {pathnames.length === 1 ? "page" : "pages"} (static + resolved dynamic)
          </p>
        </header>
        <div class="under stack">
          {!sourceByPath && <span class="hint">Loading…</span>}
          {sourceByPath && (
            <DataTable columns={columns} rows={rows} rowKey={(row) => row.path} emptyLabel="No pages found under src/apps/pages/**." />
          )}
        </div>
      </section>
    </>
  );
}
