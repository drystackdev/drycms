import { useEffect, useMemo, useRef, useState } from "preact/hooks";
const { path } = window.__DRY_CONFIG__;
import DataTable, { type DataTableColumn } from "../components/DataTable.js";
import { createContentTypesApi, listCached } from "../content-types/http-api.js";
import { createContentEntriesApi } from "../content-types/entries-http-api.js";
import { SYSTEM_BUILD_RESOURCE_ID } from "../content-types/permissions.js";
import type { ContentTypeDefinition } from "../content-types/types.js";
import { canAccess } from "../store/auth.js";
import { toast } from "../components/Toast.js";
import TextField from "../components/fields/TextField.js";
import NumberField from "../components/fields/NumberField.js";
import { parseScheduleFlipIntervalMinutes, DEFAULT_SCHEDULE_FLIP_INTERVAL_MINUTES } from "../lib/schedule-flip-setting.js";
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
  // Same singleton `Settings.tsx` edits (`systemSettings`), just a
  // different field of its `data` blob - `scheduleFlipIntervalMinutes`
  // isn't a theme value, so it doesn't belong on that page, but it's
  // still gated by that TYPE's own edit permission, not `system-build`'s
  // (see `canEditSchedule` below) - `system-build` only covers building/
  // publishing pages, not editing an unrelated singleton.
  const systemSettingsApi = useMemo(() => createContentEntriesApi(`${path}/api/content`, "systemSettings"), []);
  const canBuild = canAccess(SYSTEM_BUILD_RESOURCE_ID, "setting");

  const [allTypes, setAllTypes] = useState<ContentTypeDefinition[] | null>(null);
  const [sourceByPath, setSourceByPath] = useState<Record<string, string> | null>(null);
  const [targets, setTargets] = useState<Map<string, PageTarget>>(new Map());
  const [unmatchedTemplates, setUnmatchedTemplates] = useState<UnmatchedTemplate[]>([]);
  const [statusByPath, setStatusByPath] = useState<Map<string, PageStatusRow>>(new Map());
  const [loadError, setLoadError] = useState<string | null>(null);
  // Flips once after the load effect below finishes (success OR failure) -
  // the auto-build effect needs a signal distinct from "sourceByPath/targets
  // are non-empty", since a project with zero buildable pages would never
  // otherwise tell "still loading" apart from "loaded, nothing to build".
  const [ready, setReady] = useState(false);
  const [building, setBuilding] = useState<Set<string>>(new Set());
  const [origin, setOrigin] = useState(() => window.location.origin);
  const [assetHrefs, setAssetHrefs] = useState<AssetHrefs | null>(null);

  const [scheduleType, setScheduleType] = useState<ContentTypeDefinition | null>(null);
  const [scheduleIntervalMinutes, setScheduleIntervalMinutes] = useState<number | null>(null);
  const [scheduleIntervalInitial, setScheduleIntervalInitial] = useState<number | null>(null);
  // Everything else already in `systemSettings.data` (Settings.tsx's theme
  // keys) - saving here spreads onto this rather than replacing `data`
  // outright, same fix `Settings.tsx`'s own save just got (found while
  // building this: without it, whichever of these two pages saves LAST
  // would silently wipe out the other's field).
  const [scheduleOtherData, setScheduleOtherData] = useState<Record<string, unknown>>({});
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const canEditSchedule = !!scheduleType && canAccess(scheduleType.id, "setting");
  const scheduleDirty = scheduleIntervalInitial !== null && scheduleIntervalMinutes !== null && scheduleIntervalMinutes !== scheduleIntervalInitial;

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

        const settingsType = types.find((t) => t.name === "systemSettings") ?? null;
        setScheduleType(settingsType);
        if (settingsType && canAccess(settingsType.id, "setting")) {
          const entry = await systemSettingsApi.getSingleton();
          const raw = entry?.value.data;
          let stored: Record<string, unknown> = {};
          if (typeof raw === "string" && raw) {
            try {
              const parsed: unknown = JSON.parse(raw);
              if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) stored = parsed as Record<string, unknown>;
            } catch {
              // Same "fall back to defaults, don't throw" spirit
              // `parseScheduleFlipIntervalMinutes` uses for the field
              // itself - a malformed blob shouldn't fail the whole page.
            }
          }
          setScheduleOtherData(stored);
          const interval = parseScheduleFlipIntervalMinutes(raw);
          setScheduleIntervalMinutes(interval);
          setScheduleIntervalInitial(interval);
        }

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
      } finally {
        setReady(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canBuild]);

  const pathnames = useMemo(() => {
    const fromTargets = [...targets.keys()];
    const fromRegistry = [...statusByPath.keys()];
    return [...new Set([...fromTargets, ...fromRegistry])].sort();
  }, [targets, statusByPath]);

  /** Returns whether the build actually published - the auto-build effect
   * below needs a real success/failure signal per path (to report back to
   * whoever asked for the rebuild), not just the toast this already shows a
   * human for the same outcome. */
  async function buildOne(pathname: string): Promise<boolean> {
    if (!sourceByPath || !allTypes || !assetHrefs) return false;
    const target = targets.get(pathname);
    if (!target) {
      toast.add({ type: "error", title: `"${pathname}" no longer has a page.tsx`, description: "Its source was removed (or a dynamic entry's slug was deleted) - build skipped." });
      return false;
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
      return true;
    } catch (error) {
      const message = error instanceof PageBuildError || error instanceof Error ? error.message : "Build failed.";
      toast.add({ type: "error", title: `Failed to build "${pathname}"`, description: message });
      return false;
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

  // Headless rebuild trigger (mục 12's "Sau saveAll() thì chạy build cho
  // trang hiện tại + trang phụ thuộc") - `overlay.ts`'s `rebuildAffectedPages`
  // points a hidden iframe at this same page with `?autoBuild=/a,/b` instead
  // of reimplementing the load-targets-and-compile pipeline a second time
  // for a public-site bundle that has no business importing Sucrase/Tailwind.
  // Guarded by `ranAutoBuild` so a later, unrelated re-render (e.g. `origin`
  // changing) can never replay it.
  const ranAutoBuild = useRef(false);
  useEffect(() => {
    if (!ready || ranAutoBuild.current) return;
    const requested = new URLSearchParams(window.location.search).get("autoBuild");
    if (!requested) return;
    ranAutoBuild.current = true;
    void (async () => {
      const built: string[] = [];
      const failed: string[] = [];
      for (const pathname of requested.split(",").filter(Boolean)) {
        if (await buildOne(pathname)) built.push(pathname);
        else failed.push(pathname);
      }
      if (window.parent !== window) {
        window.parent.postMessage(
          { type: "vei:build-done", ok: failed.length === 0, built, failed },
          window.location.origin,
        );
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  async function saveScheduleInterval() {
    if (scheduleIntervalMinutes === null) return;
    setScheduleSaving(true);
    try {
      // Spread onto `scheduleOtherData`, not a bare `{scheduleFlipIntervalMinutes}`
      // - see that state's own doc comment.
      await systemSettingsApi.saveSingleton({
        data: JSON.stringify({ ...scheduleOtherData, scheduleFlipIntervalMinutes: scheduleIntervalMinutes }),
      });
      setScheduleIntervalInitial(scheduleIntervalMinutes);
      toast.add({ type: "success", title: "Publish schedule saved." });
    } catch (error) {
      toast.add({ type: "error", title: "Save failed", description: error instanceof Error ? error.message : undefined });
    } finally {
      setScheduleSaving(false);
    }
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

      {canEditSchedule && scheduleIntervalMinutes !== null && (
        <section class="card">
          <header>
            <h2>Publish schedule</h2>
            <p>
              How often a scheduled page (a future publish date, set when it was built) actually goes live. The
              underlying check runs every 15 minutes no matter what - setting this below 15 has no effect without
              editing `wrangler.jsonc`'s cron trigger and redeploying.
            </p>
          </header>
          <div class="under stack">
            <NumberField
              label={`Interval (minutes) - default ${DEFAULT_SCHEDULE_FLIP_INTERVAL_MINUTES}`}
              value={scheduleIntervalMinutes}
              min={15}
              onChange={setScheduleIntervalMinutes}
            />
            {scheduleDirty && (
              <button type="button" disabled={scheduleSaving} aria-busy={scheduleSaving || undefined} onClick={() => void saveScheduleInterval()}>
                Save
              </button>
            )}
          </div>
        </section>
      )}

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
