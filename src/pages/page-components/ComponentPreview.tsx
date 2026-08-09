import type { ComponentType } from "preact";
import type { UseDevicePreviewResult } from "./useDevicePreview.js";
import { useOverlayScrollbars } from "../../hooks/overlayscrollbars.js";
import { mergeRefs } from "../../lib/merge-refs.js";

interface Props {
  Component: ComponentType<any> | null;
  error: string | null;
  preview: UseDevicePreviewResult;
}

/** Just the auto-scaled frame - the device/width picker itself is
 * `DevicePickerControls.tsx`, rendered in the page's toolbar (see
 * `useDevicePreview.ts` for why the state is split out). */
export default function ComponentPreview({ Component, error, preview }: Props) {
  // 2 independent refs on the host: `preview.viewportRef` (auto-fit width
  // measurement) and `scroll.ref` (hands overflow to the app's standard
  // scroll library - the `scroll` class was already here but had nothing
  // real driving it, so this panel was always on plain native scroll).
  const scroll = useOverlayScrollbars<HTMLDivElement>();
  return (
    <div class="page-components-preview-viewport scroll" ref={mergeRefs(preview.viewportRef, scroll.ref)}>
      <div class="page-components-preview-viewport-inner" ref={scroll.viewportRef}>
        {error ? (
          <div class="alert destructive">{error}</div>
        ) : Component ? (
          <div class="page-components-preview-frame" style={{ width: `${preview.width}px`, zoom: preview.scale }}>
            <Component />
          </div>
        ) : (
          <p class="hint">Select or create a component to preview it.</p>
        )}
      </div>
    </div>
  );
}
