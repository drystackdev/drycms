import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
const { path } = window.__DRY_CONFIG__;
import { useParam } from "../hooks/useParam.js";
import { useDocumentTitle } from "./page-common.js";
import { authState, canAccess } from "../store/auth.js";
import { isVeiEditableType, PAGE_BUILDER_RESOURCE_ID } from "../content-types/permissions.js";
import type { DryVeiContext } from "../content-types/dry-context.js";
import { dryVeiOverrideKey, type DryVeiOverrideMap } from "../content-types/dry-reader-http.js";
import type { ContentTypeDefinition } from "../content-types/types.js";
import { toast } from "../components/Toast.js";
import { createContentTypesApi, listCached } from "../content-types/http-api.js";
import { fetchJson, type AssetHrefs } from "../page-components/pages-source-http.js";
import { usePageBuilderSource } from "../page-components/use-page-builder-source.js";
import { buildManifestRouteTree, listDynamicPageTemplates, matchSourceRoute, staticPagePaths } from "../server/app-router/route-manifest.js";
import { fetchPreviewEntries } from "../page-components/dynamic-routes.js";
import { collectionTypeForPageSource } from "../server/app-router/page-collection.js";
import { MD_ROOT, PAGES_ROOT, STYLES_ROOT, rootOf } from "../server/app-router/source-roots.js";
import { PREVIEW_VEI_FOCUS_MESSAGE, type PreviewVeiClickRef } from "../page-components/page-preview-engine.js";
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
import { rebuildAffectedPages } from "../page-components/rebuild-affected-pages.js";
import { publishPagesAffectedBySource } from "../page-components/initial-publish.js";
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
  fileDialogPath: string | null;
  veiTarget: PreviewVeiClickRef | null;
}

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
      <div class="page-builder-loading-overlay" role="status" aria-label="Loading Page Builder">
        <span class="spinner" />
        <span>Loading…</span>
      </div>
    </div>
  );
}

const BUILDER_STATE_KEY = "drycms:page-builder-state";

/** A commit message that says what changed without putting a dialog in the
 * way - Save is one button, and a page/component path is already the most
 * useful summary there is. A path no longer present in the loaded tree was
 * deleted, so the verb follows the actual change rather than always reading
 * "Update". Long lists collapse to a count. */
function commitMessageFor(paths: string[], sourceByPath: Record<string, string>): string {
  const removed = paths.filter((filePath) => !(filePath in sourceByPath));
  const verb = removed.length === paths.length ? "Delete" : "Update";
  if (paths.length === 1) return `${verb} ${paths[0]}`;
  if (paths.length <= 3) return `${verb} ${paths.join(", ")}`;
  return `${verb} ${paths.length} page source files`;
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
  const fallback: PersistedBuilderState = { panelMode: "code", panelWidth: 480, fileDialogPath: null, veiTarget: null };
  try {
    const value = JSON.parse(sessionStorage.getItem(BUILDER_STATE_KEY) ?? "null") as Partial<PersistedBuilderState> | null;
    if (!value) return fallback;
    const panelMode = value.panelMode === "vei" || value.panelMode === "code" || value.panelMode === null ? value.panelMode : "code";
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
  const [veiTarget, setVeiTarget] = useState<PreviewVeiClickRef | null>(restoredState.veiTarget);
  const [contentRevision, setContentRevision] = useState(0);
  const [veiOverrides, setVeiOverrides] = useState<DryVeiOverrideMap>({});
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveDrafts, setSaveDrafts] = useState<EntryDraftRecord[]>([]);
  const [draftsHydrated, setDraftsHydrated] = useState(false);
  const [saveProgress, setSaveProgress] = useState<SaveProgress | null>(null);
  const [recoveredCoreFiles, setRecoveredCoreFiles] = useState<string[]>([]);

  useEffect(() => {
    void getAllEntryDraftRecords().then((records) => {
      setSaveDrafts(records);
      const restoredOverrides: DryVeiOverrideMap = {};
      for (const draft of records) {
        restoredOverrides[dryVeiOverrideKey(draft.typeSlug, draft.entryId)] = { ...draft.value };
      }
      setVeiOverrides((current) => ({ ...restoredOverrides, ...current }));
      setDraftsHydrated(true);
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

  function togglePanel(mode: Exclude<BuilderPanelMode, null>) {
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
  const codePanelExtraFiles = useMemo(
    () => (activePagePath ? extraFilesExcluding(activePagePath) : baseExtraFiles),
    [activePagePath, baseExtraFiles],
  );
  const fileDialogExtraFiles = useMemo(
    () => (fileDialogPath ? extraFilesExcluding(fileDialogPath) : baseExtraFiles),
    [fileDialogPath, baseExtraFiles],
  );
  /** What Magic Chat treats as "the file the admin is looking at" - the
   * dialog's file when one is open, otherwise the previewed route's own
   * entry file. `""` when neither resolves (a route with no page source
   * yet), which the chat accepts: `path` is context, never a limit on what
   * it may write. */
  const magicPath = fileDialogPath ?? match?.entryPath ?? "";

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
      setPanelMode("code");
    }
    setBubbleRoot(null);
  }

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
    if (rootOf(filePath)?.id !== PAGES_ROOT || !/(^|\/)page\.tsx$/.test(filePath)) {
      setFileDialogPath(filePath);
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
    setPanelMode("code");
  }

  async function handleRenameFile(from: string, to: string) {
    await renameFile(from, to);
    if (fileDialogPath === from) setFileDialogPath(to);
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
    if (fileDialogPath === filePath) setFileDialogPath(null);
    if (match?.entryPath === filePath) setPathname("/");
  }

  const handleVeiClick = useCallback((ref: PreviewVeiClickRef) => setVeiTarget(ref), []);
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
    if (rootOf(filePath)?.id === PAGES_ROOT) {
      const resolved = await resolvePageFilePathname(filePath);
      if (resolved) setPathname(resolved);
      setPanelMode("code");
      setVeiTarget(null);
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
    try {
      for (const draft of drafts) {
        const type = types.find((candidate) => candidate.name === draft.typeSlug);
        if (!type || type.kind === "component") continue;
        setSaveProgress({ percent: Math.round((completedWrites / Math.max(totalWrites, 1)) * 65), label: `Saving ${type.label}` });
        const api = createContentEntriesApi(`${path}/api/content`, type.name);
        if (type.kind === "singleton") await api.saveSingleton(draft.value);
        else if (draft.entryId === null) await api.create(draft.value);
        else await api.update(draft.entryId, draft.value);
        await discardEntryDraft(draft.typeSlug, draft.entryId);
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
        const result = await publishPagesAffectedBySource(path, types, codePaths, (message) => setSaveProgress({ percent: 90, label: message }));
        if (result.error) throw new Error(result.error);
      } else {
        const names = [...resources];
        for (const [index, typeName] of names.entries()) {
          const percent = 70 + Math.round((index / Math.max(names.length, 1)) * 25);
          setSaveProgress({ percent, label: `Building pages that use ${typeName}…` });
          await rebuildAffectedPages(path, typeName, types, (message) => setSaveProgress({ percent, label: message }));
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
    }
  }

  if (loadError) return <span class="error">{loadError}</span>;
  // Only judged once `allTypes` has actually resolved - `canUseVei` depends
  // on it, so checking permission any earlier would flash this at a
  // VEI-only role on every load, before its own access can be seen.
  if (allTypes && !canEnterBuilder) return <span class="error">You don't have permission to use the Page Builder.</span>;
  if (loading || !sourceByPath || !allTypes || !assetHrefs || !draftsHydrated) {
    return (
      <div class="page-builder-root">
        <PageBuilderLoadingLayer pathname={pathname} />
      </div>
    );
  }

  return (
    <div class={`page-builder-root${review ? " history-review" : ""}`}>
      {review && <div class="page-builder-history-banner"><span>Viewing history · {review.commit.sha.slice(0, 7)} · {review.commit.message.split("\n")[0]} · {new Date(review.commit.date).toLocaleString()}</span><span class="row"><button type="button" class="sm" onClick={() => void revertReview()}>Revert</button><button type="button" class="outline sm" onClick={() => setReview(null)}>Exit</button></span></div>}
      <PreviewFrame
        iframeRef={iframeRef}
        pathname={pathname}
        match={match}
        sourceByPath={effectiveSource}
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
      />

      {!previewReady && <PageBuilderLoadingLayer pathname={pathname} />}

      {!review && <Toolbar
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
          activePath={activePagePath}
          onRootChange={setBubbleRoot}
          onSelectPageFile={(entryPath) => void handleSelectPageFile(entryPath)}
          onSelectOtherFile={handleSelectOtherFile}
          recoveredCoreFiles={recoveredCoreFiles}
          onCreateFile={handleCreateFile}
          onRenameFile={handleRenameFile}
          onDeleteFile={handleDeleteFile}
          onClose={() => setBubbleRoot(null)}
        />
      )}

      {panelMode === "code" && (
        <div
          class="page-builder-drawer-backdrop"
          onClick={() => setPanelMode(null)}
        />
      )}

      {canEditCode && panelMode === "code" && match?.entryPath && rootOf(match.entryPath)?.id === PAGES_ROOT && (
        <CodePanel
          path={match.entryPath}
          source={effectiveSource[match.entryPath] ?? ""}
          dirty={isDirty(match.entryPath)}
          canDiscard={canDiscard(match.entryPath)}
          saving={saving}
          extraFiles={codePanelExtraFiles}
          onChange={(code) => updateSource(match.entryPath, code)}
          autosaving={autosaving}
          onReset={() => void reset(match.entryPath)}
          onClose={() => setPanelMode(null)}
          onWidthChange={setCodePanelWidth}
          initialWidth={codePanelWidth}
          layoutPaths={match.layoutPaths}
          onOpenLayout={setFileDialogPath}
          readOnly={review !== null}
          onOpenHistory={gitState.value.phase === "unconfigured" || review ? undefined : () => setHistoryPath(match.entryPath)}
        />
      )}

      {canEditCode && fileDialogPath && (
        <FileDialog
          path={fileDialogPath}
          source={effectiveSource[fileDialogPath] ?? ""}
          sourceByPath={effectiveSource}
          extraFiles={fileDialogExtraFiles}
          dirty={isDirty(fileDialogPath)}
          canDiscard={canDiscard(fileDialogPath)}
          saving={saving}
          onChange={(code) => updateSource(fileDialogPath, code)}
          autosaving={autosaving}
          onReset={() => void reset(fileDialogPath)}
          onClose={() => setFileDialogPath(null)}
          allTypes={allTypes}
          assetHrefs={assetHrefs}
          origin={origin}
          adminPath={path}
          previewPathname={pathname}
          previewEntryPath={match?.entryPath ?? null}
          previewLayoutPaths={match?.layoutPaths ?? []}
          previewParams={match?.params ?? {}}
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
