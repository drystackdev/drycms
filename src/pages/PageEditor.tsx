import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
const { path } = window.__DRY_CONFIG__;
import ConfirmDialog from "../components/ConfirmDialog.js";
import Editer from "../components/Editer.js";
import { type EditerFormatLanguage, formatCode } from "../components/Editer/format-code.js";
import type { EditerDiagnostic, EditerResult } from "../components/Editer/types.js";
import { CloseIcon, LockIcon, MenuIcon, PreviewIcon, SettingsIcon, UploadIcon } from "../components/icons/index.js";
import Popover from "../components/Popover.js";
import { toast } from "../components/Toast.js";
import GithubResetDialog from "./page-components/GithubResetDialog.js";
import GithubHistoryDialog from "./page-components/GithubHistoryDialog.js";
import { useScaledPreview } from "./page-components/useDevicePreview.js";
import { useResizablePanel } from "../lib/useResizablePanel.js";
import { useOverlayScrollbars } from "../hooks/overlayscrollbars.js";
import { useParam } from "../hooks/useParam.js";
import { mergeRefs } from "../lib/merge-refs.js";
import { resolveThemeColor } from "../lib/native/theme.js";
import { rewriteImportsAfterMove } from "../page-components/import-rewrite.js";
import { createPagesSourceApi } from "../page-components/pages-source-http-api.js";
import { triggerGithubSync } from "../page-components/github-sync-http-api.js";
import { fetchJson, toUrlPath, type AssetHrefs } from "../page-components/pages-source-http.js";
import { getAllPageSourceDrafts, putPageSourceDraft, deletePageSourceDraft, type PageSourceDraftRecord } from "../page-components/page-source-draft-db.js";
import {
  getAllPageSourceCache,
  putPageSourceCache,
  deletePageSourceCache,
  getPagesTreeCache,
  putPagesTreeCache,
} from "../page-components/page-source-cache-db.js";
import {
  buildPage,
  computeSourceHash,
  publishBuiltPage,
  publishBuiltPages,
  resolveAllPageTargets,
  pagesAffectedBy,
  PageBuildError,
  type PageBuildResult,
  type PublishOptions,
} from "../page-components/page-build.js";
import { buildPreviewSrcdoc, PREVIEW_NAVIGATE_MESSAGE, PREVIEW_SAVE_MESSAGE } from "../page-components/page-preview-engine.js";
import {
  buildManifestRouteTree,
  listDynamicPageTemplates,
  matchSourceRoute,
  notFoundRoute,
  serverErrorRoute,
  staticPagePaths,
  type DynamicPageTemplate,
} from "../server/app-router/route-manifest.js";
import { fetchPreviewEntries, type PreviewEntryRef } from "../page-components/dynamic-routes.js";
import { collectionTypeForPageSource } from "../server/app-router/page-collection.js";
import { useFetch } from "../hooks/useFetch.js";
import Select from "../components/Select.js";
import { createContentTypesApi, listCached } from "../content-types/http-api.js";
import { clearDryHttpCache } from "../content-types/dry-http-cache.js";
import { PAGE_BUILDER_RESOURCE_ID } from "../content-types/permissions.js";
import type { ContentTypeDefinition } from "../content-types/types.js";
import type { FileEntry } from "../storage/entry-types.js";
import { canAccess } from "../store/auth.js";
import PageSourceMagicChat from "./page-editor/PageSourceMagicChat.js";
import ComponentTreePanel from "./page-components/ComponentTreePanel.js";
import SystemFilesPanel from "./page-components/core-styles/SystemFilesPanel.js";
import { CORE_STYLE_FILES } from "./page-components/core-styles/registry.js";
import { FolderComponentsIcon, FolderCssIcon, FolderMarkdownIcon, FolderRoutesIcon, fileIconForName } from "./page-components/file-type-icons.js";
import { copyDestinationPath, entriesForSourceRoot, withSourceRoot } from "../page-components/tree.js";
import { COMPONENT_ROOT, MD_ROOT, PAGES_ROOT, PAGES_SOURCE_ROOTS, STYLES_ROOT, rootOf } from "../server/app-router/source-roots.js";
import { COMPONENT_PREVIEW_ENTRY_PATH, buildComponentPreviewSource } from "../page-components/component-preview.js";
import { tailwindStylesheetSource } from "../page-components/tailwind-build.js";
import { samplePropsSource } from "../page-components/props-sample.js";
import type { PropsSchema } from "../components/Editer/worker-protocol.js";
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

/** Local one-off, same pattern as `ReloadIcon` above (which reloads the
 * PREVIEW; this one discards the cached CONTENT it renders) - a database
 * cylinder with a refresh arrow. */
function RefreshDataIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 2c4.42 0 8 1.34 8 3v4.34a5.5 5.5 0 0 0-2-1.11V7.6c-1.5.82-3.75 1.23-6 1.23S7.5 8.42 6 7.6V11c0 .55 2.07 1.71 5.13 1.95q-.13.51-.13 1.05v.95C7.06 14.7 4 13.42 4 12V5c0-1.66 3.58-3 8-3m5.5 8a4.5 4.5 0 1 1-3.9 6.75l1.2-.7a3.1 3.1 0 1 0 .28-3.3H16.5l-1.75 1.75L13 12.75L15.75 10z"
      />
    </svg>
  );
}

/** Local one-off (same "no shared export for a single-use icon" pattern as
 * `ReloadIcon`/`RefreshDataIcon` above) for the Settings menu's "History"
 * item - a clock with a counterclockwise arrow, the standard "past states"
 * glyph. */
function HistoryIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M13 3a9 9 0 0 0-9 9H1l3.89 3.89l.07.14L9 12H6a7 7 0 1 1 2.05 4.95l-1.42 1.42A9 9 0 1 0 13 3m-1 5v5l4.28 2.54l.72-1.21l-3.5-2.08V8z"
      />
    </svg>
  );
}

/** `PAGES_SOURCE_ROOTS` (`source-roots.ts`) is deliberately dependency-free
 * (imported from a Vite config and a web worker, not just this app), so the
 * root -> icon mapping lives here instead of on `PagesSourceRoot` itself.
 * Icons are the Material Icon Theme folders matching each root's own
 * content (`FolderRoutesIcon` etc. - see `file-type-icons.tsx`'s own doc
 * comment), same set the file tree and the code-editor toggle below use. */
function sourceRootIcon(rootId: string) {
  switch (rootId) {
    case COMPONENT_ROOT:
      return <FolderComponentsIcon />;
    case STYLES_ROOT:
      return <FolderCssIcon />;
    case MD_ROOT:
      return <FolderMarkdownIcon />;
    default:
      return <FolderRoutesIcon />;
  }
}

/** A 4th sidebar tab alongside `PAGES_SOURCE_ROOTS`, but NOT one of them -
 * it has no folder of its own in storage, so it's kept out of
 * `source-roots.ts` entirely (that list drives every real source consumer).
 * It only ever
 * shows up for the rest of this session after `loadTree` recreates a
 * missing built-in `styles/` file (`core-styles/registry.ts`) - see
 * `recoveredCoreFiles` below. */
const SYSTEM_ROOT = "system";

/** How long the live preview may reuse a `dry()` response out of IndexedDB
 * before refetching it (`content-types/dry-http-cache.ts`). Only the preview
 * caches at all - "Build"/"Build all" here and on Page Build publish real
 * HTML, so they always read fresh. Content edited in the CMS therefore shows
 * up in the preview within this window, or immediately via the toolbar's
 * "Refresh data" button. */
const PREVIEW_DRY_CACHE_TTL_MS = 5 * 60 * 1000;

/** How many published rows the `[param]` preview's entry picker offers
 * (`fetchPreviewEntries`). A cap, not a page size - there's no paging in a
 * toolbar dropdown, and picking one of the most recent entries to eyeball a
 * template against is what the control is for; building EVERY row is "Build
 * all"'s job (`resolveAllPageTargets`), which enumerates the collection
 * uncapped. */
const PREVIEW_ENTRY_LIMIT = 100;

/** `unbuiltPaths`'s sessionStorage backing - see that state's own doc
 * comment for why it needs to survive the reload a Save causes to THIS
 * same tab. Both directions are best-effort/no-throw, same
 * degrade-safely-on-any-failure style as `lib/idb-cache.ts`: a private-
 * browsing tab that blocks storage access, or a corrupt stored value,
 * should just mean the dot starts empty again, never a broken editor. */
const UNBUILT_STORAGE_KEY = "drycms-page-editor-unbuilt-paths";

/** How often this page re-checks the server for MCP-authored page.tsx
 * writes - `ai-page-source-flags.ts`'s red dot. Same cadence
 * `BuilderContentType.tsx`'s own AI-draft poll uses (`AI_DRAFT_POLL_MS`). */
const AI_PAGE_SOURCE_FLAGS_POLL_MS = 25_000;

function loadPersistedUnbuiltPaths(): Set<string> {
  try {
    const raw = sessionStorage.getItem(UNBUILT_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((p): p is string => typeof p === "string")) : new Set();
  } catch {
    return new Set();
  }
}

function persistUnbuiltPaths(paths: Set<string>): void {
  try {
    sessionStorage.setItem(UNBUILT_STORAGE_KEY, JSON.stringify([...paths]));
  } catch {
    // Best-effort - see this constant's own doc comment.
  }
}

/** `reportBuildResult`'s sessionStorage backing - same "survive the
 * self-inflicted reload" need as `UNBUILT_STORAGE_KEY` above, for the same
 * root cause (`app-router-plugin.ts`'s `handleHotUpdate` sends an unscoped
 * Vite `full-reload` the instant `saveAllDirty()`'s write lands, which fires
 * BEFORE this tab's own build result has had time to be shown - found live:
 * a failure would either never render or vanish with the reload before
 * anyone can see it, leaving only a freshly-remounted, misleadingly-empty
 * "No problems detected" panel behind). A real `applyBuildResult` call still
 * fires immediately too (covers the case where nothing was dirty, so no
 * save/reload happens at all) - this is purely a fallback for when the
 * reload wins the race.
 *
 * A build FAILURE is reported through the diagnostics/"Problems" panel
 * instead of a toast (`applyBuildResult`'s own doc comment) - a toast
 * auto-dismisses in 5s, which is the wrong shape for something the user
 * needs to actually read and act on, and doubly so once the self-inflicted
 * reload above is in the picture. Success carries no toast at all
 * (`applyBuildResult`'s own doc comment), so a replayed "success" here is a
 * no-op other than clearing a stale `buildError` - still persisted (rather
 * than special-cased away) so that clearing happens even across the reload. */
const PENDING_BUILD_RESULT_STORAGE_KEY = "drycms-page-editor-pending-toast";
/** Longer than the reload itself ever takes to land (typically well under
 * 1s in dev), short enough that a stray leftover key from a tab that was
 * closed mid-build can never replay as stale on some LATER, unrelated visit
 * to this page. */
const PENDING_BUILD_RESULT_MAX_AGE_MS = 15000;

interface PendingBuildResult {
  type: "success" | "error";
  title: string;
  description?: string;
  at: number;
}

function persistPendingBuildResult(result: Omit<PendingBuildResult, "at">): void {
  try {
    sessionStorage.setItem(PENDING_BUILD_RESULT_STORAGE_KEY, JSON.stringify({ ...result, at: Date.now() }));
  } catch {
    // Best-effort - see this constant's own doc comment.
  }
}

/** Reads back and clears the pending result (if any) - always removed on
 * read, whether or not it turns out to be fresh enough to replay, so it can
 * never fire twice or leak into an unrelated later visit. */
function consumePendingBuildResult(): PendingBuildResult | null {
  try {
    const raw = sessionStorage.getItem(PENDING_BUILD_RESULT_STORAGE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PENDING_BUILD_RESULT_STORAGE_KEY);
    const parsed = JSON.parse(raw) as Partial<PendingBuildResult>;
    if (
      (parsed.type !== "success" && parsed.type !== "error") ||
      typeof parsed.title !== "string" ||
      typeof parsed.at !== "number" ||
      Date.now() - parsed.at > PENDING_BUILD_RESULT_MAX_AGE_MS
    ) {
      return null;
    }
    return parsed as PendingBuildResult;
  } catch {
    return null;
  }
}

/**
 * In-browser page/layout/component source editor (`plans/app-r2.md` Giai
 * đoạn 6 - the last unbuilt piece of "sửa code trong browser"; the storage
 * plumbing (`pagesSourceStorage`, `routes/pages-source.ts`'s write methods)
 * already existed). Deliberately its own page - still a
 * separate route/nav entry from `PageBuild.tsx` - but both now gated on the
 * same merged `PAGE_BUILDER_RESOURCE_ID` ("Page Builder") permission;
 * quyết định #12's original code/build split was merged back into one, see
 * that constant's own doc comment.
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

/** Starter source for a new file in the Component tab - deliberately shows
 * both halves of the component contract at once (a typed props interface,
 * which the preview reads to invent sample values, and an explicit
 * `defaultProps` that overrides them), since neither is discoverable from an
 * empty file. The `_view` escape hatch gets a comment rather than real code:
 * it's the rarer case (see `component-preview.ts`), and a file can't
 * meaningfully show both at once - `_view` wins outright when present. */
const DEFAULT_COMPONENT_SOURCE = `interface Props {
  title: string;
}

export default function Component({ title }: Props) {
  return <div>{title}</div>;
}

export const defaultProps: Props = { title: "Sample title" };

// Or take the preview over entirely - whatever this holds is what the
// preview shows, props and all:
// export const _view = (
//   <>
//     <Component title="Sample title" />
//   </>
// );
`;

/** Starter source for a new file in the Styles tab - just a reminder, not
 * real CSS: unlike a page/component, a new stylesheet isn't reachable on its
 * own (`vite.config.ts`'s Tailwind entry only ever compiles
 * `styles/globals.css`), it has to be pulled in via `@import` first. */
const DEFAULT_STYLES_SOURCE = `/* New stylesheet - add an @import for it to styles/globals.css to use it. */\n`;

/** Starter source for a new file in the MD tab (`MD_ROOT`) - only
 * `README.md` is ever read automatically (`ai-page-source-prompt.ts` embeds
 * it in every Magic Chat turn), so any other file only reaches the model
 * when README.md (or another already-read file) links to it. */
const DEFAULT_MD_SOURCE = `# New document

Write project-specific context for Magic Chat/MCP here - conventions, terminology,
or instructions worth the model knowing before it edits this project's pages,
components, or styles.

Only "README.md" is read automatically. Link to this file from README.md (or another
file the model has already read) so it gets picked up, e.g. [like this](./other.md).
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
    <div style="padding:3rem 1.5rem;margin:1rem;text-align:center;border:2px dashed #ccc5;border-radius:0.5rem;color:#cccc;background-color:#ccc1;font:600 14px/1.5 system-ui,sans-serif;">Children</div>
  );
}
`;

/** `PREVIEW_NAVIGATE_MESSAGE`/`PREVIEW_SAVE_MESSAGE` - the `.page-components-
 * preview-frame` iframe's own bridge - and the `buildPreviewSrcdoc()` call
 * `refreshPreview` below makes now live in `page-preview-engine.ts`, shared
 * with `PageBuilder.tsx` (`plans/new-ui-page-builder.md` mục 10). */

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

/** Max in-flight `api.read` calls during `hydrateInitialTree`'s background
 * sync pass - matches a typical browser's per-origin HTTP connection cap, so
 * this doesn't compete with itself for sockets. */
const BACKGROUND_SYNC_CONCURRENCY = 6;

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
  /** Which sidebar tab (source root - `source-roots.ts`) was last open. */
  activeRoot: string;
  /** The last file focused WITHIN each tab (source root id -> path) - lets
   * `selectRoot` restore that tab's own open file instead of always
   * clearing to nothing, so switching Page -> Component -> Page lands back
   * on the same page rather than an empty editor. Keyed by root id, not
   * just remembered as a single `selectedPath`, since each tab has its own
   * independent "last file" (see `selectRoot`'s doc comment). */
  lastPathByRoot: Record<string, string>;
  sidebarOpen: boolean;
  previewOpen: boolean;
  codeOpen: boolean;
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

/** True when `draft` is provably out of date against `freshContent` - i.e.
 * storage has moved on since this draft was taken (an MCP `write_page_source`
 * call, another admin's Save) - see `PageSourceDraftRecord.baseSource`'s own
 * doc comment. `undefined` `baseSource` (a draft written before that field
 * existed) is treated as unknown rather than stale - there's no evidence
 * either way, so the old "always trust the draft" behavior still applies to
 * it. */
function isDraftStale(draft: PageSourceDraftRecord, freshContent: string): boolean {
  return draft.baseSource !== undefined && draft.baseSource !== freshContent;
}

export default function PageEditor() {
  useDocumentTitle("Page Code Editor");
  const canEdit = canAccess(PAGE_BUILDER_RESOURCE_ID, "setting");
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
  /** Freshest `selectedPath`, readable from inside `hydrateInitialTree`'s
   * async mount routine - the admin can click a different file in the
   * sidebar (painted from cache) while the server tree/priority fetch is
   * still in flight, and the priority fetch should chase whichever file is
   * open AT THAT MOMENT, not whatever was open when the effect started. */
  const selectedPathRef = useRef(selectedPath);
  selectedPathRef.current = selectedPath;
  /** Which source root the sidebar is showing (`source-roots.ts`) - plain
   * state, NOT derived from `selectedPath`: deriving it would snap the tab
   * back the instant the user switched to a tab whose files they haven't
   * opened yet. Seeded from whatever file is open on mount (so a shared
   * `?file=component/Card.tsx` link lands on the right tab), then only moved
   * by an explicit tab click or by opening a file from another root. */
  const [activeRoot, setActiveRoot] = useState<string>(initialUiState?.activeRoot ?? PAGES_ROOT);
  /** `lastPathByRoot`'s doc comment (`PageEditorUiState`) - the per-tab
   * memory `selectRoot` reads/writes. Seeded from `initialUiState` so a
   * reload restores every tab's own last-open file, not just the one that
   * happened to be active. */
  const [lastPathByRoot, setLastPathByRoot] = useState<Record<string, string>>(initialUiState?.lastPathByRoot ?? {});
  /** Keeps `lastPathByRoot` current as the open file changes for any reason
   * (a tree click, a preview-chain crumb, a Magic Chat write, `loadTree`'s
   * own fallback) - cheaper and more complete than updating it at every
   * individual call site that can change `selectedPath`. */
  useEffect(() => {
    if (!selectedPath) return;
    const root = rootOf(selectedPath)?.id;
    if (!root) return;
    setLastPathByRoot((prev) => (prev[root] === selectedPath ? prev : { ...prev, [root]: selectedPath }));
  }, [selectedPath]);
  /** Tab click handler - restores whichever file was last open in the
   * TARGET tab (`lastPathByRoot`) rather than always clearing to nothing,
   * so switching Page -> Component -> Page lands back on the same page
   * instead of an empty editor. Falls back to closing the editor (`""`) when
   * that tab has never had a file open, or the remembered one was since
   * deleted/moved out of the tree. A no-op on the already-active tab
   * (re-clicking "Page" while on "Page" shouldn't close the very file that
   * tab is showing). */
  function selectRoot(rootId: string) {
    if (rootId === activeRoot) return;
    setActiveRoot(rootId);
    const remembered = lastPathByRoot[rootId];
    const stillExists = !!remembered && !!entries?.some((entry) => entry.id === remembered && entry.kind === "file");
    setSelectedPath(stillExists ? remembered! : "");
  }
  /** The open component's default-export props, described from its real TS
   * types by `Editer`'s worker (`describeProps`) - what the preview falls
   * back to when the component exports no `defaultProps`. `null` for a page (no
   * `describeProps`) or a file with no default-exported function. */
  const [propsSchema, setPropsSchema] = useState<PropsSchema | null>(null);
  /** The admin's CURRENT background color, resolved to a concrete value - the
   * component preview stage paints itself with it (see
   * `buildComponentPreviewSource`) so a component previews on the same ground
   * as the editor around it instead of a hardcoded white. Kept in state
   * rather than read during render because the theme class lands on the
   * `.dry` root asynchronously (`applyThemeTransition` flips it INSIDE a view
   * transition callback), so a render-time probe would read the old theme. */
  const [saving, setSaving] = useState(false);
  const [buildingCurrent, setBuildingCurrent] = useState(false);
  const [buildAllProgress, setBuildAllProgress] = useState<{ done: number; total: number } | null>(null);
  /** The rows the delete dialog is confirming - an ARRAY because the tree
   * panel can hand over a whole multi-selection (Cmd/Ctrl+click, Shift+click
   * range), not just the one row that was right-clicked. Empty = closed. */
  const [pendingDelete, setPendingDelete] = useState<FileEntry[]>([]);
  const [deleting, setDeleting] = useState(false);
  /** `styles/` filenames (`core-styles/registry.ts`) `loadTree` found
   * missing THIS session and recreated with their default content - reveals
   * the sidebar's "System" tab (`SYSTEM_ROOT`) for the rest of the session.
   * Session-local on purpose: once recreated, the next `loadTree` finds
   * everything present and simply never repopulates this, so the tab goes
   * back to hidden on its own without needing an explicit dismiss. */
  const [recoveredCoreFiles, setRecoveredCoreFiles] = useState<string[]>([]);
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [historyDialogOpen, setHistoryDialogOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(initialUiState?.sidebarOpen ?? true);
  const [previewOpen, setPreviewOpen] = useState(initialUiState?.previewOpen ?? true);
  // The code column (editor + problems panel) hides the same way the sidebar
  // and preview already do - nothing is lost while it's closed: the edited
  // source lives in `sourceByPath` (state, not the `Editer` instance), so
  // reopening remounts `Editer` on the current, still-dirty content.
  const [codeOpen, setCodeOpen] = useState(initialUiState?.codeOpen ?? true);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(initialUiState?.diagnosticsOpen ?? true);
  // The selected file's own TS diagnostics (`Editer`'s `onChange` already
  // computes these every debounce - see `handleChange` - nothing new to
  // wire into `Editer` itself). Reset on file switch rather than left
  // stale: `Editer` remounts via `key={selectedPath}` and re-reports fresh
  // diagnostics shortly after (its own worker-priming `onChange`), so the
  // brief empty gap reads as "not yet checked", never as a wrong file's
  // errors bleeding into the newly selected one.
  const [diagnostics, setDiagnostics] = useState<EditerDiagnostic[]>([]);

  /** A Build/Build-all FAILURE, shown in the "Problems" panel instead of a
   * toast (`applyBuildResult`'s own doc comment) - unlike `diagnostics`
   * above (the open file's own TS syntax/type errors, positional and
   * cleared on every file switch), this is a whole-build failure with no
   * `line:column` of its own, so it renders as its own block rather than a
   * fake diagnostic entry. Deliberately NOT cleared on `selectedPath`
   * change - a "Build all" failure in particular is rarely about the file
   * currently open, and the user still needs to see it after clicking
   * around. Cleared on the NEXT build attempt (success or failure) and by
   * its own dismiss button. */
  const [buildError, setBuildError] = useState<{ title: string; message: string } | null>(null);

  /** Every `page.tsx` that's been saved since its last successful build in
   * THIS session (`status/error.md`'s "trang nào Save mà chưa build thì có
   * dấu tròn màu vàng") - purely a session-local UI hint (a fresh reload
   * starts empty, same as `PageBuild.tsx`'s own build status not tracking
   * code changes - see that page's own doc comment on `staleResource`),
   * not a claim about what's actually live. Drives `ComponentTreePanel`'s
   * `needsBuild` dot.
   *
   * Persisted to `sessionStorage`, not just `useState` - Save writes the
   * file to real storage under `.dry/pages-source/**`, which
   * `app-router-plugin.ts`'s `handleHotUpdate` (its own doc comment: "the
   * reload broadcast is unscoped") sees and reacts to with an UNSCOPED Vite
   * `full-reload` WS message - sent to every connected client, including
   * THIS tab, the instant the save that dot is celebrating lands. Without
   * this, the dot appears (this component's own `markUnbuilt` call, right
   * after `api.save` resolves) and then vanishes a moment later (the
   * self-inflicted reload remounting the component with a fresh, empty
   * `useState`) - found live, not in review: looks exactly like the dot
   * lying about the save. `sessionStorage` (cleared on tab close, not
   * shared with other tabs) is the same "session-local" scope the state
   * itself already promised, just surviving the ONE dry-reload sees. */
  const [unbuiltPaths, setUnbuiltPaths] = useState<Set<string>>(() => loadPersistedUnbuiltPaths());

  useEffect(() => {
    persistUnbuiltPaths(unbuiltPaths);
  }, [unbuiltPaths]);

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

  /** Every page-source path (`page.tsx`, `layout.tsx`, `component/*`,
   * `styles/*`, `md/*`) an MCP client (`routes/mcp.ts`'s `write_page_source`)
   * has overwritten directly in storage, not yet acknowledged -
   * `ai-page-source-flags.ts`'s global tracker, polled here so it lights up
   * `ComponentTreePanel`'s red dot for a write that happened OUTSIDE this
   * (or any) browser session, unlike `unbuiltPaths` above (session-local,
   * only ever set by this tab's own Save). Cleared server-side by a real
   * Build/Publish of a `page.tsx`, or the next explicit Save of that exact
   * path by any session (`ai-page-source-flags.ts`'s own doc comment) -
   * never removed client-side. */
  const [aiWrittenPaths, setAiWrittenPaths] = useState<Set<string>>(new Set());
  const aiFlagsLastVersion = useRef<number | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    async function poll() {
      try {
        const headers =
          aiFlagsLastVersion.current === undefined ? undefined : { "X-Data-Version": String(aiFlagsLastVersion.current) };
        const res = await fetch(`${path}/api/ai-page-source-flags`, { credentials: "same-origin", headers });
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as { changed: boolean; version: number; flags?: { path: string }[] };
        aiFlagsLastVersion.current = body.version;
        if (!body.changed || cancelled) return;
        setAiWrittenPaths(new Set((body.flags ?? []).map((f) => f.path)));
      } catch {
        // Leave the previous set showing - a transient poll failure isn't worth surfacing.
      }
    }
    void poll();
    const timer = window.setInterval(() => void poll(), AI_PAGE_SOURCE_FLAGS_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

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
        activeRoot,
        lastPathByRoot,
        sidebarOpen,
        previewOpen,
        codeOpen,
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
    activeRoot,
    lastPathByRoot,
    sidebarOpen,
    previewOpen,
    codeOpen,
    diagnosticsOpen,
    sidebar.size,
    previewSplit.size,
    diagnosticsSplit.size,
    viewport.key,
    manualZoom,
  ]);

  /** Fetches the authoritative file tree from the server (or the R2/S3
   * per-folder fallback), restoring any missing core `styles/` file along
   * the way - the one piece `loadTree` and the mount-only
   * `hydrateInitialTree` both need, factored out so neither has to
   * duplicate the core-style-recovery toast logic. */
  async function fetchAndReconcileEntries(): Promise<FileEntry[]> {
    const result = await api.listTree();
    let all = result.supported ? result.entries : await listAllFileEntriesRecursive("");

    // Core `styles/` files (`core-styles/registry.ts`) back a hardcoded
    // Vite build entry and each other's `@import`s (`source-roots.ts`'s
    // `isCoreStyleFilePath` doc comment) - restore any missing one (a
    // fresh checkout, or an old project predating this lock) instead of
    // leaving the Styles tab, and the build, silently broken.
    const existingIds = new Set(all.filter((entry) => entry.kind === "file").map((entry) => entry.id));
    const missing = CORE_STYLE_FILES.filter((file) => !existingIds.has(`${STYLES_ROOT}/${file.name}`));
    if (missing.length > 0) {
      const restored = await Promise.all(
        missing.map((file) => api.save(`${STYLES_ROOT}/${file.name}`, file.defaultContent).catch(() => null)),
      );
      all = [...all, ...restored.filter((entry): entry is FileEntry => !!entry)];
      const restoredNames = missing.filter((_, index) => restored[index]).map((file) => file.name);
      if (restoredNames.length > 0) {
        setRecoveredCoreFiles(restoredNames);
        toast.add({
          type: "info",
          title: restoredNames.length > 1 ? `Restored ${restoredNames.length} built-in style files.` : `Restored ${restoredNames[0]}.`,
          description: "See the System tab.",
        });
      }
    }
    return all;
  }

  /** Returns the freshly-fetched SAVED map (no draft overlay) on success, or
   * `null` on failure - `handleGithubRestoreApplied` below builds directly
   * from this return value rather than `savedByPath` state, since a state
   * setter's effect isn't visible to a closure still running in the same
   * async call (the same staleness `saveAllDirty`'s own doc comment already
   * calls out for the ordinary Save-then-Build path). Always fetches every
   * file's content fresh and in parallel (never serves stale cache) - every
   * caller (post-mutation refreshes, the GitHub restore reload) needs a
   * guaranteed-current map, unlike the mount-only `hydrateInitialTree`
   * below. Still keeps the IndexedDB content cache in sync as a side effect,
   * so a later mount finds accurate cached content. */
  async function loadTree(): Promise<Record<string, string> | null> {
    try {
      const all = await fetchAndReconcileEntries();
      setEntries(all);
      void putPagesTreeCache(all);
      const files = all.filter((entry) => entry.kind === "file" && /\.(tsx?|css|md)$/i.test(entry.name));
      const contents = await Promise.all(files.map((file) => api.read(file.id).catch(() => "")));
      const nextSource: Record<string, string> = {};
      const nextIds = new Set<string>();
      files.forEach((file, index) => {
        nextSource[file.id] = contents[index]!;
        nextIds.add(file.id);
      });
      setSavedByPath(nextSource);
      files.forEach((file, index) => void putPageSourceCache(file.id, contents[index]!));
      for (const cached of await getAllPageSourceCache()) {
        if (!nextIds.has(cached.path)) void deletePageSourceCache(cached.path);
      }

      // Overlay any unsaved edit recovered from IndexedDB on top of the
      // freshly-loaded saved content - but only for a file that's still in
      // the tree (a draft for a since-deleted/renamed path is stale, so it's
      // dropped here rather than resurrected) AND only when storage hasn't
      // moved on since the draft was taken (`isDraftStale`) - otherwise an
      // MCP write or another session's Save would sit silently masked behind
      // a stale local draft on every load, invisible until IndexedDB was
      // cleared by hand.
      const drafts = await getAllPageSourceDrafts();
      const withDrafts = { ...nextSource };
      const discardedStalePaths: string[] = [];
      for (const draft of drafts) {
        if (!(draft.path in nextSource)) {
          void deletePageSourceDraft(draft.path);
        } else if (isDraftStale(draft, nextSource[draft.path]!)) {
          void deletePageSourceDraft(draft.path);
          discardedStalePaths.push(draft.path);
        } else {
          withDrafts[draft.path] = draft.source;
        }
      }
      if (discardedStalePaths.length > 0) {
        toast.add({
          type: "info",
          title: discardedStalePaths.length > 1 ? `${discardedStalePaths.length} files changed elsewhere` : `"${discardedStalePaths[0]}" changed elsewhere`,
          description: "Storage has a newer version than your unsaved local edit, so the local one was discarded.",
        });
      }
      setSourceByPath(withDrafts);

      setSelectedPath((current) => {
        if (current && withDrafts[current] !== undefined) return current;
        return files.length > 0 ? files[0]!.id : "";
      });
      return nextSource;
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to load pages source.");
      return null;
    }
  }

  /** Mount-only alternative to `loadTree()` - same end state, but optimized
   * for "just opened the page" instead of "just need a guaranteed-fresh
   * map": paints the sidebar and the currently-open file from the
   * IndexedDB content cache FIRST (before any network request resolves),
   * then fetches the real tree, re-fetches whichever file is open with
   * priority (so it's interactive as fast as possible), and only then walks
   * the remaining files in the background via a small bounded-concurrency
   * pool (`BACKGROUND_SYNC_CONCURRENCY`) - overwriting the cache only for a
   * file whose content actually changed. `isCancelled` is
   * checked between network hops so navigating away mid-walk stops it. */
  async function hydrateInitialTree(isCancelled: () => boolean) {
    const [cachedTree, cachedFiles, drafts] = await Promise.all([
      getPagesTreeCache(),
      getAllPageSourceCache(),
      getAllPageSourceDrafts(),
    ]);
    const draftMap: Record<string, PageSourceDraftRecord> = {};
    for (const draft of drafts) draftMap[draft.path] = draft;

    const cachedSource: Record<string, string> = {};
    for (const file of cachedFiles) cachedSource[file.path] = file.source;

    if (cachedTree) setEntries(cachedTree);
    if (cachedFiles.length > 0) {
      setSavedByPath(cachedSource);
      // Purely an optimistic first paint, before the real network fetch
      // below has even started - not staleness-checked against `isDraftStale`
      // (there's no fresh content yet to check against). `applyFresh` below
      // corrects this moments later once the real read resolves, discarding
      // the draft then if it turns out to be stale.
      const withDrafts = { ...cachedSource };
      for (const path in draftMap) if (path in cachedSource) withDrafts[path] = draftMap[path]!.source;
      setSourceByPath(withDrafts);
    }

    if (isCancelled()) return;
    let all: FileEntry[];
    try {
      all = await fetchAndReconcileEntries();
    } catch (error) {
      // A cache paint already happened above (if any) - only surface the
      // error if there was nothing to fall back to.
      if (cachedFiles.length === 0) setLoadError(error instanceof Error ? error.message : "Failed to load pages source.");
      return;
    }
    if (isCancelled()) return;
    setEntries(all);
    void putPagesTreeCache(all);

    const files = all.filter((entry) => entry.kind === "file" && /\.(tsx?|css|md)$/i.test(entry.name));
    const fileIds = new Set(files.map((file) => file.id));
    for (const cached of cachedFiles) {
      if (!fileIds.has(cached.path)) void deletePageSourceCache(cached.path);
    }
    setSelectedPath((current) => (current && fileIds.has(current) ? current : (files[0]?.id ?? "")));

    const discardedStalePaths: string[] = [];
    function applyFresh(file: FileEntry, content: string) {
      if (cachedSource[file.id] !== content) void putPageSourceCache(file.id, content);
      setSavedByPath((prev) => ({ ...prev, [file.id]: content }));
      const draft = draftMap[file.id];
      // Storage moved on since this draft was taken (an MCP write, another
      // session's Save) - drop it and show the fresh copy instead of masking
      // it forever, same reasoning `loadTree`'s own overlay uses.
      if (draft !== undefined && isDraftStale(draft, content)) {
        void deletePageSourceDraft(file.id);
        discardedStalePaths.push(file.id);
      }
      const visible = draft !== undefined && !isDraftStale(draft, content) ? draft.source : content;
      setSourceByPath((prev) => ({ ...prev, [file.id]: visible }));
    }

    const priorityFile = files.find((file) => file.id === selectedPathRef.current) ?? files[0];
    const rest = files.filter((file) => file !== priorityFile);

    if (priorityFile) {
      try {
        applyFresh(priorityFile, await api.read(priorityFile.id));
      } catch {
        // Transient failure - leave whatever cache/state already has for
        // this file rather than blanking it out.
      }
    }

    // Bounded-concurrency background sync - not fully sequential (would be
    // needlessly slow for a large project) and not `Promise.all` either
    // (that's the original all-at-once burst this whole flow exists to
    // avoid); a small worker pool keeps at most `BACKGROUND_SYNC_CONCURRENCY`
    // requests in flight, each worker pulling the next file off `rest` as it
    // finishes, so the walk still drains in roughly the priority order files
    // appear in the tree without stalling on one file at a time.
    let cursor = 0;
    async function worker() {
      for (;;) {
        if (isCancelled()) return;
        const file = rest[cursor++];
        if (!file) return;
        try {
          applyFresh(file, await api.read(file.id));
        } catch {
          // Transient failure - skip this file, keep going.
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(BACKGROUND_SYNC_CONCURRENCY, rest.length) }, worker));
    if (!isCancelled() && discardedStalePaths.length > 0) {
      toast.add({
        type: "info",
        title: discardedStalePaths.length > 1 ? `${discardedStalePaths.length} files changed elsewhere` : `"${discardedStalePaths[0]}" changed elsewhere`,
        description: "Storage has a newer version than your unsaved local edit, so the local one was discarded.",
      });
    }
  }

  useEffect(() => {
    if (!canEdit) return;
    let cancelled = false;
    void hydrateInitialTree(() => cancelled);
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
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit]);

  /** Where a Build/Build-all result actually shows up: success carries no
   * toast and no lingering message - the "Problems" panel header's status
   * (`buildingCurrent`/`buildAllProgress`, rendered in the JSX below) already
   * shows a running status while the build is in flight, and reverts to "No
   * problems" the moment it finishes, which IS the success signal. Failure
   * goes into the "Problems" panel (`buildError` above) instead - opened if
   * it was collapsed, since silently setting state behind a closed panel
   * would defeat the point. Shared by the real call sites below
   * (`reportBuildResult`) AND the post-reload replay effect right after this
   * one, so a failure that only became visible after the self-inflicted
   * reload lands in exactly the same place a same-tick failure would have. */
  function applyBuildResult(result: Omit<PendingBuildResult, "at">): void {
    if (result.type === "success") {
      setBuildError(null);
    } else {
      setBuildError({ title: result.title, message: result.description ?? "" });
      setDiagnosticsOpen(true);
    }
  }

  /** Every Build/Build-all success or failure goes through here - persists
   * to sessionStorage (`PENDING_BUILD_RESULT_STORAGE_KEY`'s doc comment, for
   * the self-inflicted-reload race) THEN applies it immediately, so the
   * common no-reload case (nothing was dirty) still shows up with no delay. */
  function reportBuildResult(result: Omit<PendingBuildResult, "at">): void {
    persistPendingBuildResult(result);
    applyBuildResult(result);
  }

  // Replays a Build/Build-all result left behind by the previous mount of
  // this same tab, if the self-inflicted `full-reload`
  // (`PENDING_BUILD_RESULT_STORAGE_KEY`'s doc comment) fired before it could
  // be read. Deliberately not gated on `canEdit` - a pending result can only
  // exist here if a build already ran, which requires having had edit
  // access at the time.
  useEffect(() => {
    const pending = consumePendingBuildResult();
    if (pending) applyBuildResult(pending);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const code = selectedPath ? (sourceByPath[selectedPath] ?? "") : "";
  const dirty = !!selectedPath && sourceByPath[selectedPath] !== savedByPath[selectedPath];
  /** True when ANY file (not just the one open) differs from what's on
   * storage - Magic Chat can write to a file other than `selectedPath` (or
   * create a brand new one) while the admin is looking at something else, so
   * gating Save on `dirty` alone left those writes with no way to persist:
   * the button stayed disabled until the admin happened to open that exact
   * other file. `handleSave` below saves every one of these, not just
   * `selectedPath`, so this is what actually gates it. */
  const anyDirty = Object.keys(sourceByPath).some((p) => sourceByPath[p] !== savedByPath[p]);
  /** The open file is a component (`component/**`, `source-roots.ts`) rather
   * than a route file - drives the preview mode, the props-schema request to
   * `Editer`, and which starter source a new file gets. */
  const isComponentPath = !!selectedPath && rootOf(selectedPath)?.id === COMPONENT_ROOT;
  /** A `component/` file with nothing to preview - a plain `.ts` helper
   * (e.g. `component/lib/utils.ts`), not a `.tsx` component. `previewTarget`
   * below resolves to `null` for this exactly like "nothing selected" does,
   * but the fallback panel needs to tell the two apart: this one gets a
   * plain "No preview" placeholder, not the generic "select a file" hint. */
  const isUnpreviewableComponentFile = isComponentPath && !/\.tsx$/i.test(selectedPath);
  /** `md/` (`MD_ROOT`) holds plain AI-context Markdown, never anything
   * `previewTarget` could render - the whole panel auto-collapses while one
   * is open (not just a placeholder, unlike `isUnpreviewableComponentFile`
   * above: there's no "component preview" equivalent for prose, so the
   * space is better spent on the editor). Derived from `previewOpen` rather
   * than writing to it, so the user's manual open/closed preference is
   * preserved underneath and reasserts itself the moment they select a
   * previewable file again - no explicit save/restore needed. */
  const isMdPath = !!selectedPath && rootOf(selectedPath)?.id === MD_ROOT;
  const previewVisible = previewOpen && !isMdPath;
  /** Same root-based rule `editorLanguage` below applies to `selectedPath`,
   * generalized to any path - `handleSave` needs this for every dirty file
   * it saves, not just whichever one is currently open. */
  function languageForPath(filePath: string): EditerFormatLanguage {
    const root = rootOf(filePath)?.id;
    if (root === STYLES_ROOT) return "css";
    if (root === MD_ROOT) return "md";
    return "tsx";
  }

  /** Mirrors `Editer`'s own `language` prop below - shared so `handleSave`'s
   * format-on-save runs through the exact same Prettier parser `Editer`
   * itself would for this file. */
  const editorLanguage: EditerFormatLanguage = languageForPath(selectedPath);

  // Clears stale diagnostics from whatever file was open before - `Editer`
  // remounts on `selectedPath` (its own `key`) and reports fresh ones via
  // `handleChange` shortly after, this just covers the gap in between. The
  // props schema is dropped for the same reason, and harder: a stale one
  // would put the PREVIOUS component's sample props on this one.
  useEffect(() => {
    setDiagnostics([]);
    setPropsSchema(null);
  }, [selectedPath]);

  /** Follows the open file into its own tab - covers a `?file=` deep link on
   * mount, a preview-chain crumb, and `loadTree`'s own "nothing selected, take
   * the first file" fallback alike. Only reacts to the FILE changing, so
   * clicking a tab (which changes no file) still just switches the tab. */
  useEffect(() => {
    const root = rootOf(selectedPath)?.id;
    if (root) setActiveRoot(root);
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
    // `md/` (`MD_ROOT`) holds plain Markdown, never TS/TSX a page/component
    // could import - handing its content to the TS Language Service as an
    // "extra file" would be pure noise (nothing ever resolves an import to
    // it) and it isn't real source for that worker to reason about.
    for (const key of Object.keys(rest)) {
      if (rootOf(key)?.id === MD_ROOT) delete rest[key];
    }
    if (dryTypes) rest["dry.generated.d.ts"] = dryTypes;
    return rest;
  }, [sourceByPath, selectedPath, dryTypes]);

  /** Same expanded stylesheet input preview/build compile. Keep the last
   * valid graph while a relative import is temporarily incomplete during
   * editing, so autocomplete doesn't collapse back to the default theme. */
  const lastValidTailwindStylesheetRef = useRef<string>();
  const tailwindStylesheet = useMemo(() => {
    try {
      const next = tailwindStylesheetSource(sourceByPath);
      lastValidTailwindStylesheetRef.current = next;
      return next;
    } catch {
      return lastValidTailwindStylesheetRef.current;
    }
  }, [sourceByPath]);

  /** Every file that already exists in this project's source tree, for
   * `PageSourceMagicChat`'s own orientation (`PageSourceMagicChatProps.projectFiles`'s
   * doc comment) - Magic now has authority to write ANY of these (or a new
   * path), not just whatever's currently open. */
  const projectFiles = useMemo(() => Object.keys(sourceByPath), [sourceByPath]);

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

  /** `baseSource` is `savedByPath[filePath]` at the moment this edit
   * diverged from it - stored alongside the draft so a later hydrate
   * (`hydrateInitialTree`/`loadTree`) can tell whether storage has moved on
   * since (an MCP write, another session's Save) and the draft is now stale,
   * rather than always trusting whatever's sitting in IndexedDB. */
  function scheduleDraftWrite(filePath: string, source: string, baseSource: string) {
    cancelDraftWrite(filePath);
    pendingDraftWrites.current.set(
      filePath,
      setTimeout(() => {
        pendingDraftWrites.current.delete(filePath);
        void putPageSourceDraft(filePath, source, baseSource);
      }, 300),
    );
  }

  function handleChange(result: EditerResult) {
    if (!selectedPath) return;
    setSourceByPath((prev) => (prev[selectedPath] === result.code ? prev : { ...prev, [selectedPath]: result.code }));
    setDiagnostics(result.errors);
    // Only ever present for a component (`describeProps`), so this can't
    // clobber a page's own (absent) schema - see `propsSchema`'s doc comment.
    if (result.propsSchema !== undefined) setPropsSchema(result.propsSchema);
    if (result.code === savedByPath[selectedPath]) {
      cancelDraftWrite(selectedPath);
      void deletePageSourceDraft(selectedPath);
    } else {
      scheduleDraftWrite(selectedPath, result.code, savedByPath[selectedPath] ?? "");
    }
  }

  /** Saves EVERY dirty file, not just `selectedPath` - a Magic Chat write to
   * some other (or brand new) file is just as much "real new content to
   * persist" as a hand-typed edit to the one currently open, and leaving it
   * out silently stranded it in the in-memory buffer forever unless the
   * admin happened to open that exact file (see `handleMagicCodeChange`'s
   * doc comment - `anyDirty` is what gates this now, not `dirty`). Reformats
   * each file (Prettier, via its own `languageForPath`) before persisting it,
   * same as before, and updates `sourceByPath` too so the editor visibly
   * shows the reformatted text rather than the saved copy silently drifting
   * from what's on screen. */
  async function handleSave() {
    const dirtyPaths = Object.keys(sourceByPath).filter((p) => sourceByPath[p] !== savedByPath[p]);
    if (dirtyPaths.length === 0) return;
    setSaving(true);
    try {
      const formattedByPath: Record<string, string> = {};
      for (const p of dirtyPaths) {
        formattedByPath[p] = (await formatCode(sourceByPath[p] ?? "", languageForPath(p))).code;
      }
      setSourceByPath((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const p of dirtyPaths) {
          if (next[p] !== formattedByPath[p]) {
            next[p] = formattedByPath[p]!;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
      for (const p of dirtyPaths) await api.save(p, formattedByPath[p]!);
      const nextSaved = { ...savedByPath };
      for (const p of dirtyPaths) {
        nextSaved[p] = formattedByPath[p]!;
        cancelDraftWrite(p);
        void deletePageSourceDraft(p);
      }
      setSavedByPath(nextSaved);
      // Not just these files: saving a shared component (or a layout) leaves
      // every page rendering through it stale too, and the yellow dot is the
      // only signal that says so - `markUnbuilt` keeps only `page.tsx` paths,
      // so handing it the files themselves as well is harmless.
      markUnbuilt(dirtyPaths.flatMap((p) => [p, ...pagesAffectedBy(p, nextSaved)]));
    } catch (error) {
      toast.add({ type: "error", title: "Save failed", description: error instanceof Error ? error.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  /** What `Cmd/Ctrl+S` actually does, kept in a ref that's refreshed after
   * every render. Both listeners that call it (the window `keydown` below,
   * and the preview-iframe `message` handler further down) are registered
   * with dep arrays that deliberately don't re-run per keystroke, so calling
   * `handleSave` from inside them directly would fire a closure holding an
   * old `sourceByPath`/`anyDirty` pair and save stale content. Guarded
   * exactly like the Save button's own `disabled={!anyDirty || saving}`: a
   * no-op with nothing dirty anywhere rather than a pointless write that
   * would also light up the unbuilt dot (`markUnbuilt`) for a page nothing
   * changed in. Still requires a file to be open - `handleSave` has
   * something to save even with `selectedPath` empty (an other-file Magic
   * write), but there's no Save button visible in that state either
   * (`{selectedPath && (...)}` below), so firing on Ctrl/Cmd+S there would
   * save with no visible affordance that anything happened. */
  const saveShortcutRef = useRef<() => void>(() => {});
  useEffect(() => {
    saveShortcutRef.current = () => {
      if (!selectedPath || !anyDirty || saving) return;
      void handleSave();
    };
  });

  /** `Cmd/Ctrl+S` saves the open file instead of letting the browser open its
   * own "Save page as…" dialog - the browser's copy of this screen is useless,
   * and it's the keystroke every editor user reaches for. `preventDefault`
   * runs UNCONDITIONALLY, even with no file open or nothing dirty: swallowing
   * the browser default is the point of the binding, and letting it through in
   * exactly those cases would be the worse surprise. Capturing-phase on
   * `window` so it fires wherever focus sits - `Editer`'s own `<textarea>`
   * keydown handlers included (none of which bind this key, but they'd
   * otherwise win the race). `event.key` rather than the `event.code` the
   * Editer hotkeys use: `code` is the physical key position, but the browser
   * shortcut being overridden here follows the CHARACTER, so on a non-QWERTY
   * layout `code` would preventDefault on the wrong physical key and let the
   * real one through. `Ctrl`/`Meta` (unlike `Alt`) never substitute the
   * character, so `key` is a reliable "s" on every layout. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "s" || event.altKey || event.shiftKey || !(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      saveShortcutRef.current();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

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
      markUnbuilt(dirtyPaths.flatMap((p) => [p, ...pagesAffectedBy(p, next)]));
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

  /** `PageSourceMagicChat`'s own write callback - the exact same
   * `setSourceByPath` seam `handleChange`/`handleReset` already use, so an
   * AI edit is indistinguishable from a hand-typed one to the rest of this
   * page. When `changedPath === selectedPath`, `Editer`'s own value-sync
   * effect reacts to the changed prop and re-runs `handleChange` itself
   * (diagnostics + draft persistence included) - nothing extra needed here.
   * A write to some OTHER (not currently open) path only updates in-memory
   * state here; it isn't draft-persisted to IndexedDB until the admin opens
   * that file (which mounts a fresh `Editer` and primes normally). It IS
   * covered by Save, though (`handleSave`'s own doc comment) - `anyDirty`
   * gates that button on every path in `sourceByPath`, not just
   * `selectedPath`, precisely so a multi-file Magic turn doesn't leave
   * anything stranded in the buffer. See `status/page-editor-magic-chat.md`.
   *
   * Magic can now target a path with no `FileEntry` yet (a brand new file -
   * `ai-page-source-protocol.ts`'s `PageSourceCodeTurn` isn't limited to
   * existing paths) - `entries` gets a synthetic `file` row for it so the
   * tree/tab it belongs to can actually show and select it, exactly like a
   * real one it just hasn't been told about yet (`handleCreateFile`'s own
   * `loadTree()` call plays the identical role for a HAND-created file, just
   * from the server instead of client-side - this one's genuinely unsaved,
   * so there's nothing to reload from yet). Ancestor FOLDER rows aren't
   * synthesized the same way - a file whose parent folder doesn't already
   * have its own row still renders (`ComponentTreePanel`'s tree builder
   * falls back to the tab's root for an unknown `parentId`), just not nested
   * under a folder that doesn't visually exist yet either. */
  function handleMagicCodeChange(changedPath: string, code: string) {
    setSourceByPath((prev) => (prev[changedPath] === code ? prev : { ...prev, [changedPath]: code }));
    setEntries((prev) => {
      if (!prev || prev.some((entry) => entry.id === changedPath)) return prev;
      const slash = changedPath.lastIndexOf("/");
      const name = slash === -1 ? changedPath : changedPath.slice(slash + 1);
      const parentId = slash === -1 ? null : changedPath.slice(0, slash);
      return [...prev, { id: changedPath, name, parentId, kind: "file" }];
    });
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
    setBuildError(null);
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
      const sourceHash = await computeSourceHash(previewTarget, saved);
      await publishBuiltPage(result, { pagesBuildEndpoint: `${path}/api/pages-build`, pathname: previewTarget.pathname, entryPath: previewTarget.entryPath, sourceHash });
      clearUnbuilt([previewTarget.entryPath]);
      reportBuildResult({ type: "success", title: `Built "${previewTarget.pathname}"` });
      await reportGithubSync(`Build: ${previewTarget.pathname} - ${new Date().toISOString()}`);
    } catch (error) {
      const message = error instanceof PageBuildError || error instanceof Error ? error.message : "Build failed.";
      reportBuildResult({ type: "error", title: `Failed to build "${previewTarget.pathname}"`, description: message });
    } finally {
      setBuildingCurrent(false);
    }
  }

  /** The shared core of "Build all" - builds+publishes every page on the
   * site (static + resolved dynamic) from a GIVEN saved-content map, never
   * reading `sourceByPath`/`savedByPath` state directly. Split out of
   * `handleBuildAll` so `handleGithubRestoreApplied` can build from
   * `loadTree()`'s own return value instead: `savedByPath` state wouldn't
   * reflect a GitHub pull yet at the point this needs to run (a `useState`
   * setter's effect isn't visible to a closure still executing in the same
   * async call), and building from that stale closure would publish the
   * PRE-pull code right after telling the admin the pull succeeded. */
  async function buildAllFrom(saved: Record<string, string>) {
    if (!allTypes || !assetHrefs) return;
    const BATCH_SIZE = 5;
    setBuildAllProgress({ done: 0, total: 0 });
    setBuildError(null);
    try {
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
        const sourceHash = await computeSourceHash(target, saved);
        batch.push({ result, options: { pagesBuildEndpoint: `${path}/api/pages-build`, pathname, entryPath: target.entryPath, sourceHash } });
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
      reportBuildResult({ type: "success", title: `Built ${done} ${done === 1 ? "page" : "pages"}` });
      await reportGithubSync(`Build all: ${done} pages - ${new Date().toISOString()}`);
    } catch (error) {
      const message = error instanceof PageBuildError || error instanceof Error ? error.message : "Build failed.";
      reportBuildResult({ type: "error", title: "Build all failed", description: message });
    } finally {
      setBuildAllProgress(null);
    }
  }

  /** Saves every dirty file first (`saveAllDirty()`'s return value, see
   * `handleBuildCurrent`'s doc comment for why not `savedByPath` state
   * directly), then hands it to `buildAllFrom`. The topbar's "Build all"
   * button. */
  async function handleBuildAll() {
    const saved = await saveAllDirty();
    await buildAllFrom(saved);
  }

  /** `GithubResetDialog`/`GithubHistoryDialog`'s shared `onApplied` -
   * `pages-source-github-restore.ts`'s `POST` already overwrote
   * `pagesSourceStorage` server-side by the time this runs; this just
   * catches this editor up: reload the tree (drops any now-stale
   * `sourceByPath`/drafts for files the pull removed or changed) and rebuild
   * straight from `loadTree()`'s own freshly-fetched map - never
   * `savedByPath` state, which is still the PRE-pull content at this point
   * (see `buildAllFrom`'s doc comment). */
  async function handleGithubRestoreApplied() {
    const saved = await loadTree();
    if (saved) await buildAllFrom(saved);
  }

  async function handleCreateFile(name: string) {
    // The tree panel builds `name` from the (root-rebased) folder the user
    // is creating in, so a file typed at the tab's own root arrives with no
    // source root on it - see `withSourceRoot`. `styles/`/`md/` default to
    // `.css`/`.md` (and their own starter content) instead of `.tsx` - the
    // two roots that aren't TS/TSX (`pages-source.ts`'s own
    // `isPageSourceFileName`).
    const isStyles = activeRoot === STYLES_ROOT;
    const isMd = activeRoot === MD_ROOT;
    const extension = isStyles ? ".css" : isMd ? ".md" : ".tsx";
    const hasExtension = isStyles ? /\.css$/i.test(name) : isMd ? /\.md$/i.test(name) : /\.tsx?$/i.test(name);
    const filePath = withSourceRoot(activeRoot, hasExtension ? name : `${name}${extension}`);
    const starterSource = isStyles
      ? DEFAULT_STYLES_SOURCE
      : isMd
        ? DEFAULT_MD_SOURCE
        : activeRoot === COMPONENT_ROOT
          ? DEFAULT_COMPONENT_SOURCE
          : DEFAULT_PAGE_SOURCE;
    try {
      await api.save(filePath, starterSource);
      await loadTree();
      setSelectedPath(filePath);
      toast.add({ type: "success", title: `Created "${filePath}".` });
    } catch (error) {
      toast.add({ type: "error", title: "Failed to create file", description: error instanceof Error ? error.message : undefined });
    }
  }

  async function handleCreateFolder(rawName: string) {
    const name = withSourceRoot(activeRoot, rawName);
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
    if (pendingDelete.length === 0) return;
    setDeleting(true);
    try {
      // Sequential, not `Promise.all`: these hit the same storage tree (a
      // folder and a file inside it can both be in the set), and the
      // adapters make no ordering guarantee for concurrent writes.
      for (const entry of pendingDelete) {
        await api.remove(entry.id);
        cancelDraftWrite(entry.id);
        void deletePageSourceDraft(entry.id);
      }
      if (pendingDelete.some((entry) => entry.id === selectedPath)) setSelectedPath("");
      setPendingDelete([]);
      await loadTree();
      toast.add({ type: "success", title: pendingDelete.length > 1 ? `Deleted ${pendingDelete.length} items.` : "Deleted." });
    } catch (error) {
      toast.add({ type: "error", title: "Delete failed", description: error instanceof Error ? error.message : undefined });
    } finally {
      setDeleting(false);
    }
  }

  /** Copy/paste in the tree panel: the panel holds the clipboard (which paths
   * were copied), this side does the actual work, because only it has the file
   * CONTENT (`sourceByPath`) and knows about source roots.
   *
   * Deliberately pastes the SAVED content, not the open editor buffer -
   * `savedByPath` is what the original file actually is on storage right now,
   * and silently baking someone's unsaved half-edit into a new file would be
   * the kind of surprise nothing later undoes. Relative imports get rebased
   * through `rewriteImportsAfterMove` (the copy's own imports only - every
   * OTHER file still points at the original, which hasn't moved), so pasting
   * into a different folder doesn't produce a file with broken `./` paths. */
  async function handlePaste(paths: string[], destFolder: string) {
    // `""` is the tab's own tree root, which on storage IS the root folder -
    // rooting it here (rather than `withSourceRoot`-ing the result) is what
    // makes the collision check below compare like-for-like against the real,
    // fully-rooted paths in `taken`.
    const folder = destFolder || activeRoot;
    const taken = new Set(Object.keys(sourceByPath));
    const created: string[] = [];
    try {
      for (const from of paths) {
        const content = savedByPath[from] ?? sourceByPath[from];
        if (content === undefined) continue;
        const to = copyDestinationPath(taken, folder, from);
        // Reserve it before the next iteration looks for a free name -
        // pasting 2 copies into the same folder must not pick it twice.
        taken.add(to);
        // A one-entry map on purpose: this only wants the COPY's own imports
        // rebased. The full map would also return rewrites for every file
        // importing the original - which must keep pointing at the original.
        const rewrites = rewriteImportsAfterMove({ [from]: content }, from, to);
        await api.save(to, rewrites[to] ?? content);
        created.push(to);
      }
      if (created.length === 0) return;
      await loadTree();
      setSelectedPath(created[created.length - 1]!);
      toast.add({ type: "success", title: created.length > 1 ? `Pasted ${created.length} files.` : `Pasted "${created[0]}".` });
    } catch (error) {
      toast.add({ type: "error", title: "Paste failed", description: error instanceof Error ? error.message : undefined });
      if (created.length > 0) await loadTree();
    }
  }

  /** Move (rename or drag into another folder) - also recomputes any
   * relative import affected by the path change, same as
   * `PageComponents.tsx`'s own `handleMove`. */
  async function handleMove(from: string, rawTo: string) {
    // A move stays inside the root the file came from (a drag to the tab's
    // own tree root arrives with the root folder stripped, same as a create).
    const to = withSourceRoot(rootOf(from)?.id ?? activeRoot, rawTo);
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
  /** Object URLs backing the CURRENT iframe's import map (`refreshPreview`'s
   * interactive-hydration step) - tracked so they can be revoked once the
   * iframe no longer needs them, instead of leaking one `Blob` per compiled
   * file on every debounced edit. Revoked only after the NEXT build's srcdoc
   * assignment has already started the old iframe document's teardown (see
   * `refreshPreview`), and on unmount. */
  const previewBlobUrlsRef = useRef<string[]>([]);
  useEffect(() => {
    return () => {
      for (const url of previewBlobUrlsRef.current) URL.revokeObjectURL(url);
      previewBlobUrlsRef.current = [];
    };
  }, []);

  const manifest = useMemo(() => buildManifestRouteTree(Object.keys(sourceByPath)), [sourceByPath]);

  /** Every `[param]` page template in the tree (`blogs/[slug]/page.tsx`
   * etc.) - the dynamic-route counterpart to `staticPagePaths`, which
   * `previewTarget` below already walks for static pages. */
  const dynamicTemplates = useMemo(() => listDynamicPageTemplates(manifest), [manifest]);
  const dynamicTemplate = useMemo(
    () => (selectedPath ? (dynamicTemplates.find((t) => t.entryPath === selectedPath) ?? null) : null),
    [dynamicTemplates, selectedPath],
  );

  /** Which collection the open `[param]` template renders one entry of, read
   * straight off its own `dry().collection(x).get(...)` call
   * (`page-collection.ts` - the replacement for the removed `seoUrlPattern`).
   * Reads `savedByPath`, not `sourceByPath`: the preview builds from saved
   * content anyway (`handleBuildCurrent` saves first), so re-resolving on
   * every keystroke would be both wrong and needless - switching file or
   * saving a changed `dry().collection(...)` re-resolves, typing does not. */
  const dynamicType = useMemo(
    () => (dynamicTemplate && allTypes ? collectionTypeForPageSource(savedByPath[dynamicTemplate.entryPath], allTypes) : null),
    [dynamicTemplate, allTypes, savedByPath],
  );

  /** The real, published rows the open `[param]` template can be previewed
   * against - the picker's options, and (its first row) the default target
   * when nothing has been picked yet. Capped: a picker is for eyeballing a
   * few representative entries, not for paging through a whole collection,
   * and the build path ("Build all", `resolveAllPageTargets`) is what
   * enumerates every row.
   *
   * Through `useFetch` for the same reason every other list on this app is:
   * IndexedDB answers instantly on the next visit while `dry-http`'s
   * `X-Dry-Resource-Version` decides whether anything actually changed (see
   * `fetchPreviewEntries`). `notify: false` - a background refresh of a
   * preview-only list isn't the kind of "new data available" the header's
   * sync flash is meant to announce. */
  const dynamicEntriesFetcher = useCallback(
    (ifVersion: number | undefined, signal: AbortSignal) =>
      fetchPreviewEntries(`${path}/api/dry-http`, dynamicType!, allTypes!, PREVIEW_ENTRY_LIMIT, ifVersion, signal),
    [dynamicType, allTypes],
  );
  const { data: dynamicEntriesData, loading: dynamicEntriesLoading, reload: reloadDynamicEntries } = useFetch<PreviewEntryRef[]>(
    `page-editor:preview-entries:${dynamicType?.name ?? ""}`,
    dynamicEntriesFetcher,
    { enabled: !!dynamicType && !!allTypes, notify: false },
  );
  /** `useFetch` keeps the last `data` it loaded while `enabled` is false (its
   * effect returns early rather than clearing state), so a page with no
   * dynamic collection at all would otherwise keep showing the PREVIOUS
   * template's rows. Gated on `dynamicType` here, once, instead of at each
   * of the 4 reads below. */
  const dynamicEntries = useMemo(() => (dynamicType ? (dynamicEntriesData ?? []) : []), [dynamicType, dynamicEntriesData]);

  /** Which row the picker has on - `null` (the default, re-armed whenever the
   * open template or its collection changes) means "whichever row comes
   * first", so the preview still shows something the moment a `[param]` page
   * is opened, exactly as it did before there was a picker. */
  const [previewSlug, setPreviewSlug] = useState<string | null>(null);
  useEffect(() => {
    setPreviewSlug(null);
  }, [dynamicTemplate?.entryPath, dynamicType?.name]);

  const previewEntry = useMemo(
    () => dynamicEntries.find((row) => row.slug === previewSlug) ?? dynamicEntries[0] ?? null,
    [dynamicEntries, previewSlug],
  );

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
   * static route - see this file's own doc comment for why a shared file
   * under `pages/` isn't resolved to "whichever pages use it". A
   * `layout.tsx` previews wrapped around a placeholder child (there's no
   * single "the" page it belongs to); `404.tsx`/`500.tsx` preview
   * standalone, same "no layouts" shape `render.ts`'s own `renderErrorHtml`
   * fallback uses for them at request time; a file under `component/`
   * previews through a synthetic page of its own (`component-preview.ts`). */
  const previewTarget = useMemo<PreviewTarget | null>(() => {
    if (!selectedPath) return null;
    // A `.ts` file under `component/` (e.g. `component/lib/utils.ts`) has no
    // JSX/default export to render - previewing it through
    // `buildComponentPreviewSource` would just throw its own "has no
    // default export function to preview" at runtime, surfacing as a real
    // preview ERROR for a file that was never meant to have one.
    // `isUnpreviewableComponentFile` below drives a plain "No preview"
    // placeholder for this case instead.
    if (isComponentPath && !/\.tsx$/i.test(selectedPath)) return null;
    if (isComponentPath) {
      return {
        label: `${selectedPath} (component)`,
        pathname: "/__dry-preview-component",
        entryPath: COMPONENT_PREVIEW_ENTRY_PATH,
        // Deliberately NOT wrapped in the site's root layout: a layout's own
        // nav/footer would render around every component preview, which is
        // chrome, not the component. The site's CSS still applies - it comes
        // from `buildPage`'s own document/Tailwind pass, not from a layout.
        layoutPaths: [],
        params: {},
        extraSource: {
          path: COMPONENT_PREVIEW_ENTRY_PATH,
          source: buildComponentPreviewSource(selectedPath, samplePropsSource(propsSchema)),
        },
      };
    }
    if (/(^|\/)page\.tsx$/.test(selectedPath)) {
      for (const pathname of staticPagePaths(manifest)) {
        const match = matchSourceRoute(manifest, pathname);
        if (match && match.entryPath === selectedPath) {
          return { label: pathname, pathname, entryPath: match.entryPath, layoutPaths: match.layoutPaths, params: {} };
        }
      }
      // No static route matched - this may be a `[param]` template instead
      // (`blogs/[slug]/page.tsx`), previewed against whichever real row
      // `previewEntry` above has selected.
      if (dynamicTemplate && previewEntry) {
        const pathname = dynamicTemplate.pathnameTemplate.replace(`[${dynamicTemplate.paramName}]`, previewEntry.slug);
        return {
          label: pathname,
          pathname,
          entryPath: dynamicTemplate.entryPath,
          layoutPaths: dynamicTemplate.layoutPaths,
          params: { [dynamicTemplate.paramName]: previewEntry.slug },
        };
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
    if (selectedPath === `${PAGES_ROOT}/404.tsx`) {
      const route = notFoundRoute(manifest);
      if (route) return { label: "404.tsx", pathname: "/__dry-preview-404", ...route, params: {} };
    }
    if (selectedPath === `${PAGES_ROOT}/500.tsx`) {
      const route = serverErrorRoute(manifest);
      if (route) return { label: "500.tsx", pathname: "/__dry-preview-500", ...route, params: {} };
    }
    return null;
  }, [manifest, selectedPath, sourceByPath, dynamicTemplate, previewEntry, isComponentPath, propsSchema]);

  /** Explains why the preview panel is empty for a `[param]` page whose own
   * `previewTarget` came back `null` - distinguishes "still loading the rows
   * to pick from", "this page's source names no collection to enumerate" (a
   * code gap), and "matched a type but it has no published rows yet" (an
   * empty collection) from the generic "nothing selected" placeholder below,
   * since all 3 would otherwise look identical to a user staring at a blank
   * preview. */
  const previewUnavailableReason = useMemo(() => {
    if (previewTarget || !dynamicTemplate) return null;
    if (!dynamicType) {
      if (!allTypes) return "Resolving an entry to preview…";
      return `"${dynamicTemplate.pathnameTemplate}" has no dry().collection("...").get() call naming a slug-enabled collection - can't tell which entry to preview.`;
    }
    if (dynamicEntriesLoading) return "Resolving an entry to preview…";
    return `No published "${dynamicType.name}" entries yet - nothing to preview.`;
  }, [previewTarget, dynamicTemplate, dynamicType, allTypes, dynamicEntriesLoading]);

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

  /** Whether `.page-components-preview-viewport` is in the DOM right now -
   * every gate the JSX below puts in front of it, including the three early
   * returns (`canEdit`/`loadError`/`entries`) that render no editor UI at
   * all. Read by `previewScroll`'s `deps`, which is only correct while it
   * mirrors that JSX exactly - keep the two in sync if either gains a gate. */
  const previewHostMounted = canEdit && !loadError && entries !== null && previewVisible && !!previewTarget;

  const buildBusy = buildingCurrent || buildAllProgress !== null;

  /** How much work is staged but not yet out the door, across EVERY open
   * file - not just the selected one the toolbar's own Save/Build buttons
   * act on. `unsavedCount` counts files edited but never written to storage
   * (the tree's dirty dot); `unbuiltCount` counts pages saved but not
   * published since (the tree's needs-build dot, `unbuiltPaths`). Shown in
   * the topbar next to Publish, so "did I leave something behind?" is
   * answerable without scanning the file tree for dots. */
  const unsavedCount = Object.keys(sourceByPath).filter(
    (filePath) => sourceByPath[filePath] !== savedByPath[filePath],
  ).length;
  const unbuiltCount = unbuiltPaths.size;

  // "Build all"/Publish moves into `DryLayout`'s shared topbar
  // (`usePageHeaderActions`) rather than living in this page's own compact
  // toolbar, unlike "Build"/"Reset"/"Save" (which stay local - they act on
  // whichever file is currently selected, the toolbar's own context). Called
  // unconditionally, before this component's early-return guards below
  // (Rules of Hooks).
  usePageHeaderActions(
    <>
      <div class="topbar-page-title">
        <strong>Page Builder</strong>
      </div>
      {unsavedCount > 0 && (
        <span class="badge sm secondary" data-tooltip={`${unsavedCount} file${unsavedCount === 1 ? "" : "s"} with unsaved changes`}>
          {unsavedCount} unsaved
        </span>
      )}
      {unbuiltCount > 0 && (
        <span class="badge sm warning" data-tooltip={`${unbuiltCount} page${unbuiltCount === 1 ? "" : "s"} saved but not published yet`}>
          {unbuiltCount} to build
        </span>
      )}
      <span class="spacer" />
      <button type="button" class="outline" disabled={buildBusy} aria-busy={buildAllProgress !== null} onClick={() => void handleBuildAll()}>
        <UploadIcon />
        {buildAllProgress ? `Publishing… (${buildAllProgress.done}/${buildAllProgress.total})` : "Publish"}
      </button>
      <Popover
        label="Page Editor settings"
        tooltip="Settings"
        trigger={(onClick, open) => (
          <button type="button" class="icon ghost" aria-haspopup="menu" aria-expanded={open} onClick={onClick}>
            <SettingsIcon />
          </button>
        )}
        items={[
          { type: "item", label: "Reset all from GitHub", icon: <RefreshDataIcon />, onClick: () => setResetDialogOpen(true), danger: true },
          { type: "item", label: "History", icon: <HistoryIcon />, onClick: () => setHistoryDialogOpen(true) },
        ]}
      />
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
   * MUST be told exactly when the host element's mounted-ness flips, which
   * is `previewHostMounted` (EVERY condition the host renders under), not
   * `previewTarget` alone as it used to be. That older, narrower key was a
   * real bug, not a nicety: opening this page with a component already in
   * the URL (`?file=component/Card.tsx` - the normal case, since the URL and
   * `localStorage` both restore the last file) makes `previewTarget` truthy
   * on the very FIRST render, while `entries === null` still short-circuits
   * the whole UI to "Loading…". The effect then ran once against a host that
   * didn't exist yet, and - deps never changing again - never re-ran once it
   * did, leaving the viewport at `overflow: visible`: a zoomed-in preview
   * simply overflowed and got clipped, with no scrollbar on either axis.
   * `previewError` is deliberately NOT part of it - the viewport stays
   * mounted across an error<->success flip (see the JSX below), so including
   * it would just be redundant teardown/init on the same DOM node. */
  const previewScroll = useOverlayScrollbars<HTMLDivElement>([previewHostMounted], {
    // `autoHide: "never"` (not the app-wide `"move"` default): the iframe
    // fills this viewport, and a pointer sitting over an iframe generates no
    // `pointermove` in THIS document at all - so the auto-hiding overlay bar
    // would stay invisible for exactly the gesture it exists for (panning a
    // zoomed-in preview). Nothing shows when there's nothing to scroll: an
    // unusable axis's handle is `opacity: 0` (scrollbar.css) and this theme
    // paints no track.
    scrollbars: { autoHide: "never" },
  });

  /** The preview panel's own visible height, tracked live. A COMPONENT
   * preview's frame is sized from this instead of the fixed
   * `PREVIEW_FRAME_HEIGHT` a page preview uses, so the stage
   * (`buildComponentPreviewSource`'s `100dvh` box) is exactly as tall as
   * what's on screen - no scrolling to reach the bottom of a component that
   * fits, no dead space under one that doesn't fill 900px. A third callback
   * ref on the same host as `viewport.viewportRef`/`previewScroll.ref`, for
   * the same reason `useScaledPreview` uses one (the host unmounts and
   * remounts across error/empty states - see that hook's own doc comment). */
  const [previewViewportHeight, setPreviewViewportHeight] = useState(0);
  const previewHeightObserverRef = useRef<ResizeObserver | null>(null);
  const previewHeightRef = useCallback((node: HTMLDivElement | null) => {
    previewHeightObserverRef.current?.disconnect();
    previewHeightObserverRef.current = null;
    if (!node) return;
    const measure = () => setPreviewViewportHeight(node.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    previewHeightObserverRef.current = observer;
  }, []);
  useEffect(() => () => previewHeightObserverRef.current?.disconnect(), []);

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
      // Origin-QUALIFIED, unlike the real publish path's root-relative
      // `${path}/api/built-assets` (`handleBuildCurrent`/`buildAllFrom`) -
      // found necessary here specifically: a module loaded from a `blob:`
      // URL (every compiled asset below) has a non-hierarchical base, so the
      // browser can't resolve a root-relative specifier (`/dry/api/...`)
      // against it at all (`Failed to resolve module specifier` - confirmed
      // live, not a spec reading) even with a matching import map entry - it
      // never gets far enough to consult the map, since resolving a plain
      // absolute-path specifier against a non-hierarchical base fails before
      // that step. An already-absolute specifier sidesteps the base
      // entirely, so it parses fine regardless of what module it's imported
      // from - only this in-browser preview needs that, real publishes never
      // touch a `blob:` URL.
      const builtAssetsBaseUrl = `${origin}${path}/api/built-assets`;
      // Known gap, not fixed here: an `about:srcdoc` iframe has no origin of
      // its own, so it inherits the EMBEDDING document's - this admin tab's.
      // `document`/`window` are correctly the IFRAME's own (confirmed live -
      // a previewed component's DOM writes never touch the admin's `<html>`
      // element), but `localStorage`/`sessionStorage`/cookies are the SAME
      // storage as the admin app itself, not isolated per preview. A
      // previewed component that writes one of those (this codebase's own
      // `ThemeToggle`, e.g., under `dry-theme`) can silently affect the
      // admin's own state. Fixing it would mean sandboxing the iframe to a
      // real cross-origin realm, which breaks blob: URL access entirely
      // (same-origin only) - a bigger redesign than this pass, not attempted.
      const { html, blobUrls } = await buildPreviewSrcdoc({
        buildInput: {
          pathname: previewTarget.pathname,
          origin,
          adminPath: path,
          siteLang: "en",
          assets: {
            globalsCssHref: assetHrefs.globalsCssHref,
            hydrateEntryHref: assetHrefs.hydrateBuiltHref,
            veiOverlayHref: assetHrefs.veiOverlayHref,
          },
          // Same reasoning as `builtAssetsBaseUrl` above, and just as needed:
          // `compileEsmAsset` prepends an `import { h, Fragment } from
          // "${preactRuntimeHref}"` to EVERY compiled asset (entry, layouts,
          // every transitively-imported file), and the manifest carries it too
          // (`preactRuntimeUrl`) - both go through the same blob-module
          // resolution as any other asset URL, so this needs to be absolute
          // for exactly the same reason, independent of `builtAssetsBaseUrl`
          // (a different value - `/api/asset-hrefs`'s own root-relative
          // `preactRuntimeHref`, not derived from it).
          preactRuntimeHref: `${origin}${assetHrefs.preactRuntimeHref}`,
          builtAssetsBaseUrl,
          dryHttpEndpoint: `${path}/api/dry-http`,
          allTypes,
          sourceByPath: buildSourceByPath,
          entryPath: previewTarget.entryPath,
          layoutPaths: previewTarget.layoutPaths,
          params: previewTarget.params,
          dryCacheTtlMs: PREVIEW_DRY_CACHE_TTL_MS,
        },
        veiOverlayHref: assetHrefs.veiOverlayHref,
      });
      if (seq !== previewSeqRef.current) return; // a newer edit already started another build - discard this stale result
      if (iframeRef.current) iframeRef.current.srcdoc = html;
      setPreviewLabel(previewTarget.label);
      // Only revoke the PREVIOUS build's blob URLs now, not before: the
      // srcdoc assignment just above has already started tearing down the
      // old iframe document, so anything it still needed from them is moot -
      // revoking earlier risks yanking a URL out from under an in-flight
      // fetch in the OLD document.
      for (const url of previewBlobUrlsRef.current) URL.revokeObjectURL(url);
      previewBlobUrlsRef.current = blobUrls;
    } catch (error) {
      if (seq !== previewSeqRef.current) return;
      setPreviewError(error instanceof PageBuildError || error instanceof Error ? error.message : "Preview failed.");
    } finally {
      if (seq === previewSeqRef.current) setPreviewLoading(false);
    }
  }

  /** The escape hatch for `PREVIEW_DRY_CACHE_TTL_MS`: drops every cached
   * `dry()` response, then rebuilds - for the "I just edited that entry in
   * the CMS and want to see it NOW" case, which the TTL alone would leave
   * waiting. Separate from the Reload button next to it, which rebuilds the
   * same (possibly cached) data against the current source. */
  async function refreshPreviewData() {
    await clearDryHttpCache();
    // The `[param]` entry picker is content too - an entry published in the
    // CMS since this list loaded should appear in the dropdown from the same
    // one click that refreshes the preview's own data, rather than only after
    // its collection's data version happens to be re-checked.
    await reloadDynamicEntries();
    await refreshPreview();
  }

  // Receives `PREVIEW_NAVIGATE_MESSAGE` (and `PREVIEW_SAVE_MESSAGE`) from
  // `buildPreviewBridgeScript`'s injected handlers (see their doc comments).
  // The navigate pathname is resolved against the SAME
  // `manifest` `previewTarget` itself uses, so this is exactly "is this
  // pathname a real page.tsx", not a separate/looser check. A match focuses
  // that page.tsx (switches `selectedPath`, which drives the tree selection,
  // the editor, and - via `previewTarget`'s own dependency on `selectedPath`
  // - the next preview build); no match surfaces as an error toast instead,
  // since there's no page here to switch to and the srcdoc iframe was never
  // going to navigate there for real anyway.
  useEffect(() => {
    function handlePreviewMessage(event: MessageEvent) {
      if (!event.data) return;
      if (iframeRef.current && event.source !== iframeRef.current.contentWindow) return;
      if (event.data.type === PREVIEW_SAVE_MESSAGE) return saveShortcutRef.current();
      if (event.data.type !== PREVIEW_NAVIGATE_MESSAGE) return;
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
    // Hiding Preview unmounts the iframe. `previewTarget` and source state do
    // not change during that toggle, so reopening used to mount a fresh,
    // blank iframe without retriggering this effect; only the manual Reload
    // button populated it. Treat visibility as an input and rebuild whenever
    // the preview column becomes visible again.
    if (!previewVisible) return;
    if (!previewTarget) {
      setPreviewLabel(null);
      return;
    }
    const timer = setTimeout(() => void refreshPreview(), 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // `previewTarget?.label` alone wouldn't catch a theme flip - it's the
    // same file, only the stage color inside `extraSource` changed. `propsSchema`
    // IS listed explicitly (not folded into a full `previewTarget` dependency,
    // to avoid rebuilding on every incidental object-identity change) - without
    // it, opening a component previewed with the WRONG (empty/fallback) sample
    // props from BEFORE `describeProps`'s async worker round trip resolved,
    // and stayed wrong until the admin clicked "Reload preview" by hand (which
    // calls `refreshPreview` fresh, picking up the by-then-populated schema) -
    // found live: a component's own default props silently missing from its
    // own preview on first open, self-correcting only on a manual reload.
  }, [previewVisible, previewTarget?.label, sourceByPath, allTypes, assetHrefs, origin, propsSchema]);

  if (!canEdit) return <span class="error">You don't have permission to edit page source.</span>;
  if (loadError) return <span class="error">{loadError}</span>;
  if (entries === null) return <span class="hint">Loading…</span>;

  const PREVIEW_FRAME_HEIGHT = 900;
  /** Divided by the zoom because the frame is scaled by CSS `zoom` (see
   * `useScaledPreview`): at zoom `z` a frame `h` CSS pixels tall occupies
   * `h * z` on screen, so filling a `previewViewportHeight`-tall panel
   * exactly means asking for `previewViewportHeight / z`. That larger number
   * is also what the iframe reports as `100dvh` to the previewed component -
   * correct, and the vertical twin of `viewport.width` already being the
   * unscaled device width. */
  const previewFrameHeight =
    isComponentPath && previewViewportHeight > 0 ? previewViewportHeight / effectiveZoom : PREVIEW_FRAME_HEIGHT;
  // `previewTarget` alone isn't enough here - it's also truthy for a
  // `layout.tsx`/`404.tsx`/`500.tsx`/component preview (see its own doc
  // comment), none of which `resolveAllPageTargets`/`PageBuild.tsx` treat as
  // a buildable target on their own.
  const isPageTarget = !isComponentPath && !!selectedPath && /(^|\/)page\.tsx$/.test(selectedPath) && !!previewTarget;

  /** The tree the active tab shows - the same `entries` list, narrowed to one
   * source root and rebased so the tab starts inside it (`tree.ts`). */
  const visibleEntries = entriesForSourceRoot(entries, activeRoot);
  /** The open file only counts as "selected" for the tab currently showing
   * it. Found live: `ComponentTreePanel` derives where a NEW file lands from
   * the selected file's own folder, so leaving a `pages/...` path selected
   * while the Component tab is open aimed "New" at `pages/` - the inline
   * create form rendered inside a folder this tab doesn't even show, so it
   * looked like the button did nothing at all. */
  const selectedInActiveRoot = !!selectedPath && visibleEntries.some((entry) => entry.id === selectedPath);

  // With the code column hidden the preview is the only resizable column
  // left, so there's nothing to size it AGAINST - it takes the leftover room
  // (`flex: 1`) instead of `previewSplit.size`, and the code toolbar section
  // shrinks to just its own buttons so the two rows still line up with the
  // body columns below. `previewSplit.size` is never overwritten while
  // hidden, so reopening the code column restores the previous split.
  const previewFills = previewVisible && !codeOpen;
  const previewSectionStyle = previewVisible ? (previewFills ? { flex: 1 } : { width: `${previewSplit.size}px` }) : undefined;
  const codeSectionStyle = previewFills ? undefined : { flex: 1 };

  return (
    <div class="page-components-shell">
      {/* 3 sections, one per body column below - each held to that column's
       * OWN current width (`sidebar.size`/`previewSplit.size`, the same
       * reactive values the body itself renders at) so the toolbar visibly
       * lines up with what it controls, resize included. */}
      <div class="page-components-toolbar">
        <div class="page-editor-toolbar-section" style={sidebarOpen ? { width: `${sidebar.size}px` } : undefined}>
          <button
            type="button"
            class="ghost icon sm"
            aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            title={sidebarOpen ? "Hide sidebar" : "Show sidebar"}
            aria-pressed={sidebarOpen}
            onClick={() => setSidebarOpen((v) => !v)}
          >
            <MenuIcon />
          </button>
          {sidebarOpen && (
            <div class="page-editor-root-tabs" role="tablist">
              {PAGES_SOURCE_ROOTS.map((root) => (
                <button
                  key={root.id}
                  type="button"
                  class="ghost icon sm"
                  role="tab"
                  aria-label={root.label}
                  title={root.label}
                  aria-selected={activeRoot === root.id}
                  onClick={() => selectRoot(root.id)}
                >
                  {sourceRootIcon(root.id)}
                </button>
              ))}
              {recoveredCoreFiles.length > 0 && (
                <button
                  type="button"
                  class="ghost icon sm"
                  role="tab"
                  aria-label="System"
                  title="System"
                  aria-selected={activeRoot === SYSTEM_ROOT}
                  onClick={() => selectRoot(SYSTEM_ROOT)}
                >
                  <LockIcon />
                </button>
              )}
            </div>
          )}
        </div>
        {sidebarOpen && <div class="page-editor-toolbar-spacer" />}

        <div class="page-editor-toolbar-section" style={previewSectionStyle}>
          <button
            type="button"
            class="ghost icon sm"
            aria-label={previewVisible ? "Hide preview" : "Show preview"}
            title={isMdPath ? "No preview for Markdown files" : previewVisible ? "Hide preview" : "Show preview"}
            aria-pressed={previewVisible}
            disabled={isMdPath}
            onClick={() => setPreviewOpen((v) => !v)}
          >
            <PreviewIcon />
          </button>
          {previewVisible && (
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
        {previewVisible && codeOpen && <div class="page-editor-toolbar-spacer" />}

        <div class="page-editor-toolbar-section" style={codeSectionStyle}>
          <button
            type="button"
            class="ghost icon sm"
            aria-label={codeOpen ? "Hide code" : "Show code"}
            title={codeOpen ? "Hide code" : "Show code"}
            aria-pressed={codeOpen}
            onClick={() => setCodeOpen((v) => !v)}
          >
            {fileIconForName(selectedPath ?? "")}
          </button>
          <span class="hint" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedPath ?? ""}</span>
          <div class="spacer" />
          {selectedPath && (
            <button type="button" class="ghost sm" disabled={!dirty || saving} onClick={handleReset}>
              Reset
            </button>
          )}
          {isPageTarget && (dirty || unbuiltPaths.has(selectedPath)) && (
            <button type="button" class="ghost sm" disabled={buildBusy} aria-busy={buildingCurrent} onClick={() => void handleBuildCurrent()}>
              {buildingCurrent ? "Building…" : "Build"}
            </button>
          )}
          {selectedPath && (
            <button type="button" class="sm" title="Save (Ctrl/Cmd+S)" disabled={!anyDirty || saving} aria-busy={saving} onClick={() => void handleSave()}>
              Save
            </button>
          )}
        </div>
      </div>

      <div class="page-components-body">
        {sidebarOpen && (
          <>
            <div style={{ width: `${sidebar.size}px`, display: "flex", flexDirection: "column", minHeight: 0 }}>
              {activeRoot === SYSTEM_ROOT ? (
                <SystemFilesPanel
                  recovered={recoveredCoreFiles}
                  onOpen={(p) => {
                    setActiveRoot(STYLES_ROOT);
                    setSelectedPath(p);
                  }}
                />
              ) : (
                <ComponentTreePanel
                  entries={visibleEntries}
                  selectedPath={selectedInActiveRoot ? selectedPath : null}
                  onSelect={setSelectedPath}
                  onCreateFile={handleCreateFile}
                  onCreateFolder={handleCreateFolder}
                  onDelete={setPendingDelete}
                  onMove={handleMove}
                  onPaste={(paths, destFolder) => void handlePaste(paths, destFolder)}
                  onCopy={(paths) => toast.add({ type: "success", title: paths.length > 1 ? `Copied ${paths.length} files.` : `Copied "${paths[0]}".` })}
                  isDirty={(p) => sourceByPath[p] !== savedByPath[p]}
                  needsBuild={(p) => unbuiltPaths.has(p)}
                  aiWritten={(p) => aiWrittenPaths.has(p)}
                />
              )}
            </div>
            <div class={`page-components-resize-handle${sidebar.dragging ? " dragging" : ""}`} {...sidebar.handleProps} />
          </>
        )}

        {previewVisible && (
          <>
            <div style={{ ...(previewFills ? { flex: 1 } : { width: `${previewSplit.size}px` }), minWidth: 0, display: "flex", flexDirection: "column" }}>
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
                    aria-label="Refresh data"
                    title={`Refresh content data (cached for ${PREVIEW_DRY_CACHE_TTL_MS / 60000} min)`}
                    disabled={previewLoading}
                    onClick={() => void refreshPreviewData()}
                  >
                    <RefreshDataIcon />
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
                <div class="page-components-preview-viewport" ref={mergeRefs(viewport.viewportRef, previewScroll.ref, previewHeightRef)}>
                  {previewError && (
                    <div class="page-editor-preview-error" role="alert">
                      {previewError}
                    </div>
                  )}
                  <div class="page-components-preview-viewport-inner" ref={previewScroll.viewportRef}>
                    {/* `zoom` (unlike `transform`) shrinks an <iframe>'s own
                      * LAYOUT footprint, which is what `useScaledPreview`'s own
                      * doc comment praises it for (no leftover whitespace a
                      * `transform: scale` would leave) - but for an iframe
                      * specifically it does NOT shrink what's rendered INSIDE
                      * it: the iframe is its own browsing context, so `zoom`
                      * on an ancestor just hands it a smaller effective
                      * viewport to reflow into at full (unscaled) font sizes,
                      * rather than "the same layout, shown smaller" - found
                      * live: at a low zoom, the frame box shrank correctly but
                      * the TEXT inside it stayed full-size and wrapped into a
                      * narrow column instead of shrinking with everything
                      * else. `transform: scale` on an INNER wrapper (kept at
                      * the real, unscaled size) fixes that - it scales the
                      * iframe's rendered pixels as a whole, matching what a
                      * real device at this width actually looks like - and
                      * the OUTER `.page-components-preview-frame` reserves
                      * exactly the SCALED footprint itself, so the surrounding
                      * flex/centering layout still sees no leftover
                      * whitespace either. */}
                    <div
                      class="page-components-preview-frame"
                      style={{ width: `${viewport.width * effectiveZoom}px`, height: `${previewFrameHeight * effectiveZoom}px` }}
                    >
                      <div style={{ width: `${viewport.width}px`, height: `${previewFrameHeight}px`, transform: `scale(${effectiveZoom})`, transformOrigin: "top left" }}>
                        <iframe ref={iframeRef} title="Page preview" style={{ width: "100%", height: "100%", border: "none", background: "#fff", display: "block" }} />
                      </div>
                    </div>
                  </div>
                </div>
              ) : isUnpreviewableComponentFile ? (
                <div class="page-editor-preview-nopreview">
                  {fileIconForName(selectedPath)}
                  <span class="hint">No preview</span>
                </div>
              ) : (
                <p class="hint" style={{ padding: "1rem" }}>
                  {previewUnavailableReason ?? "Select a page.tsx, layout.tsx, 404.tsx, 500.tsx, or a component to preview it."}
                </p>
              )}
              {/* Which entry a `[param]` template previews against. Shown
                * from the FIRST row, not only once there are 2 to switch
                * between: the label above carries the built pathname (a
                * slug), so even standing alone this names the entry the
                * preview is actually showing - and a control that only
                * materializes once a collection happens to have a second
                * published row is a control nobody finds. Sits under the
                * preview (not in its header) so it doesn't compete with the
                * header's reload/zoom controls for room. */}
              {dynamicEntries.length > 0 && previewEntry && (
                <div class="page-editor-preview-entry-bar">
                  <span>Entry</span>
                  <Select
                    ariaLabel="Preview entry"
                    value={previewEntry.slug}
                    onChange={setPreviewSlug}
                    options={dynamicEntries.map((row) => ({ value: row.slug, label: row.label ?? row.slug }))}
                  />
                </div>
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
            {codeOpen && <div class={`page-components-resize-handle${previewSplit.dragging ? " dragging" : ""}`} {...previewSplit.handleProps} />}
          </>
        )}

        {codeOpen && (
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
                <Editer
                  key={selectedPath}
                  value={code}
                  onChange={handleChange}
                  extraFiles={extraFiles}
                  language={editorLanguage}
                  tailwindStylesheet={tailwindStylesheet}
                  describeProps={isComponentPath}
                  style={{ height: "100%" }}
                />
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
                {buildError && (
                  <span class="badge sm destructive">Build failed</span>
                )}
                {errorCount === 0 && warningCount === 0 ? (
                  !buildError && (
                    <span class="hint">
                      {buildingCurrent
                        ? "Building…"
                        : buildAllProgress
                          ? `Building all… (${buildAllProgress.done}/${buildAllProgress.total})`
                          : "No problems"}
                    </span>
                  )
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
              {diagnosticsOpen && buildError && (
                <div class="page-editor-diagnostics-build-error">
                  <div class="page-editor-diagnostics-build-error-header">
                    <strong>{buildError.title}</strong>
                    <button type="button" class="ghost icon sm" aria-label="Dismiss" onClick={() => setBuildError(null)}>
                      <CloseIcon />
                    </button>
                  </div>
                  {buildError.message && <p>{buildError.message}</p>}
                </div>
              )}
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
                  !buildError && (
                    <p class="hint" style={{ padding: "0.5rem" }}>
                      No problems detected.
                    </p>
                  )
                ))}
            </div>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={pendingDelete.length > 0}
        title={pendingDelete.length > 1 ? `Delete ${pendingDelete.length} items?` : `Delete "${pendingDelete[0]?.name ?? ""}"?`}
        message={
          pendingDelete.length > 1
            ? `${pendingDelete.map((entry) => entry.name).join(", ")}. This cannot be undone.`
            : pendingDelete[0]?.kind === "folder"
              ? "This deletes the folder and everything inside it. This cannot be undone."
              : "This cannot be undone."
        }
        confirmLabel="Delete"
        destructive
        busy={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => setPendingDelete([])}
      />

      {selectedPath && (
        <PageSourceMagicChat path={selectedPath} code={sourceByPath[selectedPath] ?? ""} projectFiles={projectFiles} onCodeChange={handleMagicCodeChange} canUse={canEdit} />
      )}

      <GithubResetDialog
        open={resetDialogOpen}
        endpoint={`${path}/api/github-restore`}
        onClose={() => setResetDialogOpen(false)}
        onApplied={() => void handleGithubRestoreApplied()}
      />
      <GithubHistoryDialog
        open={historyDialogOpen}
        endpoint={`${path}/api/github-restore`}
        onClose={() => setHistoryDialogOpen(false)}
        onApplied={() => void handleGithubRestoreApplied()}
      />
    </div>
  );
}
