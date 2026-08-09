import { useEffect, useMemo, useRef, useState } from "preact/hooks";
const { path } = window.__DRY_CONFIG__;
import ConfirmDialog from "../components/ConfirmDialog.js";
import Editer from "../components/Editer.js";
import type { EditerDiagnostic, EditerResult } from "../components/Editer/types.js";
import { MenuIcon } from "../components/icons/index.js";
import { toast } from "../components/Toast.js";
import { useScaledPreview } from "./page-components/useDevicePreview.js";
import { useResizablePanel } from "../lib/useResizablePanel.js";
import { useOverlayScrollbars } from "../hooks/overlayscrollbars.js";
import { useParam } from "../hooks/useParam.js";
import { mergeRefs } from "../lib/merge-refs.js";
import { rewriteImportsAfterMove } from "../page-components/import-rewrite.js";
import { createPagesSourceApi } from "../page-components/pages-source-http-api.js";
import { triggerGithubSync } from "../page-components/github-sync-http-api.js";
import { getAllPageSourceDrafts, putPageSourceDraft, deletePageSourceDraft } from "../page-components/page-source-draft-db.js";
import {
  buildPage,
  publishBuiltPage,
  publishBuiltPages,
  resolveAllPageTargets,
  PageBuildError,
  type PageBuildResult,
  type PublishOptions,
} from "../page-components/page-build.js";
import { buildManifestRouteTree, matchSourceRoute, staticPagePaths } from "../server/app-router/route-manifest.js";
import { createContentTypesApi, listCached } from "../content-types/http-api.js";
import { CODE_EDITOR_RESOURCE_ID } from "../content-types/permissions.js";
import type { ContentTypeDefinition } from "../content-types/types.js";
import type { FileEntry } from "../storage/entry-types.js";
import { canAccess } from "../store/auth.js";
import ComponentTreePanel from "./page-components/ComponentTreePanel.js";
import { useDocumentTitle, usePageHeaderActions } from "./page-common.js";

/** Local one-off (same "no shared export for a single-use icon" pattern as
 * this file's own `ReloadIcon` below, or Media's `OptimizeIcon`) for the
 * "Open page" button - an arrow breaking out of a box, the standard
 * external-link glyph. */
function OpenInNewTabIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M14 3a1 1 0 1 0 0 2h3.586l-7.293 7.293a1 1 0 0 0 1.414 1.414L19 6.414V10a1 1 0 1 0 2 0V4a1 1 0 0 0-1-1zM5 5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5a1 1 0 1 0-2 0v5H5V7h5a1 1 0 1 0 0-2z"
      />
    </svg>
  );
}

/** Same icon `SlugField.tsx`'s `RegenerateSlugIcon` uses, for the same
 * "recompute this on demand" meaning - a local one-off (this codebase's own
 * established pattern for a single-use icon, e.g. Media's `OptimizeIcon`)
 * rather than a new shared export for the one button that needs it. */
function ReloadIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M0 0h24v24H0z" fill="none" />
      <path
        fill="currentColor"
        fill-rule="evenodd"
        d="m18.94 6.5l-2.97-2.97l1.06-1.06l3.897 3.896a1.25 1.25 0 0 1 0 1.768L17.03 12.03l-1.06-1.06L18.94 8H5.75c-.69 0-1.25.56-1.25 1.25V11H3V9.25A2.75 2.75 0 0 1 5.75 6.5zm-13.88 11l2.97 2.97l-1.06 1.06l-3.897-3.896a1.25 1.25 0 0 1 0-1.768L6.97 11.97l1.06 1.06L5.06 16h13.19c.69 0 1.25-.56 1.25-1.25V13H21v1.75a2.75 2.75 0 0 1-2.75 2.75z"
        clip-rule="evenodd"
      />
    </svg>
  );
}

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
    <div style="padding:3rem 1.5rem;margin:1rem;text-align:center;background:#fef3c7;border:2px dashed #d97706;border-radius:0.5rem;color:#92400e;font:600 14px/1.5 system-ui,sans-serif;"></div>
  );
}
`;

/** `postMessage` type for the `.page-components-preview-frame` iframe -
 * `srcdoc` has no real route to navigate to (it's a detached, unpublished
 * render, not a live page - see this file's own doc comment), so a link
 * clicked INSIDE the preview can't be allowed to actually navigate the
 * iframe. Instead the injected script below (`buildPreviewNavigationScript`)
 * intercepts every click, always prevents the default navigation, and
 * reports the resolved pathname back here - which is then checked against
 * this SAME `manifest` `previewTarget` itself resolves against, so clicking a
 * link to another real page focuses that page's `page.tsx` in the tree
 * (switching what's being edited/previewed) instead of silently doing
 * nothing. A pathname with no matching `page.tsx` surfaces as a toast error
 * rather than switching - there's nothing valid to focus. */
const PREVIEW_NAVIGATE_MESSAGE = "dry-page-editor-preview-navigate";

/** Runs INSIDE the preview iframe (injected as a literal `<script>` into the
 * built HTML, never sharing a JS realm with this file) - see
 * `PREVIEW_NAVIGATE_MESSAGE`'s doc comment for why. Capturing-phase so it
 * runs before any in-page handler the previewed code itself might attach.
 * `anchor.href` (not `getAttribute("href")`) resolves relative/rooted hrefs
 * against the `<base href>` `refreshPreview` already stamps onto `<head>`,
 * so `new URL` here just re-parses an already-absolute URL back out to a
 * pathname - no origin-joining logic duplicated on this side. */
function buildPreviewNavigationScript(): string {
  return `<script>(function(){document.addEventListener("click",function(event){var anchor=event.target&&event.target.closest?event.target.closest("a[href]"):null;if(!anchor)return;event.preventDefault();var pathname;try{pathname=new URL(anchor.href,document.baseURI).pathname;}catch(e){return;}window.parent.postMessage({type:${JSON.stringify(PREVIEW_NAVIGATE_MESSAGE)},pathname:pathname},"*");},true);})();</script>`;
}

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
const DIAGNOSTICS_HEIGHT = { initial: 180, min: 80, max: 480 };

/** Viewport presets for the preview column's responsive toolbar - `sm`/`md`/
 * `lg`/`xl` match Tailwind's own default breakpoints (meaningful for
 * previewing THIS site's own Tailwind classes), `xs` added below them for a
 * small-phone width Tailwind itself has no named breakpoint for. */
type ViewportKey = "xs" | "sm" | "md" | "lg" | "xl";
const VIEWPORT_WIDTHS: Record<ViewportKey, number> = { xs: 375, sm: 640, md: 768, lg: 1024, xl: 1280 };
const VIEWPORT_KEYS: ViewportKey[] = ["xs", "sm", "md", "lg", "xl"];
const ZOOM_STEP = 0.1;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 3;

/** Persists this page's own layout/view state - which file is open, panel
 * sizes, viewport preset, zoom - so a reload lands back where the user left
 * off instead of resetting to defaults every time. Deliberately separate
 * from `page-source-draft-db.ts`'s IndexedDB: that store holds actual file
 * CONTENT (recoverable across devices/tabs via the server being the real
 * source of truth once saved); this is purely local UI state with no server
 * counterpart at all, so `localStorage` (synchronous, simpler, no schema
 * migration machinery) is the right tool rather than sharing that store. */
const UI_STATE_KEY = "dry-page-editor-ui-state";

interface PageEditorUiState {
  selectedPath: string | null;
  sidebarOpen: boolean;
  previewOpen: boolean;
  diagnosticsOpen: boolean;
  sidebarWidth: number;
  previewWidth: number;
  diagnosticsHeight: number;
  viewportKey: ViewportKey;
  manualZoom: number | null;
}

function loadPageEditorUiState(): Partial<PageEditorUiState> | null {
  try {
    const raw = localStorage.getItem(UI_STATE_KEY);
    return raw ? (JSON.parse(raw) as Partial<PageEditorUiState>) : null;
  } catch {
    return null;
  }
}

function savePageEditorUiState(state: PageEditorUiState) {
  try {
    localStorage.setItem(UI_STATE_KEY, JSON.stringify(state));
  } catch {
    // Best-effort - a write failure (quota, private mode) just means the
    // layout resets to defaults on the next reload, not a functional break.
  }
}

function clampWidth(value: number, range: { min: number; max: number }): number {
  return Math.min(range.max, Math.max(range.min, value));
}

export default function PageEditor() {
  useDocumentTitle("Page Code Editor");
  const canEdit = canAccess(CODE_EDITOR_RESOURCE_ID, "setting");
  const api = useMemo(() => createPagesSourceApi(`${path}/api/pages-source`), []);
  const typesApi = useMemo(() => createContentTypesApi(`${path}/api/content-types`), []);

  // Read once (lazy initializer, not re-read every render) - every piece of
  // state below seeds itself from this same snapshot.
  const [initialUiState] = useState(() => loadPageEditorUiState());

  const [entries, setEntries] = useState<FileEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sourceByPath, setSourceByPath] = useState<Record<string, string>>({});
  const [savedByPath, setSavedByPath] = useState<Record<string, string>>({});
  // Backed by the URL's `file` query param (`useParam`, same convention as
  // `BuilderContentType.tsx`'s `selectedKind`), not local state, so the file
  // currently open is shareable/reloadable via the URL - `""` stands in for
  // "nothing selected" (falsy, same as the old `null` everywhere below) since
  // `useParam` only deals in strings. Falls back to the last file persisted
  // in `localStorage` (`initialUiState`) when the URL has no `file` param
  // yet, e.g. a bare bookmark to this page.
  const [selectedPath, setSelectedPath] = useParam<string>("file", initialUiState?.selectedPath ?? "");
  const [saving, setSaving] = useState(false);
  const [buildingCurrent, setBuildingCurrent] = useState(false);
  const [buildAllProgress, setBuildAllProgress] = useState<{ done: number; total: number } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<FileEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(initialUiState?.sidebarOpen ?? true);
  const [previewOpen, setPreviewOpen] = useState(initialUiState?.previewOpen ?? true);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(initialUiState?.diagnosticsOpen ?? true);
  // The selected file's own TS diagnostics (`Editer`'s `onChange` already
  // computes these every debounce - see `handleChange` - nothing new to
  // wire into `Editer` itself). Reset on file switch rather than left
  // stale: `Editer` remounts via `key={selectedPath}` and re-reports fresh
  // diagnostics shortly after (its own worker-priming `onChange`), so the
  // brief empty gap reads as "not yet checked", never as a wrong file's
  // errors bleeding into the newly selected one.
  const [diagnostics, setDiagnostics] = useState<EditerDiagnostic[]>([]);

  /** Every `page.tsx` that's been saved since its last successful build in
   * THIS session (`status/error.md`'s "trang nào Save mà chưa build thì có
   * dấu tròn màu vàng") - purely a session-local UI hint (a fresh reload
   * starts empty, same as `PageBuild.tsx`'s own build status not tracking
   * code changes - see that page's own doc comment on `staleResource`),
   * not a claim about what's actually live. Drives `ComponentTreePanel`'s
   * `needsBuild` dot. */
  const [unbuiltPaths, setUnbuiltPaths] = useState<Set<string>>(new Set());

  function markUnbuilt(paths: Iterable<string>) {
    setUnbuiltPaths((prev) => {
      const next = new Set(prev);
      for (const p of paths) if (/(^|\/)page\.tsx$/.test(p)) next.add(p);
      return next;
    });
  }

  function clearUnbuilt(paths: Iterable<string>) {
    setUnbuiltPaths((prev) => {
      const next = new Set(prev);
      for (const p of paths) next.delete(p);
      return next;
    });
  }

  const [allTypes, setAllTypes] = useState<ContentTypeDefinition[] | null>(null);
  const [assetHrefs, setAssetHrefs] = useState<AssetHrefs | null>(null);
  const [dryTypes, setDryTypes] = useState<string | null>(null);
  const [origin] = useState(() => window.location.origin);

  const sidebar = useResizablePanel({
    ...SIDEBAR_WIDTH,
    initial: initialUiState?.sidebarWidth !== undefined ? clampWidth(initialUiState.sidebarWidth, SIDEBAR_WIDTH) : SIDEBAR_WIDTH.initial,
    axis: "x",
  });
  const previewSplit = useResizablePanel({
    ...PREVIEW_WIDTH,
    initial: initialUiState?.previewWidth !== undefined ? clampWidth(initialUiState.previewWidth, PREVIEW_WIDTH) : PREVIEW_WIDTH.initial,
    axis: "x",
  });
  const diagnosticsSplit = useResizablePanel({
    ...DIAGNOSTICS_HEIGHT,
    initial:
      initialUiState?.diagnosticsHeight !== undefined
        ? clampWidth(initialUiState.diagnosticsHeight, DIAGNOSTICS_HEIGHT)
        : DIAGNOSTICS_HEIGHT.initial,
    axis: "y",
    // The problems panel sits BELOW its own resize handle (handle first,
    // then the panel - see the JSX below), unlike `sidebar`/`previewSplit`
    // above (panel first, handle after) - dragging the handle down shrinks
    // this panel rather than growing it, so the size delta needs flipping.
    invert: true,
  });
  const viewport = useScaledPreview<ViewportKey>(
    VIEWPORT_WIDTHS,
    initialUiState?.viewportKey && VIEWPORT_KEYS.includes(initialUiState.viewportKey) ? initialUiState.viewportKey : "lg",
  );
  /** `+`/`-`/`Fit` zoom the PREVIEW ITSELF, layered on top of
   * `viewport.scale`'s own auto-fit-to-panel value - unlike the xs/sm/md/lg/
   * xl buttons (which pick `viewport.width`, the simulated device's actual
   * width the iframe reflows against), this never changes what width the
   * page inside the iframe thinks it's rendering at, only how big it looks
   * on screen. `null` = no manual override, use the auto-fit scale as-is. */
  const [manualZoom, setManualZoom] = useState<number | null>(
    typeof initialUiState?.manualZoom === "number" ? Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, initialUiState.manualZoom)) : null,
  );
  const effectiveZoom = manualZoom ?? viewport.scale;

  // Debounced via the effect-cleanup idiom: each dependency change cancels
  // the previous pending write and schedules a fresh one, so a resize
  // drag's continuous stream of size updates doesn't hit localStorage on
  // every pointermove.
  useEffect(() => {
    const timer = setTimeout(() => {
      savePageEditorUiState({
        selectedPath,
        sidebarOpen,
        previewOpen,
        diagnosticsOpen,
        sidebarWidth: sidebar.size,
        previewWidth: previewSplit.size,
        diagnosticsHeight: diagnosticsSplit.size,
        viewportKey: viewport.key,
        manualZoom,
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [
    selectedPath,
    sidebarOpen,
    previewOpen,
    diagnosticsOpen,
    sidebar.size,
    previewSplit.size,
    diagnosticsSplit.size,
    viewport.key,
    manualZoom,
  ]);

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
      setSavedByPath(nextSource);

      // Overlay any unsaved edit recovered from IndexedDB on top of the
      // freshly-loaded saved content - but only for a file that's still in
      // the tree; a draft for a since-deleted/renamed path is stale, so it's
      // dropped here rather than resurrected.
      const drafts = await getAllPageSourceDrafts();
      const withDrafts = { ...nextSource };
      for (const draft of drafts) {
        if (draft.path in nextSource) withDrafts[draft.path] = draft.source;
        else void deletePageSourceDraft(draft.path);
      }
      setSourceByPath(withDrafts);

      setSelectedPath((current) => {
        if (current && withDrafts[current] !== undefined) return current;
        return files.length > 0 ? files[0]!.id : "";
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

  // Clears stale diagnostics from whatever file was open before - `Editer`
  // remounts on `selectedPath` (its own `key`) and reports fresh ones via
  // `handleChange` shortly after, this just covers the gap in between.
  useEffect(() => {
    setDiagnostics([]);
  }, [selectedPath]);

  const errorCount = diagnostics.filter((d) => d.source === "syntax").length;
  const warningCount = diagnostics.length - errorCount;

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

  /** Per-path debounce for the IndexedDB draft write, same 300ms/keyed-Map
   * shape `entry-draft-store.ts`'s `saveEntryDraft` already established for
   * the identical "a fast typist shouldn't hit IndexedDB once per keystroke"
   * reason - keyed (not a single timer) because switching to another file
   * mid-debounce must flush/track that file independently rather than
   * cancel the first file's pending write. */
  const pendingDraftWrites = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  function cancelDraftWrite(filePath: string) {
    const pending = pendingDraftWrites.current.get(filePath);
    if (pending !== undefined) {
      clearTimeout(pending);
      pendingDraftWrites.current.delete(filePath);
    }
  }

  function scheduleDraftWrite(filePath: string, source: string) {
    cancelDraftWrite(filePath);
    pendingDraftWrites.current.set(
      filePath,
      setTimeout(() => {
        pendingDraftWrites.current.delete(filePath);
        void putPageSourceDraft(filePath, source);
      }, 300),
    );
  }

  function handleChange(result: EditerResult) {
    if (!selectedPath) return;
    setSourceByPath((prev) => (prev[selectedPath] === result.code ? prev : { ...prev, [selectedPath]: result.code }));
    setDiagnostics(result.errors);
    if (result.code === savedByPath[selectedPath]) {
      cancelDraftWrite(selectedPath);
      void deletePageSourceDraft(selectedPath);
    } else {
      scheduleDraftWrite(selectedPath, result.code);
    }
  }

  async function handleSave() {
    if (!selectedPath) return;
    setSaving(true);
    try {
      await api.save(selectedPath, sourceByPath[selectedPath] ?? "");
      setSavedByPath((prev) => ({ ...prev, [selectedPath]: sourceByPath[selectedPath] ?? "" }));
      cancelDraftWrite(selectedPath);
      void deletePageSourceDraft(selectedPath);
      markUnbuilt([selectedPath]);
    } catch (error) {
      toast.add({ type: "error", title: "Save failed", description: error instanceof Error ? error.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  /** Saves every file whose content differs from storage - both Build
   * buttons call this first now instead of just staying disabled while
   * dirty (`status/error.md`'s "Khi nhấn build page mà các file liên quan
   * chưa lưu thì tự động lưu theo"). Returns the up-to-date saved map
   * directly rather than relying on `savedByPath` state (which wouldn't
   * reflect this save yet in the same render) so callers can build from it
   * immediately. */
  async function saveAllDirty(): Promise<Record<string, string>> {
    const dirtyPaths = Object.keys(sourceByPath).filter((p) => sourceByPath[p] !== savedByPath[p]);
    if (dirtyPaths.length === 0) return savedByPath;
    setSaving(true);
    try {
      for (const p of dirtyPaths) {
        await api.save(p, sourceByPath[p] ?? "");
        cancelDraftWrite(p);
        void deletePageSourceDraft(p);
      }
      const next = { ...savedByPath };
      for (const p of dirtyPaths) next[p] = sourceByPath[p] ?? "";
      setSavedByPath(next);
      markUnbuilt(dirtyPaths);
      return next;
    } finally {
      setSaving(false);
    }
  }

  /** Reverts the SELECTED file's unsaved edit back to what's actually on
   * storage - drops its pending draft write same as a successful save would
   * (`handleSave`), just without writing anything. `setSourceByPath` alone
   * is enough to update the visible editor content (`Editer`'s own `value`
   * sync effect), no remount needed. */
  function handleReset() {
    if (!selectedPath) return;
    const saved = savedByPath[selectedPath] ?? "";
    setSourceByPath((prev) => (prev[selectedPath] === saved ? prev : { ...prev, [selectedPath]: saved }));
    cancelDraftWrite(selectedPath);
    void deletePageSourceDraft(selectedPath);
  }

  /** Builds + publishes the SELECTED page.tsx (only enabled when it matches
   * a real static route - see `previewTarget`'s own doc comment) - a
   * shortcut for what `PageBuild.tsx`'s per-row "Build" button already does,
   * without leaving this editor. Compiles from `saveAllDirty()`'s return
   * value (never raw `sourceByPath`, which may hold this OR ANOTHER open
   * file's unsaved edit) - published output must only ever reflect what's
   * actually on storage, matching what `PageBuild.tsx` itself builds from (a
   * fresh server fetch), never a local in-browser buffer nothing else can
   * see; `saveAllDirty()` is what makes that true even when the editor
   * itself still has unsaved edits open. */
  /** Fires the GitHub snapshot commit after a build's own publish already
   * succeeded, and folds the result into a toast - but only when it's
   * actually actionable. `"not-configured"` (the feature is simply off, or
   * `githubSync.enabled` isn't checked) stays silent, same as
   * `dry.generated.d.ts`'s own "never fatal" fetch elsewhere in this file;
   * a real failure (bad token, GitHub API error) gets its own separate,
   * non-blocking toast - it must never read as the build itself having
   * failed, since `publishBuiltPage(s)` above already succeeded. */
  async function reportGithubSync(message: string): Promise<void> {
    const result = await triggerGithubSync(`${path}/api/github-sync`, message);
    if (!result.pushed && result.reason && result.reason !== "not-configured") {
      toast.add({ type: "default", title: "Built, but GitHub sync failed", description: result.reason });
    }
  }

  async function handleBuildCurrent() {
    if (!previewTarget || !allTypes || !assetHrefs) return;
    setBuildingCurrent(true);
    try {
      const saved = await saveAllDirty();
      const result = await buildPage({
        pathname: previewTarget.pathname,
        origin,
        adminPath: path,
        siteLang: "en",
        assets: { globalsCssHref: assetHrefs.globalsCssHref, hydrateEntryHref: assetHrefs.hydrateBuiltHref, veiOverlayHref: assetHrefs.veiOverlayHref },
        preactRuntimeHref: assetHrefs.preactRuntimeHref,
        builtAssetsBaseUrl: `${path}/api/built-assets`,
        dryHttpEndpoint: `${path}/api/dry-http`,
        allTypes,
        sourceByPath: saved,
        entryPath: previewTarget.entryPath,
        layoutPaths: previewTarget.layoutPaths,
        params: previewTarget.params,
      });
      await publishBuiltPage(result, { pagesBuildEndpoint: `${path}/api/pages-build`, pathname: previewTarget.pathname });
      clearUnbuilt([previewTarget.entryPath]);
      toast.add({ type: "success", title: `Built "${previewTarget.pathname}"` });
      await reportGithubSync(`Build: ${previewTarget.pathname} - ${new Date().toISOString()}`);
    } catch (error) {
      const message = error instanceof PageBuildError || error instanceof Error ? error.message : "Build failed.";
      toast.add({ type: "error", title: `Failed to build "${previewTarget.pathname}"`, description: message });
    } finally {
      setBuildingCurrent(false);
    }
  }

  /** Builds + publishes every page on the site (static + resolved dynamic),
   * same target set `PageBuild.tsx`'s own "Build all" uses
   * (`resolveAllPageTargets`) - a convenience shortcut, deliberately without
   * that page's resumable-queue/localStorage machinery (a closed tab losing
   * progress here just means re-clicking "Build all", same as any other
   * in-progress admin action elsewhere in this app); `PageBuild.tsx` remains
   * the place for a large site's resilient, resumable run. Batches publishes
   * (`publishBuiltPages`) the same way, for the same reason. Compiles from
   * `savedByPath` - see `handleBuildCurrent`'s doc comment for why. */
  async function handleBuildAll() {
    if (!allTypes || !assetHrefs) return;
    const BATCH_SIZE = 5;
    setBuildAllProgress({ done: 0, total: 0 });
    try {
      const saved = await saveAllDirty();
      const { targets } = await resolveAllPageTargets(saved, allTypes, `${path}/api/dry-http`);
      const pathnames = [...targets.keys()];
      setBuildAllProgress({ done: 0, total: pathnames.length });
      let batch: { result: PageBuildResult; options: PublishOptions }[] = [];
      let done = 0;
      for (const pathname of pathnames) {
        const target = targets.get(pathname)!;
        const result = await buildPage({
          pathname,
          origin,
          adminPath: path,
          siteLang: "en",
          assets: { globalsCssHref: assetHrefs.globalsCssHref, hydrateEntryHref: assetHrefs.hydrateBuiltHref, veiOverlayHref: assetHrefs.veiOverlayHref },
          preactRuntimeHref: assetHrefs.preactRuntimeHref,
          builtAssetsBaseUrl: `${path}/api/built-assets`,
          dryHttpEndpoint: `${path}/api/dry-http`,
          allTypes,
          sourceByPath: saved,
          entryPath: target.entryPath,
          layoutPaths: target.layoutPaths,
          params: target.params,
        });
        batch.push({ result, options: { pagesBuildEndpoint: `${path}/api/pages-build`, pathname } });
        if (batch.length >= BATCH_SIZE) {
          await publishBuiltPages(batch, `${path}/api/pages-build`);
          done += batch.length;
          batch = [];
          setBuildAllProgress({ done, total: pathnames.length });
        }
      }
      if (batch.length > 0) {
        await publishBuiltPages(batch, `${path}/api/pages-build`);
        done += batch.length;
      }
      clearUnbuilt([...targets.values()].map((t) => t.entryPath));
      toast.add({ type: "success", title: `Built ${done} ${done === 1 ? "page" : "pages"}` });
      await reportGithubSync(`Build all: ${done} pages - ${new Date().toISOString()}`);
    } catch (error) {
      const message = error instanceof PageBuildError || error instanceof Error ? error.message : "Build failed.";
      toast.add({ type: "error", title: "Build all failed", description: message });
    } finally {
      setBuildAllProgress(null);
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
      cancelDraftWrite(pendingDelete.id);
      void deletePageSourceDraft(pendingDelete.id);
      if (selectedPath === pendingDelete.id) setSelectedPath("");
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
      cancelDraftWrite(from);
      void deletePageSourceDraft(from);
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

  /** The chain of files this preview actually renders through, root-first:
   * every `layout.tsx` wrapping the target (exactly the `layoutPaths`
   * `buildPage` is handed - the same list the real request-time render
   * nests, not a re-derivation), plus the previewed page itself as the
   * trailing crumb. Surfaced as a breadcrumb under the preview so "which
   * layouts is this page inside?" is answerable without walking the tree,
   * and each crumb selects that file - which in turn re-targets the
   * preview (a layout previews against its own placeholder child, see
   * `previewTarget`).
   *
   * The entry crumb is skipped when `extraSource` is set: that's the
   * synthetic `LAYOUT_PLACEHOLDER_PATH`, not a real file anyone can open. */
  const previewChain = useMemo(() => {
    if (!previewTarget || previewTarget.layoutPaths.length === 0) return null;
    const paths = [...previewTarget.layoutPaths];
    if (!previewTarget.extraSource) paths.push(previewTarget.entryPath);
    return paths.map((filePath) => ({ filePath, current: filePath === selectedPath }));
  }, [previewTarget, selectedPath]);

  const buildBusy = buildingCurrent || buildAllProgress !== null;

  // "Build all" moves into `DryLayout`'s shared topbar (`usePageHeaderActions`)
  // rather than living in this page's own compact toolbar, unlike "Build"/
  // "Reset"/"Save" (which stay local - they act on whichever file is
  // currently selected, the toolbar's own context). Called unconditionally,
  // before this component's early-return guards below (Rules of Hooks).
  usePageHeaderActions(
    <>
      <div class="topbar-page-title">
        <strong>Page Builder</strong>
      </div>
      <span class="spacer" />
      <button type="button" class="outline" disabled={buildBusy} aria-busy={buildAllProgress !== null} onClick={() => void handleBuildAll()}>
        {buildAllProgress ? `Building all… (${buildAllProgress.done}/${buildAllProgress.total})` : "Build all"}
      </button>
    </>,
  );

  /** `.page-components-preview-viewport` (below) needs 2 independent refs -
   * `useScaledPreview`'s own (measures available width for auto-fit,
   * self-healing across remounts via its own callback ref - see its doc
   * comment) and this one (hands scroll/overflow to the app's standard
   * scroll library, matching every other scrollable panel - see
   * `.magic-chat-messages`'s host/viewport CSS split for the same pattern).
   * `mergeRefs` below attaches both to the one host element.
   *
   * Unlike `useScaledPreview`, this hook's own `ref` is a plain object, not
   * self-healing - its mount effect only runs when `deps` changes, so it
   * MUST be told exactly when the host element's mounted-ness flips (it's
   * conditionally rendered, gated on `previewTarget && !previewError`) or
   * it silently never initializes for a host that doesn't exist yet on
   * first mount (this component's very first render, before `loadTree()`'s
   * async fetch resolves `previewTarget` - the doc comment on the hook
   * itself calls this out, e.g. `[open]` for a conditionally-shown panel).
   * Keyed on `previewTarget` alone, not `previewError` too - the viewport
   * stays mounted across an error<->success flip now (see the JSX below),
   * so re-running this on every error toggle would just be redundant
   * teardown/init work on top of the same DOM node. */
  const previewScroll = useOverlayScrollbars<HTMLDivElement>([!!previewTarget]);

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
        // result.jsAssets is never used below (see that comment) - skip
        // compiling it, roughly halving how long each debounced edit blocks
        // the main thread (benchmarked: sucrase's ESM pass costs about as
        // much as the CJS pass this preview does still need).
        skipJsAssets: true,
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
      const withNavigationScript = withBase.includes("</body>")
        ? withBase.replace("</body>", `${buildPreviewNavigationScript()}</body>`)
        : withBase + buildPreviewNavigationScript();
      if (iframeRef.current) iframeRef.current.srcdoc = withNavigationScript;
      setPreviewLabel(previewTarget.label);
    } catch (error) {
      if (seq !== previewSeqRef.current) return;
      setPreviewError(error instanceof PageBuildError || error instanceof Error ? error.message : "Preview failed.");
    } finally {
      if (seq === previewSeqRef.current) setPreviewLoading(false);
    }
  }

  // Receives `PREVIEW_NAVIGATE_MESSAGE` from `buildPreviewNavigationScript`'s
  // injected click handler (see its doc comment) - resolved against the SAME
  // `manifest` `previewTarget` itself uses, so this is exactly "is this
  // pathname a real page.tsx", not a separate/looser check. A match focuses
  // that page.tsx (switches `selectedPath`, which drives the tree selection,
  // the editor, and - via `previewTarget`'s own dependency on `selectedPath`
  // - the next preview build); no match surfaces as an error toast instead,
  // since there's no page here to switch to and the srcdoc iframe was never
  // going to navigate there for real anyway.
  useEffect(() => {
    function handlePreviewMessage(event: MessageEvent) {
      if (!event.data || event.data.type !== PREVIEW_NAVIGATE_MESSAGE) return;
      if (iframeRef.current && event.source !== iframeRef.current.contentWindow) return;
      const pathname = event.data.pathname;
      if (typeof pathname !== "string") return;
      const match = matchSourceRoute(manifest, pathname);
      if (match) {
        setSelectedPath(match.entryPath);
      } else {
        toast.add({ type: "error", title: "Page not found", description: `No page.tsx matches "${pathname}" - can't navigate there.` });
      }
    }
    window.addEventListener("message", handlePreviewMessage);
    return () => window.removeEventListener("message", handlePreviewMessage);
  }, [manifest]);

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
  // `previewTarget` alone isn't enough here - it's also truthy for a
  // `layout.tsx`/`404.tsx`/`500.tsx` preview (see its own doc comment), none
  // of which `resolveAllPageTargets`/`PageBuild.tsx` treat as a buildable
  // target on their own.
  const isPageTarget = !!selectedPath && /(^|\/)page\.tsx$/.test(selectedPath) && !!previewTarget;

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
            <button type="button" class="ghost sm" disabled={!dirty || saving} onClick={handleReset}>
              Reset
            </button>
          )}
          {isPageTarget && (
            <button type="button" class="ghost sm" disabled={buildBusy} aria-busy={buildingCurrent} onClick={() => void handleBuildCurrent()}>
              {buildingCurrent ? "Building…" : "Build"}
            </button>
          )}
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
                needsBuild={(p) => unbuiltPaths.has(p)}
              />
            </div>
            <div class={`page-components-resize-handle${sidebar.dragging ? " dragging" : ""}`} {...sidebar.handleProps} />
          </>
        )}

        {previewOpen && (
          <>
            <div style={{ width: `${previewSplit.size}px`, display: "flex", flexDirection: "column" }}>
              {previewTarget && (
                <div class="page-editor-preview-label">
                  <span class="hint" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {previewLabel ?? previewTarget.label}
                  </span>
                  <div class="spacer" />
                  <button type="button" class="ghost icon sm" aria-label="Reload preview" disabled={previewLoading} onClick={() => void refreshPreview()}>
                    <ReloadIcon />
                  </button>
                  <button
                    type="button"
                    class="ghost icon sm"
                    aria-label="Zoom out"
                    onClick={() => setManualZoom(Math.max(MIN_ZOOM, effectiveZoom - ZOOM_STEP))}
                  >
                    −
                  </button>
                  <span class="hint">{Math.round(effectiveZoom * 100)}%</span>
                  <button
                    type="button"
                    class="ghost icon sm"
                    aria-label="Zoom in"
                    onClick={() => setManualZoom(Math.min(MAX_ZOOM, effectiveZoom + ZOOM_STEP))}
                  >
                    +
                  </button>
                  <button type="button" class="sm outline" disabled={manualZoom === null} onClick={() => setManualZoom(null)}>
                    Fit
                  </button>
                  <button
                    type="button"
                    class="ghost icon sm"
                    aria-label={isPageTarget ? `Open "${previewTarget.pathname}" in a new tab` : "Open in a new tab (select a page.tsx first)"}
                    title={isPageTarget ? `Open "${previewTarget.pathname}" in a new tab` : "Open in a new tab (select a page.tsx first)"}
                    disabled={!isPageTarget}
                    onClick={() => window.open(`${origin}${previewTarget.pathname}`, "_blank", "noopener,noreferrer")}
                  >
                    <OpenInNewTabIcon />
                  </button>
                </div>
              )}
              {previewTarget ? (
                // Always mounted regardless of `previewError` - keeping the
                // viewport/frame/iframe subtree (and the ResizeObserver +
                // OverlayScrollbars instance attached to it) alive across an
                // error<->success flip is what avoids the visible jitter a
                // `previewError ? <span> : <div>...</div>` swap used to cause
                // (found live: every debounced edit that flips build outcome
                // unmounted and remounted the whole preview column). An error
                // now overlays the LAST successfully rendered srcdoc instead
                // of replacing it - `refreshPreview` never clears the iframe's
                // `srcdoc` on failure, so there's always something underneath.
                <div class="page-components-preview-viewport" ref={mergeRefs(viewport.viewportRef, previewScroll.ref)}>
                  {previewError && (
                    <div class="page-editor-preview-error" role="alert">
                      {previewError}
                    </div>
                  )}
                  <div class="page-components-preview-viewport-inner" ref={previewScroll.viewportRef}>
                    <div class="page-components-preview-frame" style={{ width: `${viewport.width}px`, height: `${PREVIEW_FRAME_HEIGHT}px`, zoom: effectiveZoom }}>
                      <iframe ref={iframeRef} title="Page preview" style={{ width: "100%", height: "100%", border: "none", background: "#fff", display: "block" }} />
                    </div>
                  </div>
                </div>
              ) : (
                <p class="hint" style={{ padding: "1rem" }}>
                  Select a page.tsx, layout.tsx, 404.tsx, or 500.tsx to preview it.
                </p>
              )}
              {/* Breadcrumb of the layout chain this preview renders through
                * - see `previewChain`'s doc comment. Sits under the preview
                * (not in its header) so it reads bottom-up as "this page,
                * inside these layouts", and so the header's controls keep
                * the room they already have. */}
              {previewChain && (
                <ol class="page-editor-preview-chain" aria-label="Layout chain">
                  {previewChain.map(({ filePath, current }) => (
                    <li key={filePath}>
                      <button
                        type="button"
                        class="ghost sm"
                        title={current ? `${filePath} (currently open)` : `Open ${filePath}`}
                        aria-current={current ? "true" : undefined}
                        onClick={() => setSelectedPath(filePath)}
                      >
                        {filePath}
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </div>
            <div class={`page-components-resize-handle${previewSplit.dragging ? " dragging" : ""}`} {...previewSplit.handleProps} />
          </>
        )}

        <div class="page-components-main">
          <div class="page-components-editor" style={{ flex: 1 }}>
            {/* `selectedPath` can be non-null before `loadTree()`'s fetch resolves
             * (restored from `initialUiState` on mount) - `sourceByPath[selectedPath]`
             * would then be `undefined` and `code` fall back to `""`. Mounting `Editer`
             * on that placeholder `""` is not just a visual flash: `Editer` always echoes
             * its mount-time `value` back through `onChange` ~300ms later (its worker
             * priming call - see its own doc comment), which `handleChange` below can't
             * tell apart from a real edit. That schedules an IndexedDB draft write of the
             * empty string, which `loadTree`'s own draft-overlay then blindly reapplies
             * on a LATER visit - silently wiping the file until "Reset". Gating on the
             * real fetch having landed for this path avoids ever handing `Editer` a
             * placeholder value in the first place. */}
            {selectedPath && sourceByPath[selectedPath] !== undefined ? (
              <Editer key={selectedPath} value={code} onChange={handleChange} extraFiles={extraFiles} style={{ height: "100%" }} />
            ) : selectedPath ? (
              <p class="hint">Loading…</p>
            ) : (
              <p class="hint">Select or create a page/layout/component on the left to edit it.</p>
            )}
          </div>

          {diagnosticsOpen && (
            <div class={`page-components-resize-handle horizontal${diagnosticsSplit.dragging ? " dragging" : ""}`} {...diagnosticsSplit.handleProps} />
          )}

          <div class="page-editor-diagnostics" style={diagnosticsOpen ? { height: `${diagnosticsSplit.size}px` } : undefined}>
            <div class="page-editor-diagnostics-header">
              <button
                type="button"
                class="page-editor-diagnostics-toggle"
                aria-expanded={diagnosticsOpen}
                aria-label={diagnosticsOpen ? "Collapse problems panel" : "Expand problems panel"}
                onClick={() => setDiagnosticsOpen((v) => !v)}
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
                  <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.343 6.343L15 12l-5.657 5.657" />
                </svg>
              </button>
              {errorCount === 0 && warningCount === 0 ? (
                <span class="hint">No problems</span>
              ) : (
                <>
                  {errorCount > 0 && (
                    <span class="badge sm destructive">
                      {errorCount} error{errorCount === 1 ? "" : "s"}
                    </span>
                  )}
                  {warningCount > 0 && (
                    <span class="badge sm warning">
                      {warningCount} warning{warningCount === 1 ? "" : "s"}
                    </span>
                  )}
                </>
              )}
            </div>
            {diagnosticsOpen &&
              (diagnostics.length > 0 ? (
                <ul class="page-editor-diagnostics-list">
                  {diagnostics.map((diagnostic, index) => (
                    <li key={index} class={diagnostic.source === "syntax" ? "error" : "warning"}>
                      <span class="page-editor-diagnostics-location">
                        {diagnostic.line}:{diagnostic.column}
                      </span>
                      <span>{diagnostic.message}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p class="hint" style={{ padding: "0.5rem" }}>
                  No problems detected.
                </p>
              ))}
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
