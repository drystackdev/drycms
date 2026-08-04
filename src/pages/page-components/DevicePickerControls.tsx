import { DEVICE_LABELS, DEVICES, type UseDevicePreviewResult } from "./useDevicePreview.js";

interface Props {
  preview: UseDevicePreviewResult;
}

/** The Mobile/Tablet/Desktop segmented picker + width stepper - lives in
 * the page's top toolbar, next to the sidebar toggle, not inside the
 * preview panel itself. */
export default function DevicePickerControls({ preview }: Props) {
  return (
    <div class="row">
      <div class="button-group">
        {DEVICES.map((candidate) => (
          <button
            key={candidate}
            type="button"
            class="sm"
            aria-pressed={preview.device === candidate && preview.widthOverride === null}
            onClick={() => preview.selectDevice(candidate)}
          >
            {DEVICE_LABELS[candidate]}
          </button>
        ))}
      </div>
      <button type="button" class="ghost icon sm" aria-label="Narrower" onClick={preview.narrow}>
        −
      </button>
      <span class="hint">{preview.width}px</span>
      <button type="button" class="ghost icon sm" aria-label="Wider" onClick={preview.widen}>
        +
      </button>
      <button type="button" class="sm outline" disabled={preview.widthOverride === null} onClick={preview.reset}>
        Reset
      </button>
    </div>
  );
}
