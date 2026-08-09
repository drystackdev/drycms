import { useEffect, useMemo, useRef, useState } from "preact/hooks";
const { path } = window.__DRY_CONFIG__;
import DataTable, { type DataTableColumn } from "../components/DataTable.js";
import { createContentTypesApi, listCached } from "../content-types/http-api.js";
import { PAGE_BUILDER_RESOURCE_ID } from "../content-types/permissions.js";
import type { ContentTypeDefinition } from "../content-types/types.js";
import { canAccess } from "../store/auth.js";
import { toast } from "../components/Toast.js";
import TextField from "../components/fields/TextField.js";
import { useDocumentTitle } from "./page-common.js";
import {
  buildPage,
  publishBuiltPage,
  publishBuiltPages,
  resolveAllPageTargets,
  PageBuildError,
  type PageBuildResult,
  type PageTarget,
  type PublishOptions,
  type UnmatchedTemplate,
} from "../page-components/page-build.js";
import { triggerGithubSync } from "../page-components/github-sync-http-api.js";
import { fetchJson, loadAllPagesSource, type AssetHrefs } from "../page-components/pages-source-http.js";

/**
 * Minimal admin "Build" page (`plans/app-r2.md` mục 11 - a first, real cut,
 * not the full status/stale/progress/resume UI that mục envisions). Lists
 * every page found under `pagesSourceStorage` (via `route-manifest.ts`,
 * mục 1 - static AND dynamic `[slug]` pages, resolved through mục 4's
 * `dynamic-routes.ts`) next to its current `_pages` status, with a Build
 * button per row that runs the REAL pipeline (`page-build.ts`) client-side
 * and publishes the result.
 */

interface PageStatusRow {
  path: string;
  objectKey: string;
  buildId: string;
  builtAt: number;
  inSitemap: boolean;
  staleResource: string | null;
}

interface Row extends Record<string, unknown> {
  path: string;
  status: "not-built" | "stale" | "live";
  builtAt: number | null;
  staleResource: string | null;
}

/** Survives a closed tab (`plans/app-r2.md` mục 11 - "đóng tab giữa chừng
 * là chuyện sẽ xảy ra"): `_pages`/`_page_deps` staleness alone can't drive
 * resume here, because the scenario mục 11 names (editing a shared root
 * `layout.tsx`) is a CODE change, not a content one - every page can still
 * read as "Live" while being built from stale compiled output. `total` is
 * fixed for the whole run (a resumed run reports progress against the
 * ORIGINAL count, not a shrunk one) - `remaining` is what actually drives
 * both the next batch to build and when the queue is done. */
interface PersistedBuildQueue {
  total: number;
  remaining: string[];
}

const BUILD_QUEUE_STORAGE_KEY = "dry-page-build-queue";

function readPersistedQueue(): PersistedBuildQueue | null {
  try {
    const raw = localStorage.getItem(BUILD_QUEUE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedBuildQueue>;
    return Array.isArray(parsed.remaining) && parsed.remaining.length > 0 && typeof parsed.total === "number"
      ? (parsed as PersistedBuildQueue)
      : null;
  } catch {
    return null;
  }
}

function writePersistedQueue(queue: PersistedBuildQueue | null): void {
  if (!queue || queue.remaining.length === 0) localStorage.removeItem(BUILD_QUEUE_STORAGE_KEY);
  else localStorage.setItem(BUILD_QUEUE_STORAGE_KEY, JSON.stringify(queue));
}

export default function PageBuild() {
  useDocumentTitle("Page Build");
  const typesApi = useMemo(() => createContentTypesApi(`${path}/api/content-types`), []);
  const canBuild = canAccess(PAGE_BUILDER_RESOURCE_ID, "setting");

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
  // A queue found in `localStorage` on load - a PREVIOUS "Build all" that
  // never finished (closed tab, crash, network drop). `null` once
  // resumed/discarded/never existed. Progress while a run is ACTIVELY going
  // (fresh or resumed) is separate (`buildAllProgress` below) - the two
  // don't overlap in the UI.
  const [resumableQueue, setResumableQueue] = useState<PersistedBuildQueue | null>(null);
  const [buildAllProgress, setBuildAllProgress] = useState<{ done: number; total: number } | null>(null);

  async function reloadStatus() {
    const { pages } = await fetchJson<{ pages: PageStatusRow[] }>(`${path}/api/pages-build`);
    setStatusByPath(new Map(pages.map((p) => [p.path, p])));
  }

  useEffect(() => {
    if (!canBuild) return;
    void (async () => {
      try {
        const [types, sources, hrefs] = await Promise.all([
          listCached(typesApi),
          loadAllPagesSource(path),
          fetchJson<AssetHrefs>(`${path}/api/asset-hrefs`),
        ]);
        setAllTypes(types);
        setAssetHrefs(hrefs);
        setSourceByPath(sources);

        const { targets: nextTargets, unmatchedTemplates } = await resolveAllPageTargets(sources, types, `${path}/api/dry-http`);
        setTargets(nextTargets);
        setUnmatchedTemplates(unmatchedTemplates);

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

  /** Compiles (never publishes) one page - shared by `buildOne` below
   * (single-page, publishes immediately) and `runBuildQueue` further down
   * (batches several pages' results into one `publishBuiltPages` call).
   * `null` (after its own toast, same as before this was split out) for a
   * target that no longer has a `page.tsx`; silently `null` while still
   * loading, matching what `buildOne` itself always returned there. */
  async function compileOne(pathname: string): Promise<{ result: PageBuildResult; options: PublishOptions } | null> {
    if (!sourceByPath || !allTypes || !assetHrefs) return null;
    const target = targets.get(pathname);
    if (!target) {
      toast.add({ type: "error", title: `"${pathname}" no longer has a page.tsx`, description: "Its source was removed (or a dynamic entry's slug was deleted) - build skipped." });
      return null;
    }
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
    return { result, options: { pagesBuildEndpoint: `${path}/api/pages-build`, pathname } };
  }

  /** Returns whether the build actually published - the auto-build effect
   * below needs a real success/failure signal per path (to report back to
   * whoever asked for the rebuild), not just the toast this already shows a
   * human for the same outcome. */
  async function buildOne(pathname: string): Promise<boolean> {
    setBuilding((current) => new Set(current).add(pathname));
    try {
      const compiled = await compileOne(pathname);
      if (!compiled) return false;
      await publishBuiltPage(compiled.result, compiled.options);
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

  // Several pages' worth of ALREADY-COMPILED results per `publishBuiltPages`
  // call, not one page per HTTP request (mục 11's "Batch PUT lên storage,
  // đừng 500 request rời rạc"). Compiling itself stays sequential either way
  // - it's CPU-bound work in this one tab, nothing to batch there.
  const PUBLISH_BATCH_SIZE = 5;

  /** Drives "Build all" AND its resume: `queue` is exactly what still needs
   * building THIS run (the full page list for a fresh start, or a persisted
   * `remaining` list for a resume) - `total` stays fixed across a resume so
   * the progress counter reads against the ORIGINAL run size, not a shrunk
   * one. Persists `remaining` to `localStorage` after every confirmed
   * outcome (a batch that actually published, or a single page that was
   * skipped/failed and won't be retried) - never optimistically, so a tab
   * closed mid-batch leaves the NEXT resume re-attempting exactly the pages
   * that were never confirmed, not silently dropping them.
   */
  async function runBuildQueue(queue: string[], total: number): Promise<void> {
    setResumableQueue(null);
    let remaining = [...queue];
    let batch: { result: PageBuildResult; options: PublishOptions }[] = [];
    let batchPathnames: string[] = [];
    setBuildAllProgress({ done: total - remaining.length, total });

    function markDone(donePathnames: string[]): void {
      remaining = remaining.filter((p) => !donePathnames.includes(p));
      writePersistedQueue(remaining.length > 0 ? { total, remaining } : null);
      setBuildAllProgress({ done: total - remaining.length, total });
    }

    // Not caught internally - a publish failure here (network drop, server
    // error) propagates to the outer try/catch below, which stops the whole
    // run and leaves whatever `markDone` already confirmed as the resume
    // point. `batch`/`batchPathnames` are cleared BEFORE the request, not
    // after - a page that fails to publish must not silently vanish from
    // `remaining` just because it was already queued for this flush.
    async function flush(): Promise<void> {
      if (batch.length === 0) return;
      const flushedBatch = batch;
      const flushedPathnames = batchPathnames;
      batch = [];
      batchPathnames = [];
      await publishBuiltPages(flushedBatch, `${path}/api/pages-build`);
      markDone(flushedPathnames);
      await reloadStatus();
    }

    try {
      for (const pathname of queue) {
        setBuilding((current) => new Set(current).add(pathname));
        try {
          const compiled = await compileOne(pathname);
          if (compiled) {
            batch.push(compiled);
            batchPathnames.push(pathname);
          } else {
            // `compileOne` already toasted (missing target) or is silently
            // skipping (not ready yet) - either way, not retried on resume.
            markDone([pathname]);
          }
        } catch (error) {
          const message = error instanceof PageBuildError || error instanceof Error ? error.message : "Build failed.";
          toast.add({ type: "error", title: `Failed to build "${pathname}"`, description: message });
          markDone([pathname]);
        } finally {
          setBuilding((current) => {
            const next = new Set(current);
            next.delete(pathname);
            return next;
          });
        }
        if (batch.length >= PUBLISH_BATCH_SIZE) await flush();
      }
      await flush();
      toast.add({ type: "success", title: `Built ${total} ${total === 1 ? "page" : "pages"}` });
      // Snapshot-commits the WHOLE pages-source tree to GitHub exactly ONCE,
      // after the whole queue (a fresh run or a resume) is fully done - not
      // per batch, so a resumed/interrupted run still produces a single
      // coherent commit rather than several partial ones. Best-effort, same
      // as `PageEditor.tsx`'s own `reportGithubSync`: a real failure gets its
      // own separate, non-blocking toast, "not configured" stays silent.
      const githubSync = await triggerGithubSync(`${path}/api/github-sync`, `Build all: ${total} pages - ${new Date().toISOString()}`);
      if (!githubSync.pushed && githubSync.reason && githubSync.reason !== "not-configured") {
        toast.add({ type: "default", title: "Built, but GitHub sync failed", description: githubSync.reason });
      }
    } catch (error) {
      const message = error instanceof PageBuildError || error instanceof Error ? error.message : "Publishing failed.";
      toast.add({ type: "error", title: "Build all interrupted", description: `${message} - click "Build all" again to resume.` });
      setResumableQueue(readPersistedQueue());
    } finally {
      setBuildAllProgress(null);
    }
  }

  async function buildAll(): Promise<void> {
    const queue = [...pathnames];
    if (queue.length === 0) return;
    writePersistedQueue({ total: queue.length, remaining: queue });
    await runBuildQueue(queue, queue.length);
  }

  async function resumeBuildAll(): Promise<void> {
    const queue = readPersistedQueue();
    if (!queue) return;
    await runBuildQueue(queue.remaining, queue.total);
  }

  function discardBuildQueue(): void {
    writePersistedQueue(null);
    setResumableQueue(null);
  }

  // Surfaces an interrupted run left over from a previous visit - checked
  // once loading finishes (matches `ready`'s own "distinct from empty data"
  // reasoning), not on every render.
  useEffect(() => {
    if (!ready) return;
    setResumableQueue(readPersistedQueue());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

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

  const rows: Row[] = pathnames.map((pathname) => {
    const status = statusByPath.get(pathname);
    let state: Row["status"] = "not-built";
    if (status) {
      if (status.staleResource) state = "stale";
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
        const labels: Record<Row["status"], string> = { "not-built": "Not built", stale: "Stale", live: "Live" };
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
        <button type="button" class="sm" disabled={building.has(row.path) || buildAllProgress !== null} aria-busy={building.has(row.path) || undefined} onClick={() => void buildOne(row.path)}>
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
          <button type="button" disabled={pathnames.length === 0 || building.size > 0 || buildAllProgress !== null} aria-busy={buildAllProgress !== null || undefined} onClick={() => void buildAll()}>
            {buildAllProgress ? `Building… (${buildAllProgress.done}/${buildAllProgress.total})` : "Build all"}
          </button>
        </div>
      </div>

      {resumableQueue && buildAllProgress === null && (
        <section class="card">
          <header>
            <h2>Interrupted build</h2>
            <p>
              A previous "Build all" didn't finish - {resumableQueue.remaining.length} of {resumableQueue.total} pages
              still need building (closed tab, lost connection, or a crash).
            </p>
          </header>
          <div class="under row">
            <button type="button" onClick={() => void resumeBuildAll()}>Resume</button>
            <button type="button" class="ghost" onClick={discardBuildQueue}>Discard</button>
          </div>
        </section>
      )}

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
