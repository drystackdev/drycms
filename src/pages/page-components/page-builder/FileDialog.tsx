import { useEffect, useRef, useState } from "preact/hooks";
import { useDialogSync } from "../../../hooks/list-nav.js";
import Editer from "../../../components/Editer.js";
import type { EditerFormatLanguage } from "../../../components/Editer/format-code.js";
import type { EditerResult } from "../../../components/Editer/types.js";
import type { PropsSchema } from "../../../components/Editer/worker-protocol.js";
import { buildPreviewSrcdoc } from "../../../page-components/page-preview-engine.js";
import { COMPONENT_PREVIEW_ENTRY_PATH, buildComponentPreviewSource } from "../../../page-components/component-preview.js";
import { samplePropsSource } from "../../../page-components/props-sample.js";
import { COMPONENT_ROOT, MD_ROOT, STYLES_ROOT, rootOf } from "../../../server/app-router/source-roots.js";
import type { AssetHrefs } from "../../../page-components/pages-source-http.js";
import type { ContentTypeDefinition } from "../../../content-types/types.js";
import { PAGES_ROOT } from "../../../server/app-router/source-roots.js";
import { useScaledPreview } from "../../page-components/useDevicePreview.js";
import { useResizablePanel } from "../../../lib/useResizablePanel.js";
import { useOverlayScrollbars } from "../../../hooks/overlayscrollbars.js";
import { mergeRefs } from "../../../lib/merge-refs.js";

type ViewportKey = "xs" | "sm" | "md" | "lg" | "xl";
const VIEWPORT_WIDTHS: Record<ViewportKey, number> = { xs: 375, sm: 640, md: 768, lg: 1024, xl: 1280 };
const VIEWPORT_KEYS = Object.keys(VIEWPORT_WIDTHS) as ViewportKey[];
const ZOOM_STEP = 0.1;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 2;
const PREVIEW_HEIGHT = 720;

export interface FileDialogProps {
  path: string;
  source: string;
  sourceByPath: Record<string, string>;
  /** Every other file (plus `dry.generated.d.ts`) for the `Editer`'s
   * cross-file TS resolution - see `PageBuilder.tsx`'s `baseExtraFiles`/
   * `extraFilesExcluding`. Without this, a component file's `dry()` calls
   * and `@component/*` imports show as unresolved - warnings Page Editor's
   * own Editer never has, since it always wires this same set up. */
  extraFiles: Record<string, string>;
  dirty: boolean;
  saving: boolean;
  onChange: (code: string) => void;
  onSave: () => void;
  onReset: () => void;
  onClose: () => void;
  allTypes: ContentTypeDefinition[];
  assetHrefs: AssetHrefs;
  origin: string;
  adminPath: string;
  previewPathname: string;
  previewEntryPath: string | null;
  previewLayoutPaths: string[];
  previewParams: Record<string, string | string[]>;
}

function languageForPath(path: string): EditerFormatLanguage {
  const root = rootOf(path)?.id;
  if (root === STYLES_ROOT) return "css";
  if (root === MD_ROOT) return "md";
  return "tsx";
}

/**
 * `component/`/`styles/`/`md/` files (`plans/new-ui-page-builder.md` mục 7) -
 * a `<dialog class="xl">`, 1 column for style/md (no meaningful preview) or
 * 2 for a component (reusing `buildComponentPreviewSource`/`buildPage()`,
 * the same synthetic-page trick `PageEditor.tsx`'s own Component tab
 * preview uses). Save/Reset write straight to `pagesSourceStorage` -
 * there's no staged-apply here, matching Page Editor's own current
 * behavior for this same storage.
 */
export default function FileDialog(props: FileDialogProps) {
  const dialogRef = useDialogSync(true, props.onClose);
  const isComponent = rootOf(props.path)?.id === COMPONENT_ROOT && /\.tsx$/i.test(props.path);
  const isLayout = rootOf(props.path)?.id === PAGES_ROOT && /(^|\/)layout\.tsx$/i.test(props.path);
  const hasPreview = isComponent || (isLayout && props.previewEntryPath !== null);
  const [propsSchema, setPropsSchema] = useState<PropsSchema | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const blobUrlsRef = useRef<string[]>([]);
  const viewport = useScaledPreview<ViewportKey>(VIEWPORT_WIDTHS, "xs");
  const [manualZoom, setManualZoom] = useState<number | null>(null);
  const effectiveZoom = manualZoom ?? viewport.scale;
  const previewPanel = useResizablePanel({ initial: 420, min: 280, max: 800, axis: "x" });
  const previewScroll = useOverlayScrollbars<HTMLDivElement, HTMLDivElement>([hasPreview], {
    scrollbars: { autoHide: "never" },
  });

  useEffect(() => {
    return () => {
      for (const url of blobUrlsRef.current) URL.revokeObjectURL(url);
    };
  }, []);

  useEffect(() => {
    if (!hasPreview) return;
    const timer = setTimeout(async () => {
      try {
        const previewSource = isComponent ? buildComponentPreviewSource(props.path, samplePropsSource(propsSchema)) : null;
        const entryPath = isComponent ? COMPONENT_PREVIEW_ENTRY_PATH : props.previewEntryPath!;
        const { html, blobUrls } = await buildPreviewSrcdoc({
          buildInput: {
            pathname: isComponent ? "/__dry-preview-component" : props.previewPathname,
            origin: props.origin,
            adminPath: props.adminPath,
            siteLang: "en",
            assets: { globalsCssHref: props.assetHrefs.globalsCssHref, hydrateEntryHref: props.assetHrefs.hydrateBuiltHref, veiOverlayHref: props.assetHrefs.veiOverlayHref },
            preactRuntimeHref: `${props.origin}${props.assetHrefs.preactRuntimeHref}`,
            builtAssetsBaseUrl: `${props.origin}${props.adminPath}/api/built-assets`,
            dryHttpEndpoint: `${props.adminPath}/api/dry-http`,
            allTypes: props.allTypes,
            sourceByPath: {
              ...props.sourceByPath,
              [props.path]: props.source,
              ...(previewSource ? { [COMPONENT_PREVIEW_ENTRY_PATH]: previewSource } : {}),
            },
            entryPath,
            layoutPaths: isComponent ? [] : props.previewLayoutPaths,
            params: isComponent ? {} : props.previewParams,
          },
          veiOverlayHref: props.assetHrefs.veiOverlayHref,
        });
        setPreviewError(null);
        if (iframeRef.current) iframeRef.current.srcdoc = html;
        for (const url of blobUrlsRef.current) URL.revokeObjectURL(url);
        blobUrlsRef.current = blobUrls;
      } catch (error) {
        setPreviewError(error instanceof Error ? error.message : "Preview failed.");
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [hasPreview, isComponent, props.path, props.source, propsSchema, props.sourceByPath, props.allTypes, props.assetHrefs, props.origin, props.adminPath, props.previewPathname, props.previewEntryPath, props.previewLayoutPaths, props.previewParams]);

  function handleChange(result: EditerResult) {
    props.onChange(result.code);
    if (result.propsSchema !== undefined) setPropsSchema(result.propsSchema);
  }

  return (
    <dialog ref={dialogRef} aria-label={props.path} class="xl page-builder-file-dialog">
      <header class="page-builder-file-dialog-header">
        <strong class="page-builder-file-dialog-title">{props.path}</strong>
        <span class="spacer" />
        <button type="button" class="outline sm" disabled={!props.dirty || props.saving} onClick={props.onReset}>Reset</button>
        <button type="button" class="sm" disabled={!props.dirty || props.saving} aria-busy={props.saving} onClick={props.onSave}>Save</button>
        <button type="button" class="ghost sm" onClick={props.onClose}>Close</button>
      </header>
      <div class={hasPreview ? "page-builder-file-dialog-body split" : "page-builder-file-dialog-body"}>
        {hasPreview && (
          <div class="page-builder-file-dialog-preview" style={{ width: `${previewPanel.size}px` }}>
            <div class="page-builder-file-dialog-preview-toolbar">
              <div class="button-group">
                {VIEWPORT_KEYS.map((key) => (
                  <button key={key} type="button" class="sm" aria-pressed={viewport.key === key && viewport.widthOverride === null} title={`${VIEWPORT_WIDTHS[key]}px`} onClick={() => viewport.select(key)}>
                    {key.toUpperCase()}
                  </button>
                ))}
              </div>
              <span class="spacer" />
              <button type="button" class="ghost icon sm" aria-label="Zoom out" onClick={() => setManualZoom(Math.max(MIN_ZOOM, effectiveZoom - ZOOM_STEP))}>−</button>
              <span class="hint">{Math.round(effectiveZoom * 100)}%</span>
              <button type="button" class="ghost icon sm" aria-label="Zoom in" onClick={() => setManualZoom(Math.min(MAX_ZOOM, effectiveZoom + ZOOM_STEP))}>+</button>
              <button type="button" class="outline sm" disabled={manualZoom === null} onClick={() => setManualZoom(null)}>Fit</button>
            </div>
            {previewError && <p class="error page-builder-file-dialog-preview-error">{previewError}</p>}
            <div class="page-builder-file-dialog-preview-scroll" ref={previewScroll.ref}>
              <div class="page-builder-file-dialog-preview-scroll-viewport" ref={mergeRefs(viewport.viewportRef, previewScroll.viewportRef)}>
                <div class="page-components-preview-frame" style={{ width: `${viewport.width * effectiveZoom}px`, height: `${PREVIEW_HEIGHT * effectiveZoom}px` }}>
                  <div style={{ width: `${viewport.width}px`, height: `${PREVIEW_HEIGHT}px`, transform: `scale(${effectiveZoom})`, transformOrigin: "top left" }}>
                    <iframe ref={iframeRef} sandbox="allow-scripts" title={isComponent ? "Component preview" : "Layout preview"} style={{ width: "100%", height: "100%", border: "0", background: "#fff", display: "block" }} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        {hasPreview && <div class={`page-components-resize-handle${previewPanel.dragging ? " dragging" : ""}`} {...previewPanel.handleProps} />}
        <div class="page-builder-file-dialog-editor">
          <Editer
            key={props.path}
            value={props.source}
            onChange={handleChange}
            extraFiles={props.extraFiles}
            language={languageForPath(props.path)}
            describeProps={isComponent}
            style={{ height: "100%" }}
          />
        </div>
      </div>
    </dialog>
  );
}
