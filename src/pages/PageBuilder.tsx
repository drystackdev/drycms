import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
const { path } = window.__DRY_CONFIG__;
import { useParam } from "../hooks/useParam.js";
import { useDocumentTitle } from "./page-common.js";
import { authState, canAccess } from "../store/auth.js";
import { isVeiEditableType, PAGE_BUILDER_RESOURCE_ID } from "../content-types/permissions.js";
import type { DryVeiContext } from "../content-types/dry-context.js";
import { dryVeiOverrideKey, type DryVeiOverrideMap } from "../content-types/dry-reader-http.js";
import type { ContentTypeDefinition } from "../content-types/types.js";
import type { EntryValue } from "../content-types/engine/entry-codec.js";
import { EditIcon } from "../components/icons/index.js";
import { toast } from "../components/Toast.js";
import { createContentTypesApi, listCached } from "../content-types/http-api.js";
import { fetchJson, type AssetHrefs } from "../page-components/pages-source-http.js";
import { usePageBuilderSource } from "../page-components/use-page-builder-source.js";
import { resolveModulePath } from "../page-components/page-build.js";
import { buildManifestRouteTree, listDynamicPageTemplates, matchSourceRoute, staticPagePaths, type SourceRouteMatch } from "../server/app-router/route-manifest.js";
import { fetchPreviewEntries } from "../page-components/dynamic-routes.js";
import { collectionTypeForPageSource } from "../server/app-router/page-collection.js";
import { COMPONENT_ROOT, MD_ROOT, PAGES_ROOT, STYLES_ROOT, rootOf } from "../server/app-router/source-roots.js";
import { PREVIEW_VEI_FOCUS_MESSAGE, type PreviewInspectorLoc, type PreviewVeiClickRef } from "../page-components/page-preview-engine.js";
import { applyPreviewPatch, type PreviewPatchDetail } from "../page-components/vei-preview-patch.js";
import { decodeEntryId, encodeEntryId } from "../lib/id-hash.js";
import type { FieldFocusEventDetail } from "./content-entry-editor/field-events.js";
import PreviewFrame from "./page-components/page-builder/PreviewFrame.js";
import Toolbar, { type BuilderPanelMode } from "./page-components/page-builder/Toolbar.js";
import BubbleMenu from "./page-components/page-builder/BubbleMenu.js";
import CodePanel from "./page-components/page-builder/CodePanel.js";
import FileDialog from "./page-components/page-builder/FileDialog.js";
import VeiEntryFrame from "./page-components/page-builder/VeiEntryFrame.js";
import SavePreviewDialog, { type SaveProgress } from "./page-components/page-builder/SavePreviewDialog.js";
import PageSourceMagicChat from "./page-components/page-builder/PageSourceMagicChat.js";
import { CORE_STYLE_FILES } from "./page-components/core-styles/registry.js";
import { getAllEntryDraftRecords, putEntryDraftRecord, type EntryDraftRecord } from "../content-types/entry-draft-db.js";
import { discardEntryDraft } from "../content-types/entry-draft-store.js";
import { createContentEntriesApi } from "../content-types/entries-http-api.js";
import { isGitMirrorEligible } from "../content-types/git-mirror.js";
import { syncEntryDraftToGit } from "../content-types/entry-git-sync.js";
import { rebuildAffectedPages } from "../page-components/rebuild-affected-pages.js";
import { publishAllPages, publishPagesAffectedBySource, publishPagesForEntryPaths, type PublishPageProgress } from "../page-components/initial-publish.js";
import { gitState, refreshGitStatus } from "../page-components/git/git-state.js";
import { getHistoryFile, getHistoryTree, type HistoryCommit } from "../page-components/git/history-http-api.js";
import HistoryDialog from "./page-components/page-builder/HistoryDialog.js";

interface ReviewState {
  commit: HistoryCommit;
  target: { scope: "file"; path: string } | { scope: "commit" };
  sourceByPath: Record<string, string>;
  restore: { write: Record<string, string>; remove: string[] };
}

interface PersistedBuilderState {
  panelMode: BuilderPanelMode;
  panelWidth: number;
  /** `styles/*.css`/`md/*.md` only - every `.tsx` file (page, layout, or
   * component) opens in the main `CodePanel` now (`openFilePath`, not
   * persisted - always defaults to the currently previewed route's own
   * `page.tsx`, see its own doc comment). */
  fileDialogPath: string | null;
  veiTarget: PreviewVeiClickRef | null;
}

/**
 * What the builder shows until its own preview is ready: the published page
 * itself, plus ONE round "edit" button where the dock is about to be.
 *
 * Deliberately no dimming/blurred overlay and no "Loading…" label any more -
 * the page being edited stays fully readable, and the only thing that reads
 * as busy is that single circle (the same pen icon
 * `apps/edit-launcher.ts` was clicked on to get here). It is a plain circle,
 * not a `<Dock>`, so `.dock` still means "the builder is usable" for
 * anything waiting on it - and so the real dock's own mount animation
 * (`Dock.tsx`, expanding from exactly this circle's size) reads as this
 * button unrolling into the toolbar.
 */
function PageBuilderLoadingLayer({ pathname }: { pathname: string }) {
  return (
    <div class="page-builder-loading-layer">
      <iframe
        class="page-builder-loading-preview"
        src={pathname}
        title="Page preview"
        aria-hidden="true"
        tabIndex={-1}
      />
      <div class="page-builder-dock-loading" role="status" aria-label="Loading Page Builder">
        <span class="page-builder-dock-loading-button"><EditIcon /></span>
      </div>
    </div>
  );
}

const BUILDER_STATE_KEY = "drycms:page-builder-state";

/** A commit message that says what changed without putting a dialog in the
 * way - Save is one button, and a page/component path is already the most
 * useful summary there is. A path no longer present in the loaded tree was
 * deleted, so the verb follows the actual change rather than always reading
 * "Update". Long lists collapse to a count. `[CODE] ` prefixed so
 * `HistoryDialog.tsx`'s Code/Content tabs can bucket commits by message
 * (`plans/history-content.md`) - a commit from before this feature existed
 * carries no prefix at all, which the dialog buckets as Code too (only code
 * was ever tracked before). */
function commitMessageFor(paths: string[], sourceByPath: Record<string, string>): string {
  const removed = paths.filter((filePath) => !(filePath in sourceByPath));
  const verb = removed.length === paths.length ? "Delete" : "Update";
  if (paths.length === 1) return `[CODE] ${verb} ${paths[0]}`;
  if (paths.length <= 3) return `[CODE] ${verb} ${paths.join(", ")}`;
  return `[CODE] ${verb} ${paths.length} page source files`;
}

/**
 * The site pathname a `pages/**\/page.tsx` serves, derived from the file path
 * alone - `pages/page.tsx` -> `/`, `pages/about/page.tsx` -> `/about`.
 *
 * `null` for a dynamic template (`pages/blog/[slug]/page.tsx`): that route has
 * no single pathname until an entry is picked, which is
 * `resolvePageFilePathname`'s job. Used only where the route manifest isn't
 * usable yet (a file created this tick - see `handleCreateFile`); everywhere
 * else the manifest stays the source of truth.
 */
function staticPathnameForPageFile(filePath: string): string | null {
  const relative = filePath.slice(`${PAGES_ROOT}/`.length).replace(/(^|\/)page\.tsx$/, "");
  if (relative.includes("[")) return null;
  return relative === "" ? "/" : `/${relative}`;
}

function readBuilderState(): PersistedBuilderState {
  // `panelMode: null` - entering the builder opens the DOCK only. The code
  // editor used to be the fresh-session default, which meant every arrival
  // from the site's Edit button landed in a half-covered preview nobody had
  // asked to edit the source of. A panel the admin opened themselves is
  // still restored below, across a reload of the same tab.
  const fallback: PersistedBuilderState = { panelMode: null, panelWidth: 480, fileDialogPath: null, veiTarget: null };
  try {
    const value = JSON.parse(sessionStorage.getItem(BUILDER_STATE_KEY) ?? "null") as Partial<PersistedBuilderState> | null;
    if (!value) return fallback;
    const panelMode = value.panelMode === "vei" || value.panelMode === "code" ? value.panelMode : null;
    return {
      panelMode,
      panelWidth: typeof value.panelWidth === "number" ? value.panelWidth : 480,
      fileDialogPath: typeof value.fileDialogPath === "string" ? value.fileDialogPath : null,
      veiTarget: panelMode === "vei" && value.veiTarget ? value.veiTarget : null,
    };
  } catch {
    return fallback;
  }
}

/**
 * `/dry/page-builder?path=<site route pathname>` - the unified page/content
 * builder `plans/new-ui-page-builder.md` describes. A thin composition
 * root: every non-trivial piece (the full-screen preview, the floating
 * toolbar, the file menu, the code panel, the file dialog, VEI's entry
 * editor) is its own file under `page-components/page-builder/`; this
 * component only owns the state that ties them together (which file is
 * open where, VEI on/off, the resolved route) and the handlers that move
 * between them.
 *
 * Deliberately NOT the deleted Page Editor's tree/draft engine (mục 10's
 * sanctioned cut, see `use-page-builder-source.ts`'s own doc comment) - what
 * survived that page is here: the file menu's create/rename/delete, Magic
 * Chat, and the core-style recovery check.
 */
export default function PageBuilder() {
  const [previewTitle, setPreviewTitle] = useState("");
  const [previewReady, setPreviewReady] = useState(false);
  useDocumentTitle(previewTitle ? `${previewTitle} - Page builder` : "Page builder");
  /** Code-editing capability: raw source, file browser, git history, Magic
   * Chat - the one long-standing "Page Builder" System toggle, unchanged. */
  const canEditCode = canAccess(PAGE_BUILDER_RESOURCE_ID, "setting");
  const [pathname, setPathname] = useParam<string>("path", "/");
  const [allTypes, setAllTypes] = useState<ContentTypeDefinition[] | null>(null);
  const [assetHrefs, setAssetHrefs] = useState<AssetHrefs | null>(null);
  const [dryTypes, setDryTypes] = useState<string | null>(null);

  /** Visual-editing capability: reuses the ordinary per-resource permission
   * model (same rule `VeiEntryFrame`'s `contentTypes` filter below applies) -
   * no separate toggle. A role needs `view`+`update` on a collection or
   * `setting` on a singleton for at least one editable type to use VEI at
   * all here. */
  const veiEditableTypes = useMemo(
    () => (allTypes ?? []).filter((type) => isVeiEditableType(type, canAccess)),
    [allTypes],
  );
  const canUseVei = veiEditableTypes.length > 0;
  /** Either capability admits the page - matches the server's own either/or
   * model (`pages-build.ts`'s `resolvePublishAccess`/`canPublishPath`,
   * `dry-http.ts`'s POST handler): a role with only content permissions can
   * already publish what it can see, without the code-edit grant. */
  const canEnterBuilder = canEditCode || canUseVei;

  const {
    sourceByPath,
    loading,
    error: loadError,
    updateSource,
    isDirty,
    canDiscard,
    flushPendingWrites,
    reset,
    saving,
    autosaving,
    dirtyPaths,
    pendingCommitPaths,
    markPublished,
    reload,
    createFile,
    renameFile,
    deleteFile,
    remoteDiverged,
    setPollPaused,
  } = usePageBuilderSource(path, canEnterBuilder);
  const [origin] = useState(() => window.location.origin);
  const [historyPath, setHistoryPath] = useState<string | null | undefined>(undefined);
  const [review, setReview] = useState<ReviewState | null>(null);

  async function reviewFile(commit: HistoryCommit, filePath: string) {
    const old = await getHistoryFile(path, commit.sha, filePath);
    const next = { ...(sourceByPath ?? {}) };
    if (old.missing) delete next[filePath]; else next[filePath] = old.content ?? "";
    setReview({ commit, target: { scope: "file", path: filePath }, sourceByPath: next, restore: { write: old.missing ? {} : { [filePath]: old.content ?? "" }, remove: old.missing ? [filePath] : [] } });
    setHistoryPath(undefined);
    setPanelMode("code");
  }

  async function reviewCommit(commit: HistoryCommit) {
    const tree = (await getHistoryTree(path, commit.sha)).sourceByPath;
    setReview({ commit, target: { scope: "commit" }, sourceByPath: tree, restore: { write: tree, remove: Object.keys(sourceByPath ?? {}).filter((filePath) => !(filePath in tree)) } });
    setHistoryPath(undefined);
    setPanelMode("code");
  }

  async function revertReview() {
    if (!review) return;
    const currentPaths = new Set(Object.keys(sourceByPath ?? {}));
    const overwrite = Object.keys(review.restore.write).filter((filePath) => currentPaths.has(filePath)).length;
    const create = Object.keys(review.restore.write).length - overwrite;
    if (review.target.scope === "commit" && !window.confirm(`Restore this commit? Overwrite ${overwrite}, recreate ${create}, delete ${review.restore.remove.length} files.`)) return;
    for (const [filePath, content] of Object.entries(review.restore.write)) {
      if (currentPaths.has(filePath)) updateSource(filePath, content);
      else await createFile(filePath, content);
    }
    for (const filePath of review.restore.remove) if (currentPaths.has(filePath)) await deleteFile(filePath);
    await flushPendingWrites();
    setReview(null);
    setSaveDialogOpen(true);
  }

  useEffect(() => {
    // Not gated on either capability: `allTypes` is what `canUseVei` above
    // is computed FROM, so a VEI-only role (no `canEditCode`) needs this to
    // run in order to ever resolve as able to enter at all. Safe regardless
    // of permission - `content-types:list` is itself server-permission-
    // scoped, and `canAccess` reads the session's own grants, not this
    // fetch.
    void (async () => {
      try {
        const typesApi = createContentTypesApi(`${path}/api/content-types`);
        const [types, hrefs] = await Promise.all([listCached(typesApi), fetchJson<AssetHrefs>(`${path}/api/asset-hrefs`)]);
        setAllTypes(types);
        setAssetHrefs(hrefs);
      } catch {
        toast.add({ type: "error", title: "Failed to load build context." });
      }
    })();
    // Best-effort, same "never fatal" spirit as `PageBuilder.tsx`'s own fetch
    // of this - a missing/failed `dry.generated.d.ts` just means `dry()`
    // shows as an untyped global in the editor until it resolves.
    void fetch(`${path}/api/types-cache`, { credentials: "same-origin" })
      .then((response) => (response.ok ? response.text() : null))
      .then((text) => setDryTypes(text))
      .catch(() => setDryTypes(null));
  }, []);

  /** Every OTHER loaded file, PLUS `dry.generated.d.ts` - `Editer`'s ambient
   * reference set for cross-file TS resolution, mirroring `PageBuilder.tsx`'s
   * own `extraFiles` memo exactly (same reasons: `md/` holds plain Markdown,
   * never real TS/TSX an editor's Language Service should reason about, and
   * the currently-open file's own path is excluded per-caller below so its
   * live-editing buffer isn't shadowed by a second, stale copy of itself).
   * Without this, `CodePanel`/`FileDialog`'s `Editer` instances had no idea
   * `dry`/`params`/`setTitle` are real ambient globals or that `@component/*`
   * imports resolve to anything - spurious "cannot find name"/"cannot find
   * module" warnings Page Editor's own Editer never shows, since it always
   * wires this same set up. */
  const effectiveSource = review?.sourceByPath ?? sourceByPath ?? {};
  const baseExtraFiles = useMemo(() => {
    const rest = { ...effectiveSource };
    for (const key of Object.keys(rest)) {
      if (rootOf(key)?.id === MD_ROOT) delete rest[key];
    }
    if (dryTypes) rest["dry.generated.d.ts"] = dryTypes;
    return rest;
  }, [effectiveSource, dryTypes]);

  function extraFilesExcluding(openPath: string): Record<string, string> {
    if (!(openPath in baseExtraFiles)) return baseExtraFiles;
    const rest = { ...baseExtraFiles };
    delete rest[openPath];
    return rest;
  }

  const restoredState = useMemo(readBuilderState, []);
  const [bubbleRoot, setBubbleRoot] = useState<string | null>(null);
  /** The file the bubble menu's tree last selected - a component or layout,
   * reflected in the URL for a shareable/bookmarkable link. Independent of
   * `path` (the previewed SITE route): selecting a file never changes
   * `path`, and navigating `path` away clears this instead (see the effect
   * below). */
  const [fileParam, setFileParam] = useParam<string>("file");
  /** Set only while previewing a component/layout NOT reachable from the
   * currently previewed route (`buildStandalonePreview` below) - overrides
   * `match` for the iframe (`match` half) and supplies the synthetic wrapper
   * file that match's `entryPath` points at (`extraSource` half), so the
   * admin can see it rendered without leaving the page they were on. `null`
   * means the real route match applies. */
  const [previewOverride, setPreviewOverride] = useState<{ match: SourceRouteMatch; extraSource: { path: string; code: string } } | null>(null);
  // Start on the route's own page.tsx as soon as the manifest resolves;
  // preview navigation then keeps this same panel focused on the newly
  // matched entry path without requiring a second file-menu selection.
  //
  // `restoredState` is `sessionStorage`, shared by every role that has ever
  // opened this browser tab - it has no idea which capability THIS session
  // has. Restoring "code" for a VEI-only role (or a file-dialog path, itself
  // a code-editing surface) would silently show the raw source panel a role
  // with no `canEditCode` grant should never see, even though the dock
  // already hides the button that would normally open it.
  const [panelMode, setPanelMode] = useState<BuilderPanelMode>(() => {
    if (restoredState.panelMode === "code") return canEditCode ? "code" : null;
    if (restoredState.panelMode === "vei") return canUseVei ? "vei" : null;
    return null;
  });
  const [codePanelWidth, setCodePanelWidth] = useState(restoredState.panelWidth);
  const [fileDialogPath, setFileDialogPath] = useState<string | null>(canEditCode ? restoredState.fileDialogPath : null);
  /** The file the main `CodePanel` shows - ANY `.tsx` file (page, layout, or
   * component), not just the currently previewed route's own `page.tsx`
   * (`plans/new-ui-page-builder.md`'s original one-file-at-a-time cut,
   * revised: only `.css`/`.md` still open in `FileDialog` now). Not
   * persisted - the sync effect below always resets it to the previewed
   * route's `page.tsx` on load/navigation; picking a layout/component from
   * the file menu (`handleSelectComponentFile`) pins it there until the
   * next navigation. */
  const [openFilePath, setOpenFilePath] = useState<string | null>(null);
  const [veiTarget, setVeiTarget] = useState<PreviewVeiClickRef | null>(restoredState.veiTarget);
  /** Hover/cursor sync between the Code panel and the preview
   * (`status/page-builder-code-preview-sync.md`) - not persisted, both reset
   * to `null` on every load/navigation like `bubbleRoot`. */
  const [inspectorHoverLoc, setInspectorHoverLoc] = useState<PreviewInspectorLoc | null>(null);
  /** The loc of the LAST inspector click, kept separate from the hover loc
   * above because only a click may scroll the code editor (`Editer`'s
   * `highlightLoc.reveal`). Hovering still highlights, but sweeping the
   * pointer across the preview must never yank the editor around. Cleared
   * as soon as the hover moves on to another element. */
  const [inspectorRevealLoc, setInspectorRevealLoc] = useState<PreviewInspectorLoc | null>(null);
  const [codeCursor, setCodeCursor] = useState<{ line: number; column: number } | null>(null);
  const [contentRevision, setContentRevision] = useState(0);
  const [veiOverrides, setVeiOverrides] = useState<DryVeiOverrideMap>({});
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveDrafts, setSaveDrafts] = useState<EntryDraftRecord[]>([]);
  const [saveProgress, setSaveProgress] = useState<SaveProgress | null>(null);
  const [recoveredCoreFiles, setRecoveredCoreFiles] = useState<string[]>([]);

  // Independent of the render gate below - the preview builds fine before
  // this resolves, it just means the Save panel's draft/override list fills
  // in a moment after first paint instead of gating the whole builder on it.
  useEffect(() => {
    void getAllEntryDraftRecords().then((records) => {
      setSaveDrafts(records);
      const restoredOverrides: DryVeiOverrideMap = {};
      for (const draft of records) {
        restoredOverrides[dryVeiOverrideKey(draft.typeSlug, draft.entryId)] = { ...draft.value };
      }
      setVeiOverrides((current) => ({ ...restoredOverrides, ...current }));
    });
  }, []);

  /** Core `styles/` files (`core-styles/registry.ts`) back a hardcoded build
   * entry and each other's `@import`s (`source-roots.ts`'s
   * `isCoreStyleFilePath` doc comment) - restore any missing one (a fresh
   * checkout, or an old project predating this lock) instead of leaving the
   * styles tab, and the build, silently broken. Page Editor used to do this
   * inside its own tree load; Page Builder is the only editor left, so the
   * check moved here. Runs once per loaded tree. */
  const ranCoreStyleRecovery = useRef(false);
  useEffect(() => {
    // `createFile` below writes page source - a code-editing action a
    // VEI-only role (no `canEditCode`) has no server-side permission for
    // (`pages-source.ts` stays gated purely on `system-build:setting`).
    if (!canEditCode || !sourceByPath || ranCoreStyleRecovery.current) return;
    ranCoreStyleRecovery.current = true;
    const missing = CORE_STYLE_FILES.filter((file) => !(`${STYLES_ROOT}/${file.name}` in sourceByPath));
    if (missing.length === 0) return;
    void (async () => {
      const restored: string[] = [];
      for (const file of missing) {
        try {
          await createFile(`${STYLES_ROOT}/${file.name}`, file.defaultContent);
          restored.push(file.name);
        } catch {
          // A failed restore is reported by its absence from the panel -
          // never fatal to opening the builder.
        }
      }
      if (restored.length === 0) return;
      setRecoveredCoreFiles(restored);
      toast.add({
        type: "info",
        title: restored.length > 1 ? `Restored ${restored.length} built-in style files.` : `Restored ${restored[0]}.`,
        description: "See the styles tab in the file menu.",
      });
    })();
  }, [canEditCode, sourceByPath, createFile]);

  useEffect(() => {
    sessionStorage.setItem(BUILDER_STATE_KEY, JSON.stringify({ panelMode, panelWidth: codePanelWidth, fileDialogPath, veiTarget } satisfies PersistedBuilderState));
  }, [panelMode, codePanelWidth, fileDialogPath, veiTarget]);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const veiEnabled = panelMode === "vei";
  const sidePanelOpen = panelMode !== null;
  const saveItemCount = pendingCommitPaths.length + new Set([
    ...saveDrafts.map((draft) => dryVeiOverrideKey(draft.typeSlug, draft.entryId)),
    ...Object.keys(veiOverrides),
  ]).size;

  /** Ends whatever `handleSelectComponentFile` started: closes `CodePanel`,
   * drops any standalone preview override, and removes `file=` from the URL.
   * `path` is never touched here - it was never touched to enter this state
   * either (see `buildStandalonePreview`/`previewOverride`'s own comments),
   * so there is nothing to restore it from. */
  function closeCodePanel() {
    setPanelMode(null);
    setPreviewOverride(null);
    setFileParam(undefined);
  }

  function togglePanel(mode: Exclude<BuilderPanelMode, null>) {
    if (mode === "code" && panelMode === "code") {
      closeCodePanel();
      return;
    }
    setPanelMode((current) => {
      const next = current === mode ? null : mode;
      // Re-entering VEI starts from its empty selection state. Reload still
      // restores a currently active VEI target through sessionStorage.
      if (current === "vei" || next === "vei") setVeiTarget(null);
      return next;
    });
  }

  const veiContext = useMemo<DryVeiContext>(
    () => ({
      canUpdate(type: ContentTypeDefinition) {
        return canAccess(type.id, type.kind === "singleton" ? "setting" : "update");
      },
    }),
    [],
  );

  const manifest = useMemo(() => buildManifestRouteTree(Object.keys(sourceByPath ?? {})), [sourceByPath]);
  const match = useMemo(() => matchSourceRoute(manifest, pathname), [manifest, pathname]);
  const activePagePath = match?.entryPath ?? null;
  // `openFilePath` defaults to (and, on every later navigation, follows)
  // whichever `page.tsx` the preview currently resolves to - the same
  // implicit "browsing the site follows the code along" behavior this
  // component always had, back when `CodePanel` just read `match.entryPath`
  // directly. Picking a layout/component file from the menu
  // (`handleSelectComponentFile`) overrides this UNTIL the next navigation,
  // since nothing here re-fires just because that state changed.
  useEffect(() => {
    if (activePagePath) setOpenFilePath(activePagePath);
  }, [activePagePath]);
  // A real route navigation (preview iframe nav, picking a page from the
  // menu, ...) ends whatever standalone preview `handleSelectComponentFile`
  // started - `pathname` itself is never the thing that put it there, so any
  // change to it is a reliable "the admin moved on" signal. Skipped on
  // mount (nothing to clear yet) via the ref, same pattern
  // `BubbleFileTree.tsx`'s `initialCreateSignal` uses for its own signal.
  const initialPathnameRef = useRef(pathname);
  useEffect(() => {
    if (pathname === initialPathnameRef.current) return;
    initialPathnameRef.current = pathname;
    if (previewOverride) setPreviewOverride(null);
    if (fileParam) setFileParam(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-fire on a real pathname change, not on override/fileParam churn.
  }, [pathname]);
  /** What the preview iframe actually renders - the real route match, unless
   * a standalone file preview (`buildStandalonePreview`) is currently
   * overriding it. */
  const effectiveMatch = previewOverride?.match ?? match;
  /** `effectiveSource` plus the standalone preview's own synthetic wrapper
   * file, when one is active - `effectiveMatch.entryPath` points at it, so
   * the iframe build needs it in its own source map to find it. */
  const previewSourceByPath = previewOverride
    ? { ...effectiveSource, [previewOverride.extraSource.path]: previewOverride.extraSource.code }
    : effectiveSource;
  /** Same condition the `<CodePanel>` render below is gated on. */
  const codePanelOpen = canEditCode && panelMode === "code" && !!openFilePath;
  // Hover preview -> highlight code: only when the hovered element's OWN
  // file is the one currently open (never auto-switches tabs - matches what
  // was asked for). A clicked loc takes precedence and is the only one that
  // carries `reveal`, i.e. the only one that scrolls the editor.
  //
  // `useMemo`'d for the same reason `previewCursorLoc` below is: this builds
  // a new object literal, and `Editer`'s highlight effect keys on reference,
  // so an unmemoized one would re-run (and re-scroll) on every unrelated
  // re-render.
  const activeInspectorLoc = inspectorRevealLoc ?? inspectorHoverLoc;
  const highlightLoc = useMemo(
    () =>
      codePanelOpen && activeInspectorLoc && activeInspectorLoc.path === openFilePath
        ? { ...activeInspectorLoc, reveal: activeInspectorLoc === inspectorRevealLoc }
        : null,
    [codePanelOpen, activeInspectorLoc, inspectorRevealLoc, openFilePath],
  );
  // Code cursor -> highlight preview.
  //
  // `useMemo`'d (not a plain const like `highlightLoc` above) because this
  // builds a NEW object literal on every render - without memoizing on the
  // actual line/column, `PreviewFrame`'s `postMessage` effect (keyed on
  // reference) refired on every unrelated re-render this component makes
  // (e.g. a hover-loc update), resending a stale cursor position into the
  // iframe and immediately clobbering whatever the hover direction had just
  // shown - found live: the preview outline appeared then vanished within
  // one frame every time.
  const previewCursorLoc = useMemo(
    () => (codePanelOpen && codeCursor && openFilePath ? { path: openFilePath, line: codeCursor.line, column: codeCursor.column } : null),
    [codePanelOpen, codeCursor?.line, codeCursor?.column, openFilePath],
  );
  const codePanelExtraFiles = useMemo(
    () => (openFilePath ? extraFilesExcluding(openFilePath) : baseExtraFiles),
    [openFilePath, baseExtraFiles],
  );
  const fileDialogExtraFiles = useMemo(
    () => (fileDialogPath ? extraFilesExcluding(fileDialogPath) : baseExtraFiles),
    [fileDialogPath, baseExtraFiles],
  );
  /** What Magic Chat treats as "the file the admin is looking at" - the
   * dialog's file when one is open, else whatever `CodePanel` has open, else
   * the previewed route's own entry file. `""` when nothing resolves (a
   * route with no page source yet), which the chat accepts: `path` is
   * context, never a limit on what it may write. */
  const magicPath = fileDialogPath ?? openFilePath ?? match?.entryPath ?? "";

  async function resolvePageFilePathname(entryPath: string): Promise<string | null> {
    for (const candidate of staticPagePaths(manifest)) {
      const candidateMatch = matchSourceRoute(manifest, candidate);
      if (candidateMatch && candidateMatch.entryPath === entryPath) return candidate;
    }
    const template = listDynamicPageTemplates(manifest).find((t) => t.entryPath === entryPath);
    if (!template || !allTypes || !sourceByPath) return null;
    const type = collectionTypeForPageSource(sourceByPath[entryPath], allTypes);
    if (!type) {
      toast.add({ type: "error", title: "Can't preview this template", description: `"${entryPath}" has no dry().collection("...").get() call naming a slug-enabled collection.` });
      return null;
    }
    const result = await fetchPreviewEntries(`${path}/api/dry-http`, type, allTypes, 1, undefined);
    const first = result.data?.[0];
    if (!first) {
      toast.add({ type: "error", title: "Nothing to preview yet", description: `No published "${type.name}" entries.` });
      return null;
    }
    return template.pathnameTemplate.replace(`[${template.paramName}]`, first.slug);
  }

  async function handleSelectPageFile(entryPath: string) {
    const resolved = await resolvePageFilePathname(entryPath);
    if (resolved) {
      setPathname(resolved);
      // Set directly (not left to the `activePagePath` sync effect) so
      // `CodePanel` switches the instant this resolves, not one render
      // later once `match` catches up with the new `pathname`.
      setOpenFilePath(entryPath);
      setPanelMode("code");
    }
    setBubbleRoot(null);
  }

  /** Whether `filePath` is already part of the currently previewed route's
   * own layout chain - the only "is this in use" signal available without a
   * real import graph (`saveAndPublish`'s own comment on why one doesn't
   * exist yet). A plain `component/*.tsx` is never in this list, since
   * layouts/pages import components dynamically and nothing here tracks
   * that - so it always falls to the standalone-preview branch below, which
   * matches what was asked: components are the common "not in use" case. */
  function isFileInUseByRoute(filePath: string): boolean {
    return match?.layoutPaths.includes(filePath) ?? false;
  }

/** A synthetic `SourceRouteMatch` PLUS the extra (never-persisted, iframe-only)
   * source file it depends on, for previewing a file that ISN'T reachable
   * from the currently previewed route - wrapped by the site's root
   * `pages/layout.tsx` if one exists (and isn't `filePath` itself).
   *
   * `filePath` can NOT be used as `entryPath` directly: `resolve-match.ts`'s
   * `resolveMatchToVNode` calls whatever sits at `entryPath`/`layoutPaths`
   * as a plain, un-dispatched function (`PageComponent(props)`, no `h(...)`)
   * - the same "server component" contract every real `page.tsx`/`layout.tsx`
   * already follows (async, no hooks). A `component/*.tsx` file is an
   * ORDINARY client component and very often uses hooks (`ThemeToggle.tsx`'s
   * `useEffect`, for one) - calling it that way crashes with Preact's
   * `Cannot read properties of null (reading '__H')`, since hooks require a
   * real Preact-dispatched render to have `currentComponent` set. A thin
   * synthetic wrapper page that just returns `<Target />` (JSX, a nested
   * vnode) sidesteps this entirely: `resolveMatchToVNode`'s own doc comment
   * confirms any nested, ordinary child is "left untouched... Preact's own
   * dispatch... invokes those, hooks and all." Placed in the SAME directory
   * as `filePath` so the relative import always resolves with zero path
   * math. Good enough for a component/orphaned layout to render with the
   * site's real chrome without needing a full import graph to find its
   * actual usage site. */
  function buildStandalonePreview(filePath: string): { match: SourceRouteMatch; extraSource: { path: string; code: string } } {
    const rootLayout = `${PAGES_ROOT}/layout.tsx`;
    const existing = sourceByPath ?? {};
    const dir = filePath.includes("/") ? filePath.slice(0, filePath.lastIndexOf("/")) : "";
    const targetName = filePath.slice(filePath.lastIndexOf("/") + 1).replace(/\.tsx?$/, "");
    let wrapperPath = dir ? `${dir}/__standalone_preview__.tsx` : "__standalone_preview__.tsx";
    for (let suffix = 1; wrapperPath in existing; suffix += 1) {
      wrapperPath = dir ? `${dir}/__standalone_preview_${suffix}__.tsx` : `__standalone_preview_${suffix}__.tsx`;
    }
    // `component/*.tsx` follows the `export const defaultProps = {...}`
    // convention `component-preview.ts`'s own doc comment establishes -
    // honor it here too, so the preview shows the component the way its
    // author intended instead of every prop blank/undefined. `defaultProps`
    // may be an ARRAY, rendering one instance per entry, same contract that
    // convention already sets - a plain namespace import (`* as
    // targetModule`) reads it without needing the real default export to
    // run first. A centering stage (`flex justify-center items-center`)
    // keeps a component with no layout opinion of its own (most of them)
    // from just hugging the page's top-left corner. `layout.tsx`/other
    // non-component files skip both: they aren't authored against this
    // convention and already carry their own layout.
    const code = rootOf(filePath)?.id === COMPONENT_ROOT
      ? `import Target, * as targetModule from "./${targetName}";

const dryDefaultProps = (targetModule as { defaultProps?: unknown }).defaultProps;
const dryPropsList = Array.isArray(dryDefaultProps) ? dryDefaultProps : [dryDefaultProps ?? {}];

export default function StandalonePreview() {
  return (
    <div class="flex justify-center items-center p-5 min-h-64">
      {dryPropsList.map((props: unknown, index: number) => (
        <Target key={index} {...(props as Record<string, unknown>)} />
      ))}
    </div>
  );
}
`
      : `import Target from "./${targetName}";\n\nexport default function StandalonePreview() {\n  return <Target />;\n}\n`;
    return {
      match: {
        entryPath: wrapperPath,
        layoutPaths: filePath !== rootLayout && rootLayout in existing ? [rootLayout] : [],
        params: {},
      },
      extraSource: { path: wrapperPath, code },
    };
  }

  /** The module specifier `identifier` is imported from in `source` (matches
   * a default import - `import Identifier from "spec"` - or a named one,
   * including an aliased one - `import { Foo as Identifier } from "spec"`),
   * or `null` if `source` never imports that name. Regex-based rather than a
   * real AST parse: good enough for "go to definition" on an ordinary
   * top-of-file import, which is the only shape a JSX component reference
   * ever comes from in this codebase's own source (`docs/APP-ROUTER.md`). */
  function findImportSpecifier(source: string, identifier: string): string | null {
    const importRe = /import\s+([\w$]+)?\s*,?\s*(?:\{([^}]*)\})?\s*from\s*["']([^"']+)["']/g;
    for (const match of source.matchAll(importRe)) {
      const [, defaultName, namedClause, specifier] = match;
      if (defaultName === identifier) return specifier!;
      if (!namedClause) continue;
      const bindings = namedClause.split(",").map((entry) => {
        const parts = entry.trim().split(/\s+as\s+/);
        return parts[parts.length - 1];
      });
      if (bindings.includes(identifier)) return specifier!;
    }
    return null;
  }

  /** "Ctrl/Cmd+click a JSX component tag -> open that file" (`Editer`'s
   * `onGoToDefinition`) - follows the currently open file's own imports
   * (`findImportSpecifier`) through the same alias/relative resolution the
   * real build uses (`page-build.ts`'s `resolveModulePath`), then opens the
   * result exactly like picking it from the bubble menu would. Silent on
   * anything that doesn't resolve (not imported at all, an npm package, a
   * plain lowercase tag `identifierAtOffset` already filtered out) - a
   * modifier-click is exploratory by nature, not a claim the target exists. */
  function handleGoToDefinition(identifier: string) {
    if (!openFilePath) return;
    const source = effectiveSource[openFilePath];
    if (source === undefined) return;
    const specifier = findImportSpecifier(source, identifier);
    if (!specifier) return;
    let resolved;
    try {
      resolved = resolveModulePath(openFilePath, specifier, sourceByPath ?? {});
    } catch {
      return;
    }
    if (resolved.kind === "local") handleSelectComponentFile(resolved.path);
  }

  /** A `.tsx` file that ISN'T a route's own `page.tsx` - a layout,
   * `404.tsx`/`500.tsx`, or a `component/*.tsx` - opens in the SAME
   * `CodePanel` now, without touching the preview's own pathname: none of
   * these have one route of their own to navigate to, and the whole point
   * is editing them while watching whatever page currently renders them.
   *
   * `file=` is set here for every pick so the URL reflects the tree's
   * selection; if the picked file isn't already part of what the preview is
   * showing, `previewOverride` takes over the iframe (`buildStandalonePreview`)
   * until the panel is closed (`closeCodePanel`) or the admin navigates the
   * preview elsewhere (the `pathname`-keyed effect below). */
  function handleSelectComponentFile(componentPath: string) {
    setOpenFilePath(componentPath);
    setPanelMode("code");
    setFileParam(componentPath);
    setPreviewOverride(isFileInUseByRoute(componentPath) ? null : buildStandalonePreview(componentPath));
    setBubbleRoot(null);
  }

  /** `styles/*.css`/`md/*.md` only now - opens `FileDialog`. */
  function handleSelectOtherFile(otherPath: string) {
    setFileDialogPath(otherPath);
    setBubbleRoot(null);
  }

  /** Creating/renaming/deleting all write straight through to storage
   * (`use-page-builder-source.ts`'s own doc comment) - there is no draft
   * state a structural change could sit in, so the only work left here is
   * keeping whatever is currently OPEN pointed at a path that still exists. */
  async function handleCreateFile(filePath: string, code: string) {
    await createFile(filePath, code);
    setBubbleRoot(null);
    const isPageRouteFile = rootOf(filePath)?.id === PAGES_ROOT && /(^|\/)page\.tsx$/.test(filePath);
    if (!isPageRouteFile) {
      // Any other `.tsx` (a new layout/component) opens in `CodePanel`, same
      // as picking an existing one from the menu; only `.css`/`.md` still go
      // to `FileDialog`.
      if (filePath.endsWith(".tsx")) handleSelectComponentFile(filePath);
      else setFileDialogPath(filePath);
      return;
    }
    // NOT `handleSelectPageFile` for a brand-new page: that resolves through
    // `manifest`, which is memoized off the `sourceByPath` of the render this
    // handler closed over - a file created one line ago is never in it, so the
    // lookup silently found nothing and creating a page appeared to do
    // nothing at all. A static route's pathname is derivable from the file
    // path alone, so derive it; a dynamic template still needs a real entry to
    // preview against, which only the manifest path can find.
    const directPathname = staticPathnameForPageFile(filePath);
    if (directPathname === null) {
      await handleSelectPageFile(filePath);
      return;
    }
    setPathname(directPathname);
    setOpenFilePath(filePath);
    setPanelMode("code");
  }

  async function handleRenameFile(from: string, to: string) {
    await renameFile(from, to);
    if (fileDialogPath === from) setFileDialogPath(to);
    if (openFilePath === from) setOpenFilePath(to);
    // The previewed route is derived from the manifest, which the rename
    // just changed - re-resolving keeps the preview on the same FILE rather
    // than on a pathname that no longer maps to anything.
    if (match?.entryPath === from) {
      const resolved = await resolvePageFilePathname(to);
      if (resolved) setPathname(resolved);
    }
  }

  async function handleDeleteFile(filePath: string) {
    await deleteFile(filePath);
    // `filePath` may be a FOLDER, deleted recursively - a currently open
    // file/dialog/route doesn't have to equal it exactly, just live under it.
    const isWithin = (path: string | null | undefined) => path === filePath || path?.startsWith(`${filePath}/`);
    if (isWithin(fileDialogPath)) setFileDialogPath(null);
    // Falls back to whatever the preview currently shows - if THAT was also
    // deleted, the `setPathname("/")` below changes it a moment later and
    // the `activePagePath` sync effect follows along.
    if (isWithin(openFilePath)) setOpenFilePath(activePagePath);
    if (isWithin(match?.entryPath)) setPathname("/");
  }

  const handleVeiClick = useCallback((ref: PreviewVeiClickRef) => setVeiTarget(ref), []);
  /** "Click preview -> open file": a click landed on a marked element while
   * the inspector is on (only possible while `codePanelOpen`, since that's
   * what `inspectorEnabled` below is gated on). Switches `CodePanel` to that
   * element's own file without touching the preview at all - unlike
   * `handleSelectComponentFile`, this file is proven to already be part of
   * what's rendering (the click landed inside it), so `previewOverride` is
   * left exactly as it was. */
  const handleInspectorClick = useCallback((loc: PreviewInspectorLoc) => {
    setOpenFilePath(loc.path);
    setPanelMode("code");
    setFileParam(loc.path);
    // The click - not the hover that preceded it - is what asks the editor
    // to scroll to this range (`inspectorRevealLoc`'s own comment).
    setInspectorRevealLoc(loc);
  }, [setFileParam]);
  /** A hover onto a DIFFERENT marked element (the bridge script only reports
   * changes) retires the standing click target, so the next hover highlights
   * without scrolling again. */
  const handleInspectorHover = useCallback((loc: PreviewInspectorLoc | null) => {
    setInspectorHoverLoc(loc);
    setInspectorRevealLoc(null);
  }, []);
  const handleVeiFocus = useCallback((detail: FieldFocusEventDetail) => {
    const type = allTypes?.find((candidate) => candidate.name === detail.typeSlug);
    const decodedId = detail.entryId === null ? null : decodeEntryId(detail.entryId);
    iframeRef.current?.contentWindow?.postMessage({
      type: PREVIEW_VEI_FOCUS_MESSAGE,
      detail: {
        typeSlug: detail.typeSlug,
        // `null` is a real singleton identity, but for an unsaved collection
        // entry it means "not on the preview yet" and must match nothing.
        entryId: type?.kind === "singleton" ? null : (decodedId ?? -1),
        path: detail.name,
      },
    }, "*");
  }, [allTypes]);

  /** Every file that already exists in this project's source tree, for
   * `PageSourceMagicChat`'s own orientation (`PageSourceMagicChatProps.
   * projectFiles`) - Magic has authority to write ANY of them, or a brand
   * new path, not just whatever's currently open. */
  const projectFiles = useMemo(() => Object.keys(sourceByPath ?? {}), [sourceByPath]);

  /** Magic's write callback goes through the SAME `updateSource` seam a
   * keystroke in `CodePanel`/`FileDialog` does, so an AI edit is
   * indistinguishable from a hand-typed one to the rest of this page: it
   * lands in `dirtyPaths`, shows up as a row in `SavePreviewDialog`, and is
   * published by the one Save pipeline - including a write to a file that
   * isn't currently open, which is the normal case for a multi-file turn
   * (`status/magic-chat-multifile.md`). */
  const handleMagicCodeChange = useCallback(
    (changedPath: string, code: string) => updateSource(changedPath, code),
    [updateSource],
  );

  const handleFieldInput = useCallback((detail: PreviewPatchDetail) => {
    const key = dryVeiOverrideKey(detail.typeSlug, detail.entryId);
    setVeiOverrides((current) => ({
      ...current,
      [key]: { ...current[key], [detail.name]: detail.value },
    }));
    const doc = iframeRef.current?.contentDocument;
    if (doc) applyPreviewPatch(doc, detail, path);
  }, []);

  const handleVeiSaved = useCallback(() => {
    if (veiTarget) {
      const key = dryVeiOverrideKey(veiTarget.type, veiTarget.kind === "singleton" ? null : encodeEntryId(veiTarget.id));
      setVeiOverrides((current) => {
        if (!(key in current)) return current;
        const next = { ...current };
        delete next[key];
        return next;
      });
    }
    setContentRevision((revision) => revision + 1);
  }, [veiTarget]);

  async function openSavePreview() {
    // Entry drafts persist on a short debounce; one frame after a field edit
    // should still be included when the admin immediately opens Save.
    await new Promise((resolve) => setTimeout(resolve, 350));
    setSaveDrafts(await getAllEntryDraftRecords());
    setSaveDialogOpen(true);
  }

  async function previewChangedCode(filePath: string) {
    setSaveDialogOpen(false);
    if (rootOf(filePath)?.id === PAGES_ROOT && /(^|\/)page\.tsx$/.test(filePath)) {
      const resolved = await resolvePageFilePathname(filePath);
      if (resolved) setPathname(resolved);
      setOpenFilePath(filePath);
      setPanelMode("code");
      setVeiTarget(null);
    } else if (filePath.endsWith(".tsx")) {
      handleSelectComponentFile(filePath);
    } else {
      setFileDialogPath(filePath);
    }
  }

  async function revertEntryDraft(draft: EntryDraftRecord) {
    // Clear visible pending state first; IndexedDB deletion can finish in
    // the background without leaving the Save row/badge and VEI preview
    // stale for another frame.
    setSaveDrafts((current) => current.filter((candidate) => candidate.key !== draft.key));
    setVeiOverrides((current) => {
      const key = dryVeiOverrideKey(draft.typeSlug, draft.entryId);
      if (!(key in current)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    setContentRevision((revision) => revision + 1);
    await discardEntryDraft(draft.typeSlug, draft.entryId);
  }

  async function updateEntryDraft(draft: EntryDraftRecord, value: EntryDraftRecord["value"]) {
    const next = { ...draft, value, updatedAt: Date.now() };
    await putEntryDraftRecord(next);
    setSaveDrafts((current) => current.map((candidate) => candidate.key === draft.key ? next : candidate));
    setVeiOverrides((current) => ({ ...current, [dryVeiOverrideKey(draft.typeSlug, draft.entryId)]: { ...value } }));
    setContentRevision((revision) => revision + 1);
  }

  async function saveAndPublish() {
    if (!allTypes) return;
    const types = allTypes;
    // Editing already wrote itself through; only a debounce still in flight
    // could be missing, so flush that and then commit EVERY working-copy
    // change - including files created or deleted from the file menu, which
    // never had a buffer of their own.
    await flushPendingWrites();
    const codePaths = [...pendingCommitPaths];
    const drafts = [...saveDrafts];
    const resources = new Set<string>();
    const totalWrites = drafts.length;
    let completedWrites = 0;
    setSaveProgress({ percent: 0, label: "Preparing changes…" });
    // The background remote poll shares `withGitLock` with this flow's own
    // commit/push - left running, it would queue behind (or redundantly
    // re-fetch) the exact commit this function is about to push itself,
    // every 5s for as long as the build takes.
    setPollPaused(true);
    try {
      for (const draft of drafts) {
        const type = types.find((candidate) => candidate.name === draft.typeSlug);
        if (!type || type.kind === "component") continue;
        setSaveProgress({ percent: Math.round((completedWrites / Math.max(totalWrites, 1)) * 65), label: `Saving ${type.label}` });
        const api = createContentEntriesApi(`${path}/api/content`, type.name);
        const gitEligible = isGitMirrorEligible(type);
        const isCreate = type.kind !== "singleton" && draft.entryId === null;
        // Fetched BEFORE the write, only when it'll actually be used for a
        // rollback - what "reset" (`entry-git-sync.ts`) restores an update or
        // singleton save back to if its git commit never confirms. A create
        // has nothing to restore (rollback removes the row instead), so it's
        // skipped there.
        let priorValue: EntryValue | null = null;
        if (gitEligible && !isCreate) {
          try {
            const existing = type.kind === "singleton" ? await api.getSingleton() : await api.get(draft.entryId as string);
            priorValue = existing?.value ?? null;
          } catch {
            priorValue = null;
          }
        }

        let savedEntryId: string;
        if (type.kind === "singleton") savedEntryId = (await api.saveSingleton(draft.value)).id;
        else if (isCreate) savedEntryId = (await api.create(draft.value)).id;
        else savedEntryId = (await api.update(draft.entryId as string, draft.value)).id;

        if (gitEligible) {
          syncEntryDraftToGit({
            adminPath: path,
            typeSlug: draft.typeSlug,
            typeLabel: type.label || type.name,
            draftEntryId: draft.entryId,
            entryId: savedEntryId,
            op: type.kind === "singleton" ? "update" : isCreate ? "create" : "update",
            rollback: isCreate ? { kind: "remove" } : { kind: "restore", value: priorValue ?? draft.value },
          });
        } else {
          await discardEntryDraft(draft.typeSlug, draft.entryId);
        }
        resources.add(type.name);
        completedWrites += 1;
      }

      // Code changes are only really saved once they are a commit on the
      // branch - the working copy lives in this browser's IndexedDB, which
      // nothing else can read. Push BEFORE building so the published pages
      // can never describe source that exists nowhere but this tab.
      if (gitState.value.phase !== "unconfigured" && codePaths.length > 0) {
        setSaveProgress({ percent: 68, label: "Committing to git…" });
        const { commitWorkingCopy, resyncWorkingCopy } = await import("../page-components/git/git-repo.js");
        const author = authState.value.user;
        const committed = await commitWorkingCopy(
          path,
          commitMessageFor(codePaths, sourceByPath ?? {}),
          {
            name: author?.name || "drycms",
            // Not a real mailbox on purpose - a tenant's admin account has an
            // email, but publishing it into a public git history is not
            // something this feature should decide for them.
            email: `${author?.id ?? "admin"}@page-builder.drycms`,
          },
        );
        if (committed.committed) {
          setSaveProgress({ percent: 74, label: "Refreshing source…" });
          await resyncWorkingCopy({ adminPath: path, branch: gitState.value.branch });
          await refreshGitStatus();
          await reload();
        }
      }

      setSaveProgress({ percent: 78, label: "Resolving affected pages…" });
      if (codePaths.length > 0) {
        // Source dependencies can fan out through layouts, components and
        // styles. The publish pipeline computes the real target graph; until
        // source-path lookup is persisted server-side, publishing all targets
        // is the safe dependency-complete result for a source change.
        setSaveProgress({ percent: 80, label: "Building pages affected by code…" });
        const result = await publishPagesAffectedBySource(
          path, types, codePaths,
          (message) => setSaveProgress({ percent: 90, label: message }),
          ({ pathname, completed, total }) => setSaveProgress({
            percent: 80 + Math.round((completed / Math.max(total, 1)) * 10),
            label: `Building ${pathname}… (${completed + 1}/${total})`,
          }),
        );
        if (result.error) throw new Error(result.error);
      } else {
        const names = [...resources];
        for (const [index, typeName] of names.entries()) {
          const percent = 70 + Math.round((index / Math.max(names.length, 1)) * 25);
          setSaveProgress({ percent, label: `Building pages that use ${typeName}…` });
          await rebuildAffectedPages(
            path, typeName, types,
            (message) => setSaveProgress({ percent, label: message }),
            ({ pathname, completed, total }) => setSaveProgress({
              percent,
              label: `Building ${pathname}… (${completed + 1}/${total})`,
            }),
          );
        }
      }
      setSaveProgress({ percent: 100, label: "Built and published" });
      // These files have now reached the live site, so they stop counting
      // toward the dock's badge. Under git the same fact comes from a clean
      // `statusMatrix` after the commit; this is the no-repository half.
      markPublished(codePaths);
      setVeiOverrides({});
      setContentRevision((revision) => revision + 1);
      setSaveDrafts([]);
      setTimeout(() => {
        setSaveDialogOpen(false);
        setSaveProgress(null);
      }, 500);
    } catch (error) {
      setSaveProgress(null);
      toast.add({ type: "error", title: "Save failed", description: error instanceof Error ? error.message : "Unknown error" });
    } finally {
      setPollPaused(false);
    }
  }

  /** Runs one background build/publish action (`buildPageFile`/
   * `buildFolderPages`/`buildAllPages` below) behind a single live-updating
   * "loading" toast, independent of the Save dialog's own `saveProgress` -
   * this is a direct, unrelated-to-dirty-state build triggered from the file
   * tree's right-click menu or the "Build all" header button, so it gets its
   * own status surface rather than borrowing the Save flow's. */
  async function runPageBuild(
    build: (onProgress: (progress: PublishPageProgress) => void) => Promise<{ built: number; error?: string }>,
    busyLabel: string,
  ) {
    const toastId = toast.add({ type: "loading", title: busyLabel });
    try {
      const result = await build(({ pathname, completed, total }) =>
        toast.update(toastId, { type: "loading", title: `Building ${pathname}… (${completed + 1}/${total})` }));
      if (result.error) throw new Error(result.error);
      toast.update(toastId, {
        type: "success",
        title: result.built > 0 ? `Built and published ${result.built} ${result.built === 1 ? "page" : "pages"}` : "No pages needed building",
        timeout: 4000,
      });
    } catch (error) {
      toast.update(toastId, { type: "error", title: "Build failed", description: error instanceof Error ? error.message : "Unknown error" });
    }
  }

  /** Right-click "Build" on one `pages/**\/page.tsx` file - builds and
   * publishes just the pathname(s) that file resolves to (a dynamic
   * template can resolve to several). */
  function buildPageFile(entryPath: string) {
    if (!allTypes) return;
    const types = allTypes;
    void runPageBuild(
      (onProgress) => publishPagesForEntryPaths(path, types, [entryPath], undefined, onProgress),
      `Building ${entryPath}…`,
    );
  }

  /** Right-click "Build" on a folder under `pages/` - finds every
   * `page.tsx` nested under it and builds/publishes each. */
  function buildFolderPages(folderPath: string) {
    if (!allTypes || !sourceByPath) return;
    const types = allTypes;
    const entryPaths = Object.keys(sourceByPath).filter(
      (candidate) =>
        (candidate === folderPath || candidate.startsWith(`${folderPath}/`)) &&
        /(^|\/)page\.tsx$/.test(candidate),
    );
    if (entryPaths.length === 0) {
      toast.add({ type: "error", title: `No page.tsx files found in ${folderPath}/.` });
      return;
    }
    void runPageBuild(
      (onProgress) => publishPagesForEntryPaths(path, types, entryPaths, undefined, onProgress),
      `Building ${entryPaths.length} ${entryPaths.length === 1 ? "page" : "pages"} in ${folderPath}/…`,
    );
  }

  /** The header "Build all" button next to BubbleMenu's "+" - every
   * resolvable target on the site (same notion of "every page" `PageBuild.tsx`'s
   * own "Build all" uses, via the shared `resolveAllPageTargets`). */
  function buildAllPages() {
    if (!allTypes) return;
    const types = allTypes;
    void runPageBuild((onProgress) => publishAllPages(path, types, undefined, onProgress), "Building all pages…");
  }

  if (loadError) return <span class="error">{loadError}</span>;
  // Only judged once `allTypes` has actually resolved - `canUseVei` depends
  // on it, so checking permission any earlier would flash this at a
  // VEI-only role on every load, before its own access can be seen.
  if (allTypes && !canEnterBuilder) return <span class="error">You don't have permission to use the Page Builder.</span>;
  if (loading || !sourceByPath || !allTypes || !assetHrefs) {
    return (
      <div class="page-builder-root">
        <PageBuilderLoadingLayer pathname={pathname} />
      </div>
    );
  }

  return (
    <div class={`page-builder-root${review ? " history-review" : ""}`}>
      {review && <div class="page-builder-history-banner"><span>Viewing history · {review.commit.sha.slice(0, 7)} · {review.commit.message.split("\n")[0]} · {new Date(review.commit.date).toLocaleString()}</span><span class="row"><button type="button" class="sm" onClick={() => void revertReview()}>Revert</button><button type="button" class="outline sm" onClick={() => setReview(null)}>Exit</button></span></div>}
      {!review && remoteDiverged && <div class="page-builder-history-banner"><span>The remote has new commits, but you have unpublished edits here - finish or discard them to sync.</span></div>}
      <PreviewFrame
        iframeRef={iframeRef}
        pathname={pathname}
        match={effectiveMatch}
        sourceByPath={previewSourceByPath}
        allTypes={allTypes}
        assetHrefs={assetHrefs}
        origin={origin}
        adminPath={path}
        veiEnabled={veiEnabled}
        veiContext={veiContext}
        onNavigate={setPathname}
        // Ctrl+S inside the preview: edits already persist themselves, so the
        // only thing left for the familiar shortcut to mean is "flush what is
        // still debounced right now".
        onSave={() => void flushPendingWrites()}
        onVeiClick={handleVeiClick}
        onTitleChange={setPreviewTitle}
        onReady={() => setPreviewReady(true)}
        codePanelWidth={sidePanelOpen ? codePanelWidth : 0}
        contentRevision={contentRevision}
        veiOverrides={veiOverrides}
        inspectorEnabled={codePanelOpen}
        onInspectorHover={handleInspectorHover}
        onInspectorClick={handleInspectorClick}
        cursorLoc={previewCursorLoc}
      />

      {!previewReady && <PageBuilderLoadingLayer pathname={pathname} />}

      {/* Held back until the preview is ready so the dock's mount animation
        * (`Dock.tsx`) plays where the loading circle above just was, instead
        * of behind the loading layer that still covers it. */}
      {!review && previewReady && <Toolbar
        // Back to the public page being previewed - the return leg of
        // `apps/edit-launcher.ts`'s "Edit" button, which is how a signed-in
        // admin gets here from the site in the first place.
        onExit={() => (window.location.href = pathname)}
        onDashboard={() => (window.location.href = `${path}/dashboard`)}
        onOpenMenu={() => setBubbleRoot((current) => (current ? null : PAGES_ROOT))}
        panelMode={panelMode}
        onTogglePanel={togglePanel}
        onSave={() => void openSavePreview()}
        saveDisabled={pendingCommitPaths.length === 0 && saveDrafts.length === 0 && Object.keys(veiOverrides).length === 0}
        saveCount={saveItemCount}
        onOpenHistory={gitState.value.phase === "unconfigured" || !canEditCode ? undefined : () => setHistoryPath(null)}
        canEditCode={canEditCode}
        canUseVei={canUseVei}
      />}

      {canEditCode && bubbleRoot && (
        <BubbleMenu
          sourceByPath={sourceByPath}
          activeRoot={bubbleRoot}
          activePath={openFilePath}
          onRootChange={setBubbleRoot}
          onSelectPageFile={(entryPath) => void handleSelectPageFile(entryPath)}
          onSelectComponentFile={handleSelectComponentFile}
          onSelectOtherFile={handleSelectOtherFile}
          recoveredCoreFiles={recoveredCoreFiles}
          onCreateFile={handleCreateFile}
          onRenameFile={handleRenameFile}
          onDeleteFile={handleDeleteFile}
          onBuildFile={buildPageFile}
          onBuildFolder={buildFolderPages}
          onBuildAll={buildAllPages}
          onClose={() => setBubbleRoot(null)}
        />
      )}

      {panelMode === "code" && (
        <div
          class="page-builder-drawer-backdrop"
          onClick={closeCodePanel}
        />
      )}

      {codePanelOpen && openFilePath && (
        <CodePanel
          path={openFilePath}
          source={effectiveSource[openFilePath] ?? ""}
          dirty={isDirty(openFilePath)}
          canDiscard={canDiscard(openFilePath)}
          saving={saving}
          extraFiles={codePanelExtraFiles}
          onChange={(code) => updateSource(openFilePath, code)}
          autosaving={autosaving}
          onReset={() => void reset(openFilePath)}
          onClose={closeCodePanel}
          onWidthChange={setCodePanelWidth}
          initialWidth={codePanelWidth}
          layoutPaths={effectiveMatch?.layoutPaths ?? []}
          onOpenLayout={handleSelectComponentFile}
          readOnly={review !== null}
          onOpenHistory={gitState.value.phase === "unconfigured" || review ? undefined : () => setHistoryPath(openFilePath)}
          highlightLoc={highlightLoc}
          onCursorMove={setCodeCursor}
          onGoToDefinition={handleGoToDefinition}
        />
      )}

      {canEditCode && fileDialogPath && (
        <FileDialog
          path={fileDialogPath}
          source={effectiveSource[fileDialogPath] ?? ""}
          extraFiles={fileDialogExtraFiles}
          dirty={isDirty(fileDialogPath)}
          canDiscard={canDiscard(fileDialogPath)}
          saving={saving}
          onChange={(code) => updateSource(fileDialogPath, code)}
          autosaving={autosaving}
          onReset={() => void reset(fileDialogPath)}
          onClose={() => setFileDialogPath(null)}
          readOnly={review !== null}
          onOpenHistory={gitState.value.phase === "unconfigured" || review ? undefined : () => setHistoryPath(fileDialogPath)}
        />
      )}

      {panelMode === "vei" && (
        <VeiEntryFrame
          target={veiTarget}
          initialWidth={codePanelWidth}
          onWidthChange={setCodePanelWidth}
          adminPath={path}
          contentTypes={veiEditableTypes}
          onBrowse={() => setVeiTarget(null)}
          onClose={() => {
            setVeiTarget(null);
            setPanelMode(null);
          }}
          onFieldInput={handleFieldInput}
          onFieldFocus={handleVeiFocus}
          onSaved={handleVeiSaved}
        />
      )}

      {/* The file the chat treats as CONTEXT ("what the admin is looking
          at") - the dialog's file when one is open, otherwise the route's
          own page.tsx. Never a limit on what Magic may write. */}
      {!review && <PageSourceMagicChat
        path={magicPath}
        code={sourceByPath[magicPath] ?? ""}
        projectFiles={projectFiles}
        onCodeChange={handleMagicCodeChange}
        canUse={canEditCode}
      />}

      {canEditCode && historyPath !== undefined && <HistoryDialog open adminPath={path} filePath={historyPath ?? undefined} onReviewFile={(commit, filePath) => void reviewFile(commit, filePath)} onReviewCommit={(commit) => void reviewCommit(commit)} onClose={() => setHistoryPath(undefined)} />}

      <SavePreviewDialog
        open={saveDialogOpen}
        dirtyPaths={pendingCommitPaths}
        drafts={saveDrafts}
        allTypes={allTypes}
        progress={saveProgress}
        adminPath={path}
        onPreviewCode={(filePath) => void previewChangedCode(filePath)}
        onRevertCode={(filePath) => void reset(filePath)}
        onRevertDraft={(draft) => void revertEntryDraft(draft)}
        onUpdateDraft={(draft, value) => void updateEntryDraft(draft, value)}
        onConfirm={() => void saveAndPublish()}
        onClose={() => {
          if (!saveProgress) setSaveDialogOpen(false);
        }}
      />
    </div>
  );
}
