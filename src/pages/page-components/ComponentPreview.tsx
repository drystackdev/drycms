import type { ComponentType } from "preact";
import type { UseDevicePreviewResult } from "./useDevicePreview.js";

interface Props {
  Component: ComponentType<any> | null;
  error: string | null;
  preview: UseDevicePreviewResult;
}

/** Just the auto-scaled frame - the device/width picker itself is
 * `DevicePickerControls.tsx`, rendered in the page's toolbar (see
 * `useDevicePreview.ts` for why the state is split out). */
export default function ComponentPreview({ Component, error, preview }: Props) {
  return (
    <div class="page-components-preview-viewport scroll" ref={preview.viewportRef}>
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
  );
}
