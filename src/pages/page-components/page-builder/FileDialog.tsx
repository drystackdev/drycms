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
  const [propsSchema, setPropsSchema] = useState<PropsSchema | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const blobUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    return () => {
      for (const url of blobUrlsRef.current) URL.revokeObjectURL(url);
    };
  }, []);

  useEffect(() => {
    if (!isComponent) return;
    const timer = setTimeout(async () => {
      try {
        const previewSource = buildComponentPreviewSource(props.path, samplePropsSource(propsSchema));
        const { html, blobUrls } = await buildPreviewSrcdoc({
          buildInput: {
            pathname: "/__dry-preview-component",
            origin: props.origin,
            adminPath: props.adminPath,
            siteLang: "en",
            assets: { globalsCssHref: props.assetHrefs.globalsCssHref, hydrateEntryHref: props.assetHrefs.hydrateBuiltHref, veiOverlayHref: props.assetHrefs.veiOverlayHref },
            preactRuntimeHref: `${props.origin}${props.assetHrefs.preactRuntimeHref}`,
            builtAssetsBaseUrl: `${props.origin}${props.adminPath}/api/built-assets`,
            dryHttpEndpoint: `${props.adminPath}/api/dry-http`,
            allTypes: props.allTypes,
            sourceByPath: { ...props.sourceByPath, [props.path]: props.source, [COMPONENT_PREVIEW_ENTRY_PATH]: previewSource },
            entryPath: COMPONENT_PREVIEW_ENTRY_PATH,
            layoutPaths: [],
            params: {},
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
  }, [isComponent, props.path, props.source, propsSchema, props.sourceByPath, props.allTypes, props.assetHrefs, props.origin, props.adminPath]);

  function handleChange(result: EditerResult) {
    props.onChange(result.code);
    if (result.propsSchema !== undefined) setPropsSchema(result.propsSchema);
  }

  return (
    <dialog ref={dialogRef} aria-label={props.path} class="xl page-builder-file-dialog">
      <header>
        <h3>{props.path}</h3>
      </header>
      <div class={isComponent ? "page-builder-file-dialog-body split" : "page-builder-file-dialog-body"}>
        {isComponent && (
          <div class="page-builder-file-dialog-preview">
            {previewError && <p class="error">{previewError}</p>}
            <iframe ref={iframeRef} title="Component preview" style={{ width: "100%", height: "100%", border: "0" }} />
          </div>
        )}
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
      <footer>
        <button type="button" class="outline" disabled={!props.dirty || props.saving} onClick={props.onReset}>
          Reset
        </button>
        <button type="button" class="outline" onClick={props.onClose}>
          Close
        </button>
        <button type="button" disabled={!props.dirty || props.saving} aria-busy={props.saving} onClick={props.onSave}>
          Save
        </button>
      </footer>
    </dialog>
  );
}
