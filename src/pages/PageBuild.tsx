import { useEffect, useMemo, useRef, useState } from "preact/hooks";
const { path } = window.__DRY_CONFIG__;
import DataTable, { type DataTableColumn } from "../components/DataTable.js";
import { createContentTypesApi, listCached } from "../content-types/http-api.js";
import { PAGE_BUILDER_RESOURCE_ID } from "../content-types/permissions.js";
import type { ContentTypeDefinition } from "../content-types/types.js";
import { authState, canAccess } from "../store/auth.js";
import { toast } from "../components/Toast.js";
import TextField from "../components/fields/TextField.js";
import { useDocumentTitle } from "./page-common.js";
import {
  buildPage,
  canSkipBuild,
  computeSourceHash,
  publishBuiltPage,
  publishBuiltPages,
  resolveAllPageTargets,
  PageBuildError,
  type PageBuildResult,
  type PageTarget,
  type PublishOptions,
  type UnmatchedTemplate,
} from "../page-components/page-build.js";
import { ensureRepoReady, gitState, refreshGitStatus } from "../page-components/git/git-state.js";
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
  sourceHash: string | null;
}

interface Row extends Record<string, unknown> {
  path: string;
  status: "not-built" | "stale" | "live";
  builtAt: number | null;
  /** Why `status` is "stale", for the badge's tooltip - a changed content
   * dependency (`staleResource`) or a source-code change not yet reflected
   * in `PageStatusRow.sourceHash` (e.g. a `git pull` that landed new code
   * this session, see `computeSourceHash`/`sourceHashByPath` below). */
  staleReason: string | null;
}

/** Survives a closed tab (`plans/app-r2.md` mục 11 - "đóng tab giữa chừng
 * là chuyện sẽ xảy ra"): tracks which pathnames this specific run hasn't yet
 * confirmed an outcome for (built OR skipped, see `canSkipBuild`), so a
 * resume doesn't redo work `_pages`/`_page_deps`/`sourceHash` already prove
 * is current. `total` is fixed for the whole run (a resumed run reports
 * progress against the ORIGINAL count, not a shrunk one) - `remaining` is
 * what actually drives both the next batch to build and when the queue is
 * done. */
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

/**
 * Commits + pushes everything sitting in the browser working copy, right
 * after a build has published (`status/git-page-source.md`). This is the ONLY
 * thing that puts page source on GitHub now - a Save writes to the working
 * copy alone, so a build is where local work becomes shared work.
 *
 * Replaces the old server-side snapshot push (`/api/github-sync`), which read
 * `pagesSourceStorage` instead: that store is a derived mirror now, so
 * pushing FROM it could overwrite a newer commit with older bytes.
 *
 * Best-effort, exactly like the snapshot push it replaces: the pages are
 * already published by the time this runs, so a GitHub failure gets its own
 * non-blocking toast rather than turning a successful build into an error.
 */
async function pushWorkingCopy(reason: string): Promise<void> {
  if (gitState.value.phase === "unconfigured") return;
  try {
    const { commitWorkingCopy, resyncWorkingCopy, status } = await import("../page-components/git/git-repo.js");
    const pending = await status();
    if (pending.dirty.length === 0) return;
    const user = authState.value.user;
    const pushed = await commitWorkingCopy(
      path,
      `${reason} - ${pending.dirty.length} ${pending.dirty.length === 1 ? "file" : "files"}`,
      { name: user?.name || "drycms", email: `${user?.id ?? "admin"}@page-builder.drycms` },
    );
    if (!pushed.committed) return;
    await resyncWorkingCopy({ adminPath: path, branch: gitState.value.branch });
    await refreshGitStatus();
  } catch (error) {
    toast.add({ type: "default", title: "Built, but the push failed", description: error instanceof Error ? error.message : undefined });
  }
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
  /** Each target's CURRENT source-closure hash (`computeSourceHash`), kept
   * in sync with `targets`/`sourceByPath` below - lets the Status column
   * catch a page whose CODE changed (e.g. a `git pull`) even though nothing
   * about its content changed `staleResource`. Cheap (a few digests, no real
   * build) so it's fine to recompute on every source/target change. */
  const [sourceHashByPath, setSourceHashByPath] = useState<Map<string, string>>(new Map());

  /** Returns the freshly fetched map (in addition to updating state, for the
   * UI's own reactive `rows`) - `buildAll`/`resumeBuildAll` need the REAL
   * current server state to base skip decisions on, not whatever
   * `statusByPath` a stale render closure happens to hold (a tab left open
   * while content changes elsewhere must never skip a page that actually
   * went stale after this component last rendered). */
  async function reloadStatus(): Promise<Map<string, PageStatusRow>> {
    const { pages } = await fetchJson<{ pages: PageStatusRow[] }>(`${path}/api/pages-build`);
    const next = new Map(pages.map((p) => [p.path, p]));
    setStatusByPath(next);
    return next;
  }

  useEffect(() => {
    if (!canBuild) return;
    void (async () => {
      try {
        // Same source the editor edits, not the HTTP mirror: once a
        // repository is connected, the browser working copy is where a Save
        // lands, and building from anywhere else would publish bytes nobody
        // has seen. Falls back to the HTTP store when no repository is
        // configured (`use-page-builder-source.ts` makes the same choice).
        const loadSource = async () => {
          await ensureRepoReady(path);
          const phase = gitState.value.phase;
          if (phase === "unconfigured") return loadAllPagesSource(path);
          if (phase === "ready" || phase === "diverged") return (await import("../page-components/git/git-repo.js")).readAllSource();
          throw new Error(gitState.value.error ?? "The git working copy is not ready yet.");
        };
        const [types, sources, hrefs] = await Promise.all([
          listCached(typesApi),
          loadSource(),
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

  // Recomputes whenever the loaded source or resolved targets change - a
  // fresh `git pull` (picked up on the next full reload, see `ensureRepoReady`)
  // changes `sourceByPath` without touching `statusByPath`, so this needs its
  // own dependency list rather than piggybacking on `reloadStatus`.
  useEffect(() => {
    if (!sourceByPath || targets.size === 0) return;
    let cancelled = false;
    void (async () => {
      const next = new Map<string, string>();
      for (const [pathname, target] of targets) {
        next.set(pathname, await computeSourceHash(target, sourceByPath));
      }
      if (!cancelled) setSourceHashByPath(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [targets, sourceByPath]);

  /** Compiles (never publishes) one page - shared by `buildOne` below
   * (single-page, publishes immediately) and `runBuildQueue` further down
   * (batches several pages' results into one `publishBuiltPages` call).
   * `"unavailable"` (after its own toast, same as before this was split out)
   * for a target that no longer has a `page.tsx`, or silently while still
   * loading. `"skipped"` when `opts.allowSkip` is set and `canSkipBuild`
   * (`page-build.ts`) says this page's content AND source are both still
   * exactly what its last recorded build produced - the whole point being
   * to decide this BEFORE paying for `buildPage`'s real work (every `dry()`
   * fetch, Tailwind, sucrase). `statusSnapshot` is taken as an explicit
   * parameter rather than read from the `statusByPath` closure - see
   * `reloadStatus`'s own doc comment for why. */
  async function compileOne(
    pathname: string,
    statusSnapshot: Map<string, PageStatusRow>,
    opts: { allowSkip: boolean },
  ): Promise<{ kind: "unavailable" } | { kind: "skipped" } | { kind: "built"; result: PageBuildResult; options: PublishOptions }> {
    if (!sourceByPath || !allTypes || !assetHrefs) return { kind: "unavailable" };
    const target = targets.get(pathname);
    if (!target) {
      toast.add({ type: "error", title: `"${pathname}" no longer has a page.tsx`, description: "Its source was removed (or a dynamic entry's slug was deleted) - build skipped." });
      return { kind: "unavailable" };
    }
    const sourceHash = await computeSourceHash(target, sourceByPath);
    if (opts.allowSkip && canSkipBuild(statusSnapshot.get(pathname), sourceHash)) {
      return { kind: "skipped" };
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
        editLauncherHref: assetHrefs.editLauncherHref,
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
    return { kind: "built", result, options: { pagesBuildEndpoint: `${path}/api/pages-build`, pathname, entryPath: target.entryPath, sourceHash } };
  }

  /** Returns whether the build actually published - the auto-build effect
   * below needs a real success/failure signal per path (to report back to
   * whoever asked for the rebuild), not just the toast this already shows a
   * human for the same outcome. Always `allowSkip: false` - a single "Build"
   * click is a deliberate, explicit request to republish THIS page, kept as
   * a force-rebuild escape hatch (suspected bad live output, manual storage
   * tinkering) regardless of what `canSkipBuild` would say. */
  async function buildOne(pathname: string): Promise<boolean> {
    setBuilding((current) => new Set(current).add(pathname));
    try {
      const compiled = await compileOne(pathname, statusByPath, { allowSkip: false });
      if (compiled.kind === "unavailable") return false;
      if (compiled.kind === "skipped") return true;
      await publishBuiltPage(compiled.result, compiled.options);
      toast.add({ type: "success", title: `Built "${pathname}"` });
      // Publishing one page still makes the working copy's source live, so it
      // pushes too - otherwise the site would serve code that exists only in
      // one browser's IndexedDB.
      await pushWorkingCopy(`Build ${pathname}`);
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
  async function runBuildQueue(queue: string[], total: number, statusSnapshot: Map<string, PageStatusRow>): Promise<void> {
    setResumableQueue(null);
    let remaining = [...queue];
    let batch: { result: PageBuildResult; options: PublishOptions }[] = [];
    let batchPathnames: string[] = [];
    let builtCount = 0;
    let skippedCount = 0;
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
      builtCount += flushedBatch.length;
      await publishBuiltPages(flushedBatch, `${path}/api/pages-build`);
      markDone(flushedPathnames);
      await reloadStatus();
    }

    try {
      for (const pathname of queue) {
        setBuilding((current) => new Set(current).add(pathname));
        try {
          const compiled = await compileOne(pathname, statusSnapshot, { allowSkip: true });
          if (compiled.kind === "built") {
            batch.push({ result: compiled.result, options: compiled.options });
            batchPathnames.push(pathname);
          } else if (compiled.kind === "skipped") {
            skippedCount += 1;
            markDone([pathname]);
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
      toast.add({
        type: "success",
        title:
          skippedCount > 0
            ? `Built ${builtCount} ${builtCount === 1 ? "page" : "pages"} (${skippedCount} already up to date)`
            : `Built ${total} ${total === 1 ? "page" : "pages"}`,
      });
      await pushWorkingCopy(`Build all: ${total} ${total === 1 ? "page" : "pages"}`);
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
    const freshStatus = await reloadStatus();
    await runBuildQueue(queue, queue.length, freshStatus);
  }

  async function resumeBuildAll(): Promise<void> {
    const queue = readPersistedQueue();
    if (!queue) return;
    const freshStatus = await reloadStatus();
    await runBuildQueue(queue.remaining, queue.total, freshStatus);
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
  // trang hiện tại + trang phụ thuộc") - `rebuild-affected-pages.ts`
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
    let staleReason: string | null = null;
    if (status) {
      const currentSourceHash = sourceHashByPath.get(pathname);
      if (status.staleResource) {
        state = "stale";
        staleReason = `"${status.staleResource}" changed since last build`;
      } else if (currentSourceHash && status.sourceHash && currentSourceHash !== status.sourceHash) {
        state = "stale";
        staleReason = "Source code changed since last build";
      } else {
        state = "live";
      }
    }
    return { path: pathname, status: state, builtAt: status?.builtAt ?? null, staleReason };
  });

  const columns: DataTableColumn<Row>[] = [
    { key: "path", label: "Path", sortable: true },
    {
      key: "status",
      label: "Status",
      render: (value, row) => {
        const state = value as Row["status"];
        const labels: Record<Row["status"], string> = { "not-built": "Not built", stale: "Stale", live: "Live" };
        return <span class={`badge ${state}`} title={row.staleReason ?? undefined}>{labels[state]}</span>;
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
          <p>Compiles and renders the live page source in this browser tab, then publishes HTML artifacts (`plans/app-r2.md`).</p>
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
            <p>These pages have no `dry().collection("...").get()` call naming a slug-enabled collection, so nothing tells the build which slugs to enumerate.</p>
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
            <DataTable columns={columns} rows={rows} rowKey={(row) => row.path} emptyLabel="No buildable pages found in the live page source." />
          )}
        </div>
      </section>
    </>
  );
}
