import { useEffect, useRef, useState } from "preact/hooks";
import type { RefObject } from "preact";
import {
  buildPreviewSrcdoc,
  PREVIEW_NAVIGATE_MESSAGE,
  PREVIEW_SAVE_MESSAGE,
  PREVIEW_TITLE_MESSAGE,
  PREVIEW_VEI_CLICK_MESSAGE,
  PREVIEW_VEI_MODE_MESSAGE,
  type PreviewVeiClickRef,
} from "../../../page-components/page-preview-engine.js";
import type { SourceRouteMatch } from "../../../server/app-router/route-manifest.js";
import type { AssetHrefs } from "../../../page-components/pages-source-http.js";
import type { ContentTypeDefinition } from "../../../content-types/types.js";
import type { DryVeiContext } from "../../../content-types/dry-context.js";
import type { DryVeiOverrideMap } from "../../../content-types/dry-reader-http.js";

/**
 * The full-viewport `<iframe srcdoc>` `/dry/page-builder` is built around
 * (`plans/new-ui-page-builder.md` mục 2/3) - "Nguyên trang là iframe chiếm
 * 100% screen của browser có cùng chức năng với preview". Unlike
 * `PageEditor.tsx`'s own preview column, there's no zoom/viewport
 * simulation here: the iframe renders at real 1:1 size, the browser's own
 * window IS the viewport.
 */
export interface PreviewFrameProps {
  iframeRef: RefObject<HTMLIFrameElement>;
  pathname: string;
  match: SourceRouteMatch | null;
  sourceByPath: Record<string, string>;
  allTypes: ContentTypeDefinition[];
  assetHrefs: AssetHrefs;
  origin: string;
  adminPath: string;
  veiEnabled: boolean;
  veiContext: DryVeiContext | undefined;
  onNavigate: (pathname: string) => void;
  onSave: () => void;
  onVeiClick: (ref: PreviewVeiClickRef) => void;
  onTitleChange: (title: string) => void;
  codePanelWidth: number;
  /** Changes only after a successful VEI content save, forcing a fresh
   * `dry()` render even though no page-source code changed. */
  contentRevision: number;
  veiOverrides: DryVeiOverrideMap;
}

export default function PreviewFrame(props: PreviewFrameProps) {
  const { iframeRef, pathname, match, sourceByPath, allTypes, assetHrefs, origin, adminPath, veiEnabled, veiContext } = props;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seqRef = useRef(0);
  const blobUrlsRef = useRef<string[]>([]);

  const syncVeiMode = () => {
    iframeRef.current?.contentWindow?.postMessage({ type: PREVIEW_VEI_MODE_MESSAGE, enabled: props.veiEnabled }, "*");
  };

  const handleLoad = () => {
    syncVeiMode();
  };

  useEffect(syncVeiMode, [props.veiEnabled]);

  useEffect(() => {
    return () => {
      for (const url of blobUrlsRef.current) URL.revokeObjectURL(url);
      blobUrlsRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (!match) {
      setError(null);
      return;
    }
    const seq = ++seqRef.current;
    const timer = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const { html, blobUrls } = await buildPreviewSrcdoc({
          buildInput: {
            pathname,
            origin,
            adminPath,
            siteLang: "en",
            assets: { globalsCssHref: assetHrefs.globalsCssHref, hydrateEntryHref: assetHrefs.hydrateBuiltHref, veiOverlayHref: assetHrefs.veiOverlayHref },
            preactRuntimeHref: `${origin}${assetHrefs.preactRuntimeHref}`,
            builtAssetsBaseUrl: `${origin}${adminPath}/api/built-assets`,
            dryHttpEndpoint: `${adminPath}/api/dry-http`,
            allTypes,
            sourceByPath,
            entryPath: match.entryPath,
            layoutPaths: match.layoutPaths,
            params: match.params,
            vei: veiContext,
            veiOverrides: props.veiOverrides,
          },
          veiOverlayHref: assetHrefs.veiOverlayHref,
          veiEnabled: true,
          runtimeVeiToggle: true,
        });
        if (seq !== seqRef.current) return;
        if (iframeRef.current) iframeRef.current.srcdoc = html;
        for (const url of blobUrlsRef.current) URL.revokeObjectURL(url);
        blobUrlsRef.current = blobUrls;
      } catch (err) {
        if (seq !== seqRef.current) return;
        setError(err instanceof Error ? err.message : "Preview failed.");
      } finally {
        if (seq === seqRef.current) setLoading(false);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, 400);
    return () => clearTimeout(timer);
  }, [match?.entryPath, match?.layoutPaths.join(","), JSON.stringify(match?.params), sourceByPath, allTypes, assetHrefs, origin, adminPath, props.contentRevision, props.veiOverrides]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (!event.data) return;
      if (iframeRef.current && event.source !== iframeRef.current.contentWindow) return;
      if (event.data.type === PREVIEW_SAVE_MESSAGE) return props.onSave();
      if (event.data.type === PREVIEW_TITLE_MESSAGE) {
        if (typeof event.data.title === "string") props.onTitleChange(event.data.title.trim());
        return;
      }
      if (event.data.type === PREVIEW_VEI_CLICK_MESSAGE) {
        if (event.data.ref) props.onVeiClick(event.data.ref as PreviewVeiClickRef);
        return;
      }
      if (event.data.type !== PREVIEW_NAVIGATE_MESSAGE) return;
      if (typeof event.data.pathname === "string") props.onNavigate(event.data.pathname);
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [props.onSave, props.onNavigate, props.onVeiClick]);

  return (
    <div class="page-builder-preview" style={{ right: `${props.codePanelWidth}px` }}>
      {!match && (
        <div class="page-builder-preview-empty hint">No page.tsx matches "{pathname}" - pick a page from the menu.</div>
      )}
      {error && <div class="page-builder-preview-error error">{error}</div>}
      <iframe
        ref={iframeRef}
        class="page-builder-preview-frame"
        title="Page preview"
        aria-busy={loading}
        sandbox="allow-scripts"
        onLoad={handleLoad}
        style={{ width: "100%", height: "100%", border: "0", display: match ? "block" : "none" }}
      />
    </div>
  );
}
