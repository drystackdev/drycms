import { useEffect, useMemo, useRef, useState } from "preact/hooks";
const { path } = window.__DRY_CONFIG__;
import ConfirmDialog from "../components/ConfirmDialog.js";
import Editer from "../components/Editer.js";
import type { EditerResult } from "../components/Editer/types.js";
import { MenuIcon } from "../components/icons/index.js";
import { toast } from "../components/Toast.js";
import { useScaledPreview } from "./page-components/useDevicePreview.js";
import { useResizablePanel } from "../lib/useResizablePanel.js";
import { rewriteImportsAfterMove } from "../page-components/import-rewrite.js";
import { createPagesSourceApi } from "../page-components/pages-source-http-api.js";
import { buildPage, PageBuildError } from "../page-components/page-build.js";
import { buildManifestRouteTree, matchSourceRoute, staticPagePaths } from "../server/app-router/route-manifest.js";
import { createContentTypesApi, listCached } from "../content-types/http-api.js";
import { CODE_EDITOR_RESOURCE_ID } from "../content-types/permissions.js";
import type { ContentTypeDefinition } from "../content-types/types.js";
import type { FileEntry } from "../storage/entry-types.js";
import { canAccess } from "../store/auth.js";
import ComponentTreePanel from "./page-components/ComponentTreePanel.js";
import { useDocumentTitle } from "./page-common.js";

/**
 * In-browser page/layout/component source editor (`plans/app-r2.md` Giai
 * đoạn 6 - the last unbuilt piece of "sửa code trong browser"; the storage
 * plumbing (`pagesSourceStorage`, `routes/pages-source.ts`'s write methods,
 * `sync-pages-r2.ts`) already existed). Deliberately its own page, gated on
 * `system-code` rather than folded into `PageBuild.tsx` (`system-build`) -
 * quyết định #12: a role that can rebuild pages shouldn't automatically be
 * able to change what code runs.
 *
 * Structurally a near-clone of `PageComponents.tsx` (same tree panel, same
 * `Editer` wiring, same create/delete/move flow - `ComponentTreePanel`
 * needed zero changes to be reused here) with ONE real addition: a live
 * preview pane that runs the REAL build pipeline (`buildPage()`, the exact
 * function `PageBuild.tsx`'s "Build" button calls) against the CURRENTLY
 * EDITED, not-yet-saved source, and renders the resulting HTML into an
 * iframe via `srcdoc` - never `publishBuiltPage`, so nothing here ever
 * touches `built/live/*` or `_pages`. Only available when the selected file
 * is itself a `page.tsx` matching a real static route - resolving which
 * page(s) a `layout.tsx` or a shared component affects is unbuilt (a
 * `page.tsx` maps to exactly one page target this simply; a shared file
 * doesn't).
 */

const DEFAULT_PAGE_SOURCE = `export default function Page() {
  return <div></div>;
}
`;

/** Never a real file - a key `refreshPreview` injects into its own LOCAL
 * copy of `sourceByPath` (never the state, never storage) when previewing a
 * `layout.tsx` directly, standing in for "whatever page would actually
 * render inside this layout" so the layout's own chrome (nav/footer/
 * wrapping structure) is visible without needing a real page to anchor the
 * preview to. */
const LAYOUT_PLACEHOLDER_PATH = "__dry-preview-layout-placeholder.tsx";
const LAYOUT_PLACEHOLDER_SOURCE = `export default function PreviewPlaceholder() {
  return (
    <div style="padding:3rem 1.5rem;margin:1rem;text-align:center;background:#fef3c7;border:2px dashed #d97706;border-radius:0.5rem;color:#92400e;font:600 14px/1.5 system-ui,sans-serif;">
      Page content renders here
    </div>
  );
}
`;

/** `routes/asset-hrefs.ts`'s response shape - same as `PageBuild.tsx`'s own
 * local copy (not shared - both are small, page-local types). */
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

function toUrlPath(relativePath: string): string {
  return relativePath.split("/").map(encodeURIComponent).join("/");
}

/** Same `?tree`-unsupported (R2/S3) fallback `PageBuild.tsx` uses, but
 * keeping the FULL `FileEntry` (`parentId` etc), not `PageBuild.tsx`'s own
 * minimal id/name/kind-only walk - `ComponentTreePanel` (reused below)
 * needs `parentId` to build a correct nested tree out of a flat list. */
async function listAllFileEntriesRecursive(folder: string): Promise<FileEntry[]> {
  const url = folder === "" ? `${path}/api/pages-source` : `${path}/api/pages-source/${toUrlPath(folder)}`;
  const { entries } = await fetchJson<{ path: string; entries: FileEntry[] }>(url);
  const all: FileEntry[] = [];
  for (const entry of entries) {
    all.push(entry);
    if (entry.kind === "folder") all.push(...(await listAllFileEntriesRecursive(entry.id)));
  }
  return all;
}

const SIDEBAR_WIDTH = { initial: 280, min: 200, max: 480 };
const PREVIEW_WIDTH = { initial: 480, min: 280, max: 900 };

/** Viewport presets for the preview column's responsive toolbar - `sm`/`md`/
 * `lg`/`xl` match Tailwind's own default breakpoints (meaningful for
 * previewing THIS site's own Tailwind classes), `xs` added below them for a
 * small-phone width Tailwind itself has no named breakpoint for. */
type ViewportKey = "xs" | "sm" | "md" | "lg" | "xl";
const VIEWPORT_WIDTHS: Record<ViewportKey, number> = { xs: 375, sm: 640, md: 768, lg: 1024, xl: 1280 };
const VIEWPORT_KEYS: ViewportKey[] = ["xs", "sm", "md", "lg", "xl"];

export default function PageEditor() {
  useDocumentTitle("Page Code Editor");
  const canEdit = canAccess(CODE_EDITOR_RESOURCE_ID, "setting");
  const api = useMemo(() => createPagesSourceApi(`${path}/api/pages-source`), []);
  const typesApi = useMemo(() => createContentTypesApi(`${path}/api/content-types`), []);

  const [entries, setEntries] = useState<FileEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sourceByPath, setSourceByPath] = useState<Record<string, string>>({});
  const [savedByPath, setSavedByPath] = useState<Record<string, string>>({});
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<FileEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [previewOpen, setPreviewOpen] = useState(true);

  const [allTypes, setAllTypes] = useState<ContentTypeDefinition[] | null>(null);
  const [assetHrefs, setAssetHrefs] = useState<AssetHrefs | null>(null);
  const [dryTypes, setDryTypes] = useState<string | null>(null);
  const [origin] = useState(() => window.location.origin);

  const sidebar = useResizablePanel({ ...SIDEBAR_WIDTH, axis: "x" });
  const previewSplit = useResizablePanel({ ...PREVIEW_WIDTH, axis: "x" });
  const viewport = useScaledPreview<ViewportKey>(VIEWPORT_WIDTHS, "lg");

  async function loadTree() {
    try {
      const result = await api.listTree();
      const all = result.supported ? result.entries : await listAllFileEntriesRecursive("");
      setEntries(all);
      const files = all.filter((entry) => entry.kind === "file" && /\.tsx?$/i.test(entry.name));
      const contents = await Promise.all(files.map((file) => api.read(file.id).catch(() => "")));
      const nextSource: Record<string, string> = {};
      files.forEach((file, index) => {
        nextSource[file.id] = contents[index]!;
      });
      setSourceByPath(nextSource);
      setSavedByPath(nextSource);
      setSelectedPath((current) => {
        if (current && nextSource[current] !== undefined) return current;
        return files.length > 0 ? files[0]!.id : null;
      });
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to load pages source.");
    }
  }

  useEffect(() => {
    if (!canEdit) return;
    void loadTree();
    void (async () => {
      try {
        const [types, hrefs] = await Promise.all([listCached(typesApi), fetchJson<AssetHrefs>(`${path}/api/asset-hrefs`)]);
        setAllTypes(types);
        setAssetHrefs(hrefs);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "Failed to load build context.");
      }
    })();
    // Best-effort, separate from the block above: a missing/failed
    // `dry.generated.d.ts` fetch shouldn't block loading the tree or the
    // build context that preview actually needs - it only means `dry()`
    // shows as an untyped/unrecognized global until it resolves, same
    // degraded-but-usable spirit as `dev-server.mjs`'s own "never fatal"
    // codegen step.
    void fetch(`${path}/api/types-cache`, { credentials: "same-origin" })
      .then((response) => (response.ok ? response.text() : null))
      .then((text) => setDryTypes(text))
      .catch(() => setDryTypes(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit]);

  const code = selectedPath ? (sourceByPath[selectedPath] ?? "") : "";
  const dirty = !!selectedPath && sourceByPath[selectedPath] !== savedByPath[selectedPath];

  /** Every OTHER loaded file, PLUS `dry.generated.d.ts` (`routes/types-cache.ts`
   * - already built for exactly this, in an earlier session, but never
   * actually wired up until now) - `Editer`'s ambient reference set for
   * cross-file TS resolution (same role as `PageComponents.tsx`'s own).
   * `dry`/`params`/`setTitle`/`dryBind` are ambient GLOBALS
   * (`dry.generated.d.ts`'s own `declare global` block, never imported by
   * real page/layout source - see `page-build.ts`'s `evalModule` doc
   * comment), so simply being part of the TS program here (any key works,
   * nothing ever imports it BY that key) is enough for the language service
   * to recognize them - real type errors on every `dry()`/`params()` call
   * disappear, and typing `dry().collection("` now offers the site's actual
   * collection names, both through the SAME `tsCompletionSource` pipeline
   * every other completion already goes through, no bespoke completion
   * source needed. */
  const extraFiles = useMemo(() => {
    const rest = { ...sourceByPath };
    if (selectedPath) delete rest[selectedPath];
    if (dryTypes) rest["dry.generated.d.ts"] = dryTypes;
    return rest;
  }, [sourceByPath, selectedPath, dryTypes]);

  function handleChange(result: EditerResult) {
    if (!selectedPath) return;
    setSourceByPath((prev) => (prev[selectedPath] === result.code ? prev : { ...prev, [selectedPath]: result.code }));
  }

  async function handleSave() {
    if (!selectedPath) return;
    setSaving(true);
    try {
      await api.save(selectedPath, sourceByPath[selectedPath] ?? "");
      setSavedByPath((prev) => ({ ...prev, [selectedPath]: sourceByPath[selectedPath] ?? "" }));
      toast.add({ type: "success", title: "Saved.", description: "Build the affected page on Page Build to publish this change." });
    } catch (error) {
      toast.add({ type: "error", title: "Save failed", description: error instanceof Error ? error.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateFile(name: string) {
    const filePath = /\.tsx?$/i.test(name) ? name : `${name}.tsx`;
    try {
      await api.save(filePath, DEFAULT_PAGE_SOURCE);
      await loadTree();
      setSelectedPath(filePath);
      toast.add({ type: "success", title: `Created "${filePath}".` });
    } catch (error) {
      toast.add({ type: "error", title: "Failed to create file", description: error instanceof Error ? error.message : undefined });
    }
  }

  async function handleCreateFolder(name: string) {
    try {
      const segments = name.split("/");
      const leaf = segments.pop()!;
      await api.mkdir(segments.join("/"), leaf);
      await loadTree();
      toast.add({ type: "success", title: `Created folder "${name}".` });
    } catch (error) {
      toast.add({ type: "error", title: "Failed to create folder", description: error instanceof Error ? error.message : undefined });
    }
  }

  async function handleDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api.remove(pendingDelete.id);
      if (selectedPath === pendingDelete.id) setSelectedPath(null);
      setPendingDelete(null);
      await loadTree();
      toast.add({ type: "success", title: "Deleted." });
    } catch (error) {
      toast.add({ type: "error", title: "Delete failed", description: error instanceof Error ? error.message : undefined });
    } finally {
      setDeleting(false);
    }
  }

  /** Move (rename or drag into another folder) - also recomputes any
   * relative import affected by the path change, same as
   * `PageComponents.tsx`'s own `handleMove`. */
  async function handleMove(from: string, to: string) {
    if (from === to) return;
    try {
      const rewrites = rewriteImportsAfterMove(sourceByPath, from, to);
      await api.move(from, to);
      if (rewrites[to] !== undefined) await api.save(to, rewrites[to]);
      for (const [otherPath, content] of Object.entries(rewrites)) {
        if (otherPath !== to) await api.save(otherPath, content);
      }
      if (selectedPath === from) setSelectedPath(to);
      await loadTree();
      toast.add({ type: "success", title: `Moved to "${to}".` });
    } catch (error) {
      toast.add({ type: "error", title: "Move failed", description: error instanceof Error ? error.message : undefined });
    }
  }

  // --- Live preview: real pipeline, never published (`plans/app-r2.md`) ---
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [previewLabel, setPreviewLabel] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  /** Guards against out-of-order resolution - found LIVE (not in review): 2
   * edits close enough together (inside `buildPage()`'s own in-flight time,
   * not just inside the debounce window below) start 2 overlapping
   * `refreshPreview()` calls, and without this, whichever happens to
   * RESOLVE last wins the iframe regardless of which one actually started
   * last - an older, slower build could silently overwrite a newer one's
   * correct result. Same `sigSeq` token pattern `Editer.tsx`'s own
   * `checkSignatureHelp` already uses for the identical race. */
  const previewSeqRef = useRef(0);

  const manifest = useMemo(() => buildManifestRouteTree(Object.keys(sourceByPath)), [sourceByPath]);

  interface PreviewTarget {
    /** Shown in the preview header - a real pathname for a page, a
     * descriptive label for anything else. */
    label: string;
    /** Canonical-URL input to `buildPage()` - real for a page, a harmless
     * placeholder for the other 3 kinds (never surfaced to a visitor
     * either way - this build is never published). */
    pathname: string;
    entryPath: string;
    layoutPaths: string[];
    params: Record<string, string | string[]>;
    /** A synthetic, in-memory-only page source `refreshPreview` merges
     * into its OWN copy of `sourceByPath` before calling `buildPage` -
     * never written to `sourceByPath` state, `extraFiles`, or storage.
     * Only set when previewing a `layout.tsx` directly (see
     * `LAYOUT_PLACEHOLDER_PATH`'s doc comment). */
    extraSource?: { path: string; source: string };
  }

  /** Every `layout.tsx` from the tree root down to (and including) the one
   * at `layoutPath` - `route-manifest.ts`'s tree has no parent pointers to
   * walk "up" from a folder, so this re-derives the chain from the path
   * string itself: for each prefix of `layoutPath`'s own folder segments
   * (root first), keep it if a `layout.tsx` actually exists there. Always
   * ends with `layoutPath` itself (it exists by construction - the caller
   * just selected it). */
  function ancestorLayoutChain(layoutPath: string, source: Record<string, string>): string[] {
    const folder = layoutPath.slice(0, layoutPath.length - "layout.tsx".length).replace(/\/$/, "");
    const segments = folder ? folder.split("/") : [];
    const chain: string[] = [];
    for (let i = 0; i <= segments.length; i++) {
      const prefix = segments.slice(0, i).join("/");
      const candidate = prefix ? `${prefix}/layout.tsx` : "layout.tsx";
      if (source[candidate] !== undefined) chain.push(candidate);
    }
    return chain;
  }

  /** Only when the SELECTED file is itself a `page.tsx` matching a real
   * static route - see this file's own doc comment for why a shared
   * component isn't resolved to "whichever pages use it". A `layout.tsx`
   * previews wrapped around a placeholder child (there's no single "the"
   * page it belongs to); `404.tsx`/`500.tsx` preview standalone, same "no
   * layouts" shape `render.ts`'s own `renderErrorHtml` fallback uses for
   * them at request time. */
  const previewTarget = useMemo<PreviewTarget | null>(() => {
    if (!selectedPath) return null;
    if (/(^|\/)page\.tsx$/.test(selectedPath)) {
      for (const pathname of staticPagePaths(manifest)) {
        const match = matchSourceRoute(manifest, pathname);
        if (match && match.entryPath === selectedPath) {
          return { label: pathname, pathname, entryPath: match.entryPath, layoutPaths: match.layoutPaths, params: {} };
        }
      }
      return null;
    }
    if (/(^|\/)layout\.tsx$/.test(selectedPath)) {
      return {
        label: `${selectedPath} (placeholder page content)`,
        pathname: "/__dry-preview-layout",
        entryPath: LAYOUT_PLACEHOLDER_PATH,
        layoutPaths: ancestorLayoutChain(selectedPath, sourceByPath),
        params: {},
        extraSource: { path: LAYOUT_PLACEHOLDER_PATH, source: LAYOUT_PLACEHOLDER_SOURCE },
      };
    }
    if (selectedPath === "404.tsx") {
      return { label: "404.tsx", pathname: "/__dry-preview-404", entryPath: "404.tsx", layoutPaths: [], params: {} };
    }
    if (selectedPath === "500.tsx") {
      return { label: "500.tsx", pathname: "/__dry-preview-500", entryPath: "500.tsx", layoutPaths: [], params: {} };
    }
    return null;
  }, [manifest, selectedPath, sourceByPath]);

  async function refreshPreview() {
    if (!previewTarget || !allTypes || !assetHrefs) return;
    const seq = ++previewSeqRef.current;
    setPreviewLoading(true);
    setPreviewError(null);
    try {
      // Merged locally, never into `sourceByPath` state - see
      // `LAYOUT_PLACEHOLDER_PATH`'s doc comment.
      const buildSourceByPath = previewTarget.extraSource
        ? { ...sourceByPath, [previewTarget.extraSource.path]: previewTarget.extraSource.source }
        : sourceByPath;
      const result = await buildPage({
        pathname: previewTarget.pathname,
        origin,
        adminPath: path,
        siteLang: "en",
        assets: {
          globalsCssHref: assetHrefs.globalsCssHref,
          hydrateEntryHref: assetHrefs.hydrateBuiltHref,
          veiOverlayHref: assetHrefs.veiOverlayHref,
        },
        preactRuntimeHref: assetHrefs.preactRuntimeHref,
        builtAssetsBaseUrl: `${path}/api/built-assets`,
        dryHttpEndpoint: `${path}/api/dry-http`,
        allTypes,
        sourceByPath: buildSourceByPath,
        entryPath: previewTarget.entryPath,
        layoutPaths: previewTarget.layoutPaths,
        params: previewTarget.params,
      });
      if (seq !== previewSeqRef.current) return; // a newer edit already started another build - discard this stale result
      // Root-relative asset URLs in `result.html` (`/assets/...`) need a
      // real origin to resolve against - an `about:srcdoc` iframe has none
      // of its own. Real inlined CSS, real `dry()` data - NOT real
      // hydration though, found live: the embedded manifest points
      // `hydrate-built.ts` at `${builtAssetsBaseUrl}/page.js`, which is
      // whatever a real "Build" click on Page Build last PUBLISHED - not
      // this in-browser, unpublished preview's own fresher compile
      // (`result.jsAssets`, deliberately never written anywhere here - see
      // this component's own doc comment on never calling
      // `publishBuiltPage`). Left in, hydration would silently overwrite
      // the correct freshly-SSR'd preview with that stale published
      // version the instant it finishes. Stripping the manifest here
      // instead of fixing the mismatch - `hydrate-built.ts` already
      // no-ops gracefully with none present (mục 7's own "static page, no
      // islands" case) - falls back to a real, accurate STATIC render;
      // making interactive islands work in the preview too is a follow-up
      // (`status/app-r2-build.md`), not solved by this pass.
      const withoutHydration = result.html.replace(/<script type="application\/json" id="dry-hydrate-(?:manifest|params)">[\s\S]*?<\/script>/g, "");
      // The VEI overlay script (`assets.veiOverlayHref`, embedded by
      // `buildDocument` on every page unconditionally) checks the admin's
      // OWN `drycms_admin` hint cookie and, since whoever is using this
      // editor is signed in, renders its "Edit content" button here too -
      // but clicking it inside a detached `srcdoc` preview (no real route,
      // no server round trip possible) does nothing useful. Stripped by its
      // known href rather than a generic pattern - `assetHrefs` already has
      // the exact URL this build just used.
      const withoutVei = assetHrefs
        ? withoutHydration.replace(`<script type="module" src="${assetHrefs.veiOverlayHref}"></script>`, "")
        : withoutHydration;
      const withBase = withoutVei.replace("<head>", `<head><base href="${origin}/">`);
      if (iframeRef.current) iframeRef.current.srcdoc = withBase;
      setPreviewLabel(previewTarget.label);
    } catch (error) {
      if (seq !== previewSeqRef.current) return;
      setPreviewError(error instanceof PageBuildError || error instanceof Error ? error.message : "Preview failed.");
    } finally {
      if (seq === previewSeqRef.current) setPreviewLoading(false);
    }
  }

  // Debounced re-preview on every edit to ANY loaded file (not just the
  // selected one - a layout/shared component the target page depends on
  // matters too, and computing the precise dependency set isn't worth it
  // here) - `refreshPreview` never calls `publishBuiltPage`, so this costs
  // nothing beyond an in-browser compile+render+Tailwind pass per pause in
  // typing.
  useEffect(() => {
    if (!previewTarget) {
      setPreviewLabel(null);
      return;
    }
    const timer = setTimeout(() => void refreshPreview(), 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewTarget?.label, sourceByPath, allTypes, assetHrefs, origin]);

  if (!canEdit) return <span class="error">You don't have permission to edit page source.</span>;
  if (loadError) return <span class="error">{loadError}</span>;
  if (entries === null) return <span class="hint">Loading…</span>;

  const PREVIEW_FRAME_HEIGHT = 900;

  return (
    <div class="page-components-shell">
      {/* 3 sections, one per body column below - each held to that column's
       * OWN current width (`sidebar.size`/`previewSplit.size`, the same
       * reactive values the body itself renders at) so the toolbar visibly
       * lines up with what it controls, resize included. */}
      <div class="page-components-toolbar">
        <div class="page-editor-toolbar-section" style={sidebarOpen ? { width: `${sidebar.size}px` } : undefined}>
          <button type="button" class="ghost icon sm" aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"} aria-pressed={sidebarOpen} onClick={() => setSidebarOpen((v) => !v)}>
            <MenuIcon />
          </button>
        </div>
        {sidebarOpen && <div class="page-editor-toolbar-spacer" />}

        <div class="page-editor-toolbar-section" style={previewOpen ? { width: `${previewSplit.size}px` } : undefined}>
          <button type="button" class="ghost sm" aria-pressed={previewOpen} onClick={() => setPreviewOpen((v) => !v)}>
            {previewOpen ? "Hide preview" : "Show preview"}
          </button>
          {previewOpen && (
            <div class="button-group">
              {VIEWPORT_KEYS.map((key) => (
                <button key={key} type="button" class="sm" aria-pressed={viewport.key === key} title={`${VIEWPORT_WIDTHS[key]}px`} onClick={() => viewport.select(key)}>
                  {key.toUpperCase()}
                </button>
              ))}
            </div>
          )}
          {previewLoading && <span class="hint">Building…</span>}
        </div>
        {previewOpen && <div class="page-editor-toolbar-spacer" />}

        <div class="page-editor-toolbar-section" style={{ flex: 1 }}>
          <span class="hint" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedPath ?? ""}</span>
          <div class="spacer" />
          {selectedPath && (
            <button type="button" class="sm" disabled={!dirty || saving} aria-busy={saving} onClick={() => void handleSave()}>
              Save
            </button>
          )}
        </div>
      </div>

      <div class="page-components-body">
        {sidebarOpen && (
          <>
            <div style={{ width: `${sidebar.size}px` }}>
              <ComponentTreePanel
                entries={entries}
                selectedPath={selectedPath}
                onSelect={setSelectedPath}
                onCreateFile={handleCreateFile}
                onCreateFolder={handleCreateFolder}
                onDelete={setPendingDelete}
                onMove={handleMove}
                isDirty={(p) => sourceByPath[p] !== savedByPath[p]}
              />
            </div>
            <div class={`page-components-resize-handle${sidebar.dragging ? " dragging" : ""}`} {...sidebar.handleProps} />
          </>
        )}

        {previewOpen && (
          <>
            <div style={{ width: `${previewSplit.size}px`, display: "flex", flexDirection: "column" }}>
              {previewTarget && (
                <div class="page-editor-preview-label hint">
                  {previewLabel ?? previewTarget.label} · {viewport.width}px
                </div>
              )}
              {previewTarget ? (
                previewError ? (
                  <span class="error" style={{ padding: "0.5rem" }}>{previewError}</span>
                ) : (
                  <div class="page-components-preview-viewport" ref={viewport.viewportRef}>
                    <div class="page-components-preview-frame" style={{ width: `${viewport.width}px`, height: `${PREVIEW_FRAME_HEIGHT}px`, zoom: viewport.scale }}>
                      <iframe ref={iframeRef} title="Page preview" style={{ width: "100%", height: "100%", border: "none", background: "#fff", display: "block" }} />
                    </div>
                  </div>
                )
              ) : (
                <p class="hint" style={{ padding: "1rem" }}>
                  Select a page.tsx, layout.tsx, 404.tsx, or 500.tsx to preview it.
                </p>
              )}
            </div>
            <div class={`page-components-resize-handle${previewSplit.dragging ? " dragging" : ""}`} {...previewSplit.handleProps} />
          </>
        )}

        <div class="page-components-main">
          <div class="page-components-editor" style={{ flex: 1 }}>
            {selectedPath ? (
              <Editer key={selectedPath} value={code} onChange={handleChange} extraFiles={extraFiles} style={{ height: "100%" }} />
            ) : (
              <p class="hint">Select or create a page/layout/component on the left to edit it.</p>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete "${pendingDelete?.name ?? ""}"?`}
        message={pendingDelete?.kind === "folder" ? "This deletes the folder and everything inside it. This cannot be undone." : "This cannot be undone."}
        confirmLabel="Delete"
        destructive
        busy={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
