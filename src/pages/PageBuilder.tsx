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
import Toolbar from "./page-components/page-builder/Toolbar.js";
import BubbleMenu from "./page-components/page-builder/BubbleMenu.js";
import CodePanel from "./page-components/page-builder/CodePanel.js";
import FileDialog from "./page-components/page-builder/FileDialog.js";
import VeiEntryFrame from "./page-components/page-builder/VeiEntryFrame.js";

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
  useDocumentTitle("Page Builder");
  const canEdit = canAccess(PAGE_BUILDER_RESOURCE_ID, "setting");
  const [pathname, setPathname] = useParam<string>("path", "/");

  const { sourceByPath, loading, error: loadError, updateSource, isDirty, save, reset, saving } = usePageBuilderSource(path);
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

  const [veiEnabled, setVeiEnabled] = useState(false);
  const [bubbleRoot, setBubbleRoot] = useState<string | null>(null);
  // Start on the route's own page.tsx as soon as the manifest resolves;
  // preview navigation then keeps this same panel focused on the newly
  // matched entry path without requiring a second file-menu selection.
  const [codePanelOpen, setCodePanelOpen] = useState(true);
  const [codePanelWidth, setCodePanelWidth] = useState(480);
  const [fileDialogPath, setFileDialogPath] = useState<string | null>(null);
  const [veiTarget, setVeiTarget] = useState<PreviewVeiClickRef | null>(null);
  const [contentRevision, setContentRevision] = useState(0);
  const [veiOverrides, setVeiOverrides] = useState<DryVeiOverrideMap>({});
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const sidePanelOpen = codePanelOpen || !!veiTarget;

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
      setCodePanelOpen(true);
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

  async function handleToolbarSave() {
    if (match?.entryPath) await save(match.entryPath);
  }

  if (!canEdit) return <span class="error">You don't have permission to use the Page Builder.</span>;
  if (loadError) return <span class="error">{loadError}</span>;
  if (loading || !sourceByPath || !allTypes || !assetHrefs) {
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
        onSave={() => void handleToolbarSave()}
        onVeiClick={handleVeiClick}
        codePanelWidth={sidePanelOpen ? codePanelWidth : 0}
        contentRevision={contentRevision}
        veiOverrides={veiOverrides}
      />

      <Toolbar
        onExit={() => (window.location.href = `${path}/dashboard`)}
        onOpenMenu={() => setBubbleRoot((current) => (current ? null : PAGES_ROOT))}
        veiEnabled={veiEnabled}
        onToggleVei={() => setVeiEnabled((v) => !v)}
        onSave={handleToolbarSave}
        saveDisabled={!activePagePath || !isDirty(activePagePath) || saving}
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

      {codePanelOpen && match?.entryPath && rootOf(match.entryPath)?.id === PAGES_ROOT && (
        <CodePanel
          path={match.entryPath}
          source={sourceByPath[match.entryPath] ?? ""}
          dirty={isDirty(match.entryPath)}
          saving={saving}
          extraFiles={codePanelExtraFiles}
          onChange={(code) => updateSource(match.entryPath, code)}
          onSave={() => void save(match.entryPath)}
          onReset={() => reset(match.entryPath)}
          onClose={() => setCodePanelOpen(false)}
          onWidthChange={setCodePanelWidth}
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
        />
      )}

      {veiTarget && (
        <VeiEntryFrame
          target={veiTarget}
          panelWidth={codePanelWidth}
          adminPath={path}
          onClose={() => setVeiTarget(null)}
          onFieldInput={handleFieldInput}
          onSaved={handleVeiSaved}
        />
      )}
    </div>
  );
}
