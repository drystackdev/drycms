import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { CollectionIcon, EditIcon, SingletonIcon } from "../../../components/icons/index.js";
import { encodeEntryId } from "../../../lib/id-hash.js";
import { useResizablePanel } from "../../../lib/useResizablePanel.js";
import { useOverlayScrollbars } from "../../../hooks/overlayscrollbars.js";
import { BUILDER_PANEL_WIDTH, clampBuilderPanelWidth } from "./panel-width.js";
import type { PreviewVeiClickRef } from "../../../page-components/page-preview-engine.js";
import type { PreviewPatchDetail } from "../../../page-components/vei-preview-patch.js";
import type { ContentTypeDefinition } from "../../../content-types/types.js";
import type { FieldFocusEventDetail } from "../../content-entry-editor/field-events.js";

/** The ordinary entry-editor admin route, aimed at one field - the
 * ordinary entry editor, `?_field=`/`?_path=` aimed at the clicked field,
 * `?_vei=1` so `content-entry-editor/builder-bridge.ts`'s `isVeiFrame()` recognizes it and
 * relays its `dry:field-*`/`dry:entry-save(d)` events out via
 * `postMessage` (`plans/new-ui-page-builder.md` mục 8). */
function editorUrl(adminPath: string, ref: PreviewVeiClickRef): string {
  const base = ref.kind === "singleton" ? `${adminPath}/content/${ref.type}` : `${adminPath}/content/${ref.type}/${encodeEntryId(ref.id)}`;
  const params = new URLSearchParams({ _vei: "1", _field: ref.path.split(".")[0] ?? ref.path });
  if (ref.path.includes(".")) params.set("_path", ref.path);
  return `${base}?${params.toString()}`;
}

export interface VeiEntryFrameProps {
  // Not named "ref" - Preact reserves that prop name for real DOM/component
  // refs on a function component (silently dropped, never reaches props)
  // unless the component is wrapped in `forwardRef`, which this isn't.
  target: PreviewVeiClickRef | null;
  /** Seeds this panel's own drag state - the docked panel is the same
   * footprint the code panel uses, so both modes start from the one width
   * `PageBuilder.tsx` persists. */
  initialWidth: number;
  onWidthChange: (width: number) => void;
  adminPath: string;
  contentTypes: ContentTypeDefinition[];
  onBrowse: () => void;
  onClose: () => void;
  onFieldInput: (detail: PreviewPatchDetail) => void;
  onFieldFocus: (detail: FieldFocusEventDetail) => void;
  onSaved: () => void;
}

/**
 * The entry/singleton editor iframe VEI mode opens on a marked-field click -
 * the same right-hand panel as the code editor. Listens for the SAME
 * `vei:*` bridge messages the deleted public-site overlay did
 * (`content-entry-editor/builder-bridge.ts`'s `startVeiBridge`, running
 * inside this iframe). Its empty state is also the entry point for browsing
 * every editable Collection/Singleton, so preview markers are a shortcut,
 * not a limit on which content Visual Editing can reach.
 */
export default function VeiEntryFrame(props: VeiEntryFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [browseType, setBrowseType] = useState<ContentTypeDefinition | null>(null);
  const { ref: browserScroll } = useOverlayScrollbars<HTMLDivElement>(
    [!props.target && !browseType],
    { overflow: { x: "hidden", y: "scroll" } },
  );
  // Same divider as `CodePanel`'s, on the same edge and within the same
  // bounds - pointer capture is what keeps the drag tracking once the cursor
  // crosses onto the preview iframe beside it (`useResizablePanel`'s own doc
  // comment), which is most of the drag here.
  const panel = useResizablePanel({
    ...BUILDER_PANEL_WIDTH,
    initial: clampBuilderPanelWidth(props.initialWidth),
    axis: "x",
    invert: true,
    onSizeChange: props.onWidthChange,
  });
  const readyRef = useRef(false);
  const currentUrlRef = useRef<string | null>(null);
  const desiredUrl = props.target
    ? editorUrl(props.adminPath, props.target)
    : browseType
      ? `${props.adminPath}/content/${browseType.name}?_vei=1`
      : null;
  const desiredUrlRef = useRef<string | null>(desiredUrl);
  desiredUrlRef.current = desiredUrl;

  useEffect(() => {
    if (props.target) setBrowseType(null);
  }, [props.target]);

  const groupedTypes = useMemo(() => ({
    collections: props.contentTypes.filter((type) => type.kind === "collection"),
    singletons: props.contentTypes.filter((type) => type.kind === "singleton"),
  }), [props.contentTypes]);

  function showBrowser(): void {
    setBrowseType(null);
    currentUrlRef.current = null;
    props.onBrowse();
  }

  // Keep the same iframe/document alive while the user moves between VEI
  // targets. The editor bridge performs an in-app navigation, matching the
  // public VEI overlay and avoiding a hard iframe reload (the visible jerk).
  useEffect(() => {
    const frame = iframeRef.current;
    if (!frame || !desiredUrl || desiredUrl === currentUrlRef.current) return;
    if (readyRef.current && frame.contentWindow) {
      frame.contentWindow.postMessage({ type: "vei:navigate", url: desiredUrl }, window.location.origin);
    } else {
      readyRef.current = false;
      frame.src = desiredUrl;
    }
    currentUrlRef.current = desiredUrl;
  }, [desiredUrl]);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin || event.source !== iframeRef.current?.contentWindow) return;
      const message = event.data as { type?: string; detail?: unknown; ok?: boolean } | null;
      if (message?.type === "vei:ready") {
        readyRef.current = true;
        const nextUrl = desiredUrlRef.current;
        if (nextUrl && nextUrl !== currentUrlRef.current && iframeRef.current?.contentWindow) {
          iframeRef.current.contentWindow.postMessage({ type: "vei:navigate", url: nextUrl }, window.location.origin);
          currentUrlRef.current = nextUrl;
        }
      } else if (message?.type === "vei:input" && message.detail) {
        props.onFieldInput(message.detail as PreviewPatchDetail);
      } else if (message?.type === "vei:focus" && message.detail) {
        props.onFieldFocus(message.detail as FieldFocusEventDetail);
      } else if (message?.type === "vei:saved" && message.ok === true) {
        props.onSaved();
      } else if (message?.type === "vei:back") {
        showBrowser();
      } else if (message?.type === "vei:close") {
        // Fired by `ContentEntryEditor.tsx`'s own Cancel button (via
        // `content-entry-editor/builder-bridge.ts`'s `closeVeiDialog`) - a real Save leaves
        // this dialog open so the admin can keep editing other fields; only
        // an explicit close (this, Escape, or the backdrop) dismisses it.
        props.onClose();
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [props.onFieldInput, props.onFieldFocus, props.onSaved, props.onClose, props.onBrowse]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") props.onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [props.onClose]);

  return (
    <div
      class="page-builder-vei-sheet docked"
      style={{ width: `${panel.size}px` }}
      onClick={(event) => { if (event.target === event.currentTarget) props.onClose(); }}
    >
      <div class="page-builder-vei-sheet-handle" {...panel.handleProps} />
      <div class="page-builder-vei-panel">
        <iframe
          ref={iframeRef}
          title="Edit content"
          aria-hidden={!desiredUrl}
          style={{ width: "100%", height: "100%", border: "0", display: desiredUrl ? "block" : "none" }}
        />
        {!desiredUrl && (
          <div class="page-builder-vei-browser"><div class="page-builder-vei-empty">
            <header class="page-builder-vei-browser-header">
              <div class="page-builder-vei-browser-heading">
                <span class="page-builder-vei-browser-icon"><EditIcon /></span>
                <span>
                  <strong>Select content in the preview</strong>
                  <small>Click a marked area in the preview, or select any content below.</small>
                </span>
              </div>
              <button type="button" class="outline" onClick={props.onClose}>Cancel</button>
            </header>
            <div ref={browserScroll} class="under page-builder-vei-type-scroll">
              <div class="page-builder-vei-type-groups">
                {groupedTypes.collections.length > 0 && <details open><summary><strong>Collection</strong></summary><div class="stack">{groupedTypes.collections.map((type) => <button type="button" class="outline page-builder-vei-type" key={type.id} onClick={() => setBrowseType(type)}><CollectionIcon /><span><strong>{type.label}</strong>{type.description && <small>{type.description}</small>}</span></button>)}</div></details>}
                {groupedTypes.singletons.length > 0 && <details open><summary><strong>Singleton</strong></summary><div class="stack">{groupedTypes.singletons.map((type) => <button type="button" class="outline page-builder-vei-type" key={type.id} onClick={() => setBrowseType(type)}><SingletonIcon /><span><strong>{type.label}</strong>{type.description && <small>{type.description}</small>}</span></button>)}</div></details>}
              </div>
            </div>
          </div></div>
        )}
      </div>
    </div>
  );
}
