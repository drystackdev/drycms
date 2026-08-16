import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
const { path } = window.__DRY_CONFIG__;
import { useParam } from "../hooks/useParam.js";
import { useDocumentTitle } from "./page-common.js";
import { canAccess } from "../store/auth.js";
import { PAGE_BUILDER_RESOURCE_ID } from "../content-types/permissions.js";
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
import { MD_ROOT, PAGES_ROOT, rootOf } from "../server/app-router/source-roots.js";
import type { PreviewVeiClickRef } from "../page-components/page-preview-engine.js";
import { applyPreviewPatch, type PreviewPatchDetail } from "../page-components/vei-preview-patch.js";
import { encodeEntryId } from "../lib/id-hash.js";
import PreviewFrame from "./page-components/page-builder/PreviewFrame.js";
import Toolbar, { type BuilderPanelMode } from "./page-components/page-builder/Toolbar.js";
import BubbleMenu from "./page-components/page-builder/BubbleMenu.js";
import CodePanel from "./page-components/page-builder/CodePanel.js";
import FileDialog from "./page-components/page-builder/FileDialog.js";
import VeiEntryFrame from "./page-components/page-builder/VeiEntryFrame.js";
import SavePreviewDialog, { type SaveProgress } from "./page-components/page-builder/SavePreviewDialog.js";
import { getAllEntryDraftRecords, putEntryDraftRecord, type EntryDraftRecord } from "../content-types/entry-draft-db.js";
import { discardEntryDraft } from "../content-types/entry-draft-store.js";
import { createContentEntriesApi } from "../content-types/entries-http-api.js";
import { rebuildAffectedPages } from "../page-components/rebuild-affected-pages.js";
import { publishPagesAffectedBySource } from "../page-components/initial-publish.js";

interface PersistedBuilderState {
  panelMode: BuilderPanelMode;
  panelWidth: number;
  fileDialogPath: string | null;
  veiTarget: PreviewVeiClickRef | null;
}

const BUILDER_STATE_KEY = "drycms:page-builder-state";

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
 * Deliberately NOT `PageEditor.tsx`'s tree/draft engine (mục 10's
 * sanctioned cut, see `use-page-builder-source.ts`'s own doc comment) -
 * only the real reuse win (`buildPage()` + the preview `srcdoc` pipeline,
 * `page-preview-engine.ts`) is shared between the two pages.
 */
export default function PageBuilder() {
  const [previewTitle, setPreviewTitle] = useState("");
  useDocumentTitle(previewTitle ? `${previewTitle} - Page builder` : "Page builder");
  const canEdit = canAccess(PAGE_BUILDER_RESOURCE_ID, "setting");
  const [pathname, setPathname] = useParam<string>("path", "/");

  const { sourceByPath, loading, error: loadError, updateSource, isDirty, save, reset, saving, dirtyPaths } = usePageBuilderSource(path, canEdit);
  const [allTypes, setAllTypes] = useState<ContentTypeDefinition[] | null>(null);
  const [assetHrefs, setAssetHrefs] = useState<AssetHrefs | null>(null);
  const [dryTypes, setDryTypes] = useState<string | null>(null);
  const [origin] = useState(() => window.location.origin);

  useEffect(() => {
    if (!canEdit) return;
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
    // Best-effort, same "never fatal" spirit as `PageEditor.tsx`'s own fetch
    // of this - a missing/failed `dry.generated.d.ts` just means `dry()`
    // shows as an untyped global in the editor until it resolves.
    void fetch(`${path}/api/types-cache`, { credentials: "same-origin" })
      .then((response) => (response.ok ? response.text() : null))
      .then((text) => setDryTypes(text))
      .catch(() => setDryTypes(null));
  }, [canEdit]);

  /** Every OTHER loaded file, PLUS `dry.generated.d.ts` - `Editer`'s ambient
   * reference set for cross-file TS resolution, mirroring `PageEditor.tsx`'s
   * own `extraFiles` memo exactly (same reasons: `md/` holds plain Markdown,
   * never real TS/TSX an editor's Language Service should reason about, and
   * the currently-open file's own path is excluded per-caller below so its
   * live-editing buffer isn't shadowed by a second, stale copy of itself).
   * Without this, `CodePanel`/`FileDialog`'s `Editer` instances had no idea
   * `dry`/`params`/`setTitle` are real ambient globals or that `@component/*`
   * imports resolve to anything - spurious "cannot find name"/"cannot find
   * module" warnings Page Editor's own Editer never shows, since it always
   * wires this same set up. */
  const baseExtraFiles = useMemo(() => {
    const rest = { ...sourceByPath };
    for (const key of Object.keys(rest)) {
      if (rootOf(key)?.id === MD_ROOT) delete rest[key];
    }
    if (dryTypes) rest["dry.generated.d.ts"] = dryTypes;
    return rest;
  }, [sourceByPath, dryTypes]);

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
  const [panelMode, setPanelMode] = useState<BuilderPanelMode>(restoredState.panelMode);
  const [codePanelWidth, setCodePanelWidth] = useState(restoredState.panelWidth);
  const [fileDialogPath, setFileDialogPath] = useState<string | null>(restoredState.fileDialogPath);
  const [veiTarget, setVeiTarget] = useState<PreviewVeiClickRef | null>(restoredState.veiTarget);
  const [contentRevision, setContentRevision] = useState(0);
  const [veiOverrides, setVeiOverrides] = useState<DryVeiOverrideMap>({});
  const [saveDialogOpen, setSaveDialogOpen] = useState(false);
  const [saveDrafts, setSaveDrafts] = useState<EntryDraftRecord[]>([]);
  const [draftsHydrated, setDraftsHydrated] = useState(false);
  const [saveProgress, setSaveProgress] = useState<SaveProgress | null>(null);

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

  useEffect(() => {
    sessionStorage.setItem(BUILDER_STATE_KEY, JSON.stringify({ panelMode, panelWidth: codePanelWidth, fileDialogPath, veiTarget } satisfies PersistedBuilderState));
  }, [panelMode, codePanelWidth, fileDialogPath, veiTarget]);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const veiEnabled = panelMode === "vei";
  const sidePanelOpen = panelMode !== null;
  const saveItemCount = dirtyPaths.length + new Set([
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

  const handleVeiClick = useCallback((ref: PreviewVeiClickRef) => setVeiTarget(ref), []);

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
    const codePaths = [...dirtyPaths];
    const drafts = [...saveDrafts];
    const resources = new Set<string>();
    const totalWrites = codePaths.length + drafts.length;
    let completedWrites = 0;
    setSaveProgress({ percent: 0, label: "Preparing changes…" });
    try {
      for (const filePath of codePaths) {
        setSaveProgress({ percent: Math.round((completedWrites / Math.max(totalWrites, 1)) * 65), label: `Saving ${filePath}` });
        await save(filePath);
        completedWrites += 1;
      }
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

      setSaveProgress({ percent: 70, label: "Resolving affected pages…" });
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
      setSaveProgress({ percent: 100, label: "Saved and published" });
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

  if (!canEdit) return <span class="error">You don't have permission to use the Page Builder.</span>;
  if (loadError) return <span class="error">{loadError}</span>;
  if (loading || !sourceByPath || !allTypes || !assetHrefs || !draftsHydrated) {
    return (
      <div class="page-builder-root page-builder-loading">
        <span class="spinner" />
        <span class="hint">Loading…</span>
      </div>
    );
  }

  return (
    <div class="page-builder-root">
      <PreviewFrame
        iframeRef={iframeRef}
        pathname={pathname}
        match={match}
        sourceByPath={sourceByPath}
        allTypes={allTypes}
        assetHrefs={assetHrefs}
        origin={origin}
        adminPath={path}
        veiEnabled={veiEnabled}
        veiContext={veiContext}
        onNavigate={setPathname}
        onSave={() => void openSavePreview()}
        onVeiClick={handleVeiClick}
        onTitleChange={setPreviewTitle}
        codePanelWidth={sidePanelOpen ? codePanelWidth : 0}
        contentRevision={contentRevision}
        veiOverrides={veiOverrides}
      />

      <Toolbar
        onExit={() => (window.location.href = `${path}/dashboard`)}
        onOpenMenu={() => setBubbleRoot((current) => (current ? null : PAGES_ROOT))}
        panelMode={panelMode}
        onTogglePanel={togglePanel}
        onSave={() => void openSavePreview()}
        saveDisabled={dirtyPaths.length === 0 && saveDrafts.length === 0 && Object.keys(veiOverrides).length === 0}
        saveCount={saveItemCount}
      />

      {bubbleRoot && (
        <BubbleMenu
          sourceByPath={sourceByPath}
          activeRoot={bubbleRoot}
          activePath={activePagePath}
          onRootChange={setBubbleRoot}
          onSelectPageFile={(entryPath) => void handleSelectPageFile(entryPath)}
          onSelectOtherFile={handleSelectOtherFile}
          onClose={() => setBubbleRoot(null)}
        />
      )}

      {panelMode === "code" && match?.entryPath && rootOf(match.entryPath)?.id === PAGES_ROOT && (
        <CodePanel
          path={match.entryPath}
          source={sourceByPath[match.entryPath] ?? ""}
          dirty={isDirty(match.entryPath)}
          saving={saving}
          extraFiles={codePanelExtraFiles}
          onChange={(code) => updateSource(match.entryPath, code)}
          onSave={() => void openSavePreview()}
          onReset={() => reset(match.entryPath)}
          onClose={() => setPanelMode(null)}
          onWidthChange={setCodePanelWidth}
          initialWidth={codePanelWidth}
          layoutPaths={match.layoutPaths}
          onOpenLayout={setFileDialogPath}
        />
      )}

      {fileDialogPath && (
        <FileDialog
          path={fileDialogPath}
          source={sourceByPath[fileDialogPath] ?? ""}
          sourceByPath={sourceByPath}
          extraFiles={fileDialogExtraFiles}
          dirty={isDirty(fileDialogPath)}
          saving={saving}
          onChange={(code) => updateSource(fileDialogPath, code)}
          onSave={() => void save(fileDialogPath)}
          onReset={() => reset(fileDialogPath)}
          onClose={() => setFileDialogPath(null)}
          allTypes={allTypes}
          assetHrefs={assetHrefs}
          origin={origin}
          adminPath={path}
          previewPathname={pathname}
          previewEntryPath={match?.entryPath ?? null}
          previewLayoutPaths={match?.layoutPaths ?? []}
          previewParams={match?.params ?? {}}
        />
      )}

      {panelMode === "vei" && (
        <VeiEntryFrame
          target={veiTarget}
          panelWidth={codePanelWidth}
          adminPath={path}
          onClose={() => {
            setVeiTarget(null);
            setPanelMode(null);
          }}
          onFieldInput={handleFieldInput}
          onSaved={handleVeiSaved}
        />
      )}

      <SavePreviewDialog
        open={saveDialogOpen}
        dirtyPaths={dirtyPaths}
        drafts={saveDrafts}
        allTypes={allTypes}
        progress={saveProgress}
        adminPath={path}
        onPreviewCode={(filePath) => void previewChangedCode(filePath)}
        onRevertCode={reset}
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
