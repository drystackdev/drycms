import { useEffect, useRef } from "preact/hooks";
import { encodeEntryId } from "../../../lib/id-hash.js";
import type { PreviewVeiClickRef } from "../../../page-components/page-preview-engine.js";
import type { PreviewPatchDetail } from "../../../page-components/vei-preview-patch.js";

/** Same admin route `apps/vei/overlay.ts`'s own `editorUrl` builds - the
 * ordinary entry editor, `?_field=`/`?_path=` aimed at the clicked field,
 * `?_vei=1` so `pages/vei/bridge.ts`'s `isVeiFrame()` recognizes it and
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
  target: PreviewVeiClickRef;
  panelWidth: number;
  adminPath: string;
  onClose: () => void;
  onFieldInput: (detail: PreviewPatchDetail) => void;
  onSaved: () => void;
}

/**
 * The entry/singleton editor iframe VEI mode opens on a marked-field click -
 * the same right-hand panel as the code editor. Listens for the SAME
 * `vei:*` bridge messages `apps/vei/overlay.ts` does (`pages/vei/bridge.ts`'s
 * `startVeiBridge`, running inside this iframe), just without that file's
 * own hover-highlight/cross-tab-draft-sync/drag-resize polish - "không
 * giống 100% chỉ tương đồng một vài chức năng" (mục 3).
 */
export default function VeiEntryFrame(props: VeiEntryFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const url = editorUrl(props.adminPath, props.target);

  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin || event.source !== iframeRef.current?.contentWindow) return;
      const message = event.data as { type?: string; detail?: unknown; ok?: boolean } | null;
      if (message?.type === "vei:input" && message.detail) {
        props.onFieldInput(message.detail as PreviewPatchDetail);
      } else if (message?.type === "vei:saved" && message.ok === true) {
        props.onSaved();
      } else if (message?.type === "vei:close") {
        // Fired by `ContentEntryEditor.tsx`'s own Cancel button (via
        // `pages/vei/bridge.ts`'s `closeVeiDialog`) - a real Save leaves
        // this dialog open so the admin can keep editing other fields; only
        // an explicit close (this, Escape, or the backdrop) dismisses it.
        props.onClose();
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [props.onFieldInput, props.onSaved, props.onClose]);

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
      style={{ width: `${props.panelWidth}px` }}
      onClick={(event) => { if (event.target === event.currentTarget) props.onClose(); }}
    >
      <div class="page-builder-vei-panel">
        <iframe ref={iframeRef} src={url} title="Edit content" style={{ width: "100%", height: "100%", border: "0" }} />
      </div>
    </div>
  );
}
