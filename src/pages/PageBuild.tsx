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
import { buildManifestRouteTree, matchSourceRoute, staticPagePaths } from "../server/app-router/route-manifest.js";
import { buildPage, publishBuiltPage, PageBuildError } from "../page-components/page-build.js";

/**
 * Minimal admin "Build" page (`plans/app-r2.md` mục 11 - a first, real cut,
 * not the full status/stale/progress/resume UI that mục envisions). Lists
 * every STATIC page found under `pagesSourceStorage` (via `route-manifest.ts`,
 * mục 1) next to its current `_pages` status, with a Build button per row
 * that runs the REAL pipeline (`page-build.ts`) client-side and publishes
 * the result. Dynamic (`[slug]`) routes are out of scope here - mục 4
 * (`generateStaticParams`-equivalent) isn't built yet, see
 * `status/app-r2-build.md`.
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
  const [statusByPath, setStatusByPath] = useState<Map<string, PageStatusRow>>(new Map());
  const [loadError, setLoadError] = useState<string | null>(null);
  const [building, setBuilding] = useState<Set<string>>(new Set());
  const [origin, setOrigin] = useState(() => window.location.origin);

  async function reloadStatus() {
    const { pages } = await fetchJson<{ pages: PageStatusRow[] }>(`${path}/api/pages-build`);
    setStatusByPath(new Map(pages.map((p) => [p.path, p])));
  }

  useEffect(() => {
    if (!canBuild) return;
    void (async () => {
      try {
        const [types, tree] = await Promise.all([
          listCached(typesApi),
          fetchJson<{ supported: boolean; entries?: TreeEntry[] }>(`${path}/api/pages-source?tree`),
        ]);
        setAllTypes(types);

        const allEntries = tree.supported && tree.entries ? tree.entries : await listAllFilesRecursive("");
        const files = allEntries.filter((e) => e.kind === "file" && /\.(tsx|ts)$/.test(e.name));
        const sources: Record<string, string> = {};
        await Promise.all(
          files.map(async (file) => {
            sources[file.id] = await fetchText(`${path}/api/pages-source/${toUrlPath(file.id)}`);
          }),
        );
        setSourceByPath(sources);

        await reloadStatus();
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "Failed to load pages.");
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canBuild]);

  const manifestTree = useMemo(() => (sourceByPath ? buildManifestRouteTree(Object.keys(sourceByPath)) : null), [sourceByPath]);
  const pathnames = useMemo(() => {
    if (!manifestTree) return [];
    const fromManifest = staticPagePaths(manifestTree);
    const fromRegistry = [...statusByPath.keys()];
    return [...new Set([...fromManifest, ...fromRegistry])].sort();
  }, [manifestTree, statusByPath]);

  async function buildOne(pathname: string) {
    if (!manifestTree || !sourceByPath || !allTypes) return;
    const match = matchSourceRoute(manifestTree, pathname);
    if (!match) {
      toast.add({ type: "error", title: `"${pathname}" no longer has a page.tsx`, description: "Its source was removed - build skipped." });
      return;
    }
    setBuilding((current) => new Set(current).add(pathname));
    try {
      const result = await buildPage({
        pathname,
        origin,
        adminPath: path,
        siteLang: "en",
        // Placeholder until mục 7 (page.js động + import map) exists - see
        // `page-build.ts`'s `PageBuildInput.assets` doc comment.
        assets: { globalsCssHref: "", hydrateEntryHref: "", veiOverlayHref: "" },
        dryHttpEndpoint: `${path}/api/dry-http`,
        allTypes,
        sourceByPath,
        entryPath: match.entryPath,
        layoutPaths: match.layoutPaths,
        params: match.params,
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

      <section class="card">
        <header>
          <h2>Pages</h2>
          <p>
            {pathnames.length} static {pathnames.length === 1 ? "page" : "pages"}
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
