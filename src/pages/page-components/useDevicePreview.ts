import { useEffect, useRef, useState } from "preact/hooks";
import type { RefObject } from "preact";

export type Device = "mobile" | "tablet" | "desktop";

/** Tailwind's `sm`/`md`/`xl` breakpoints, standing in for mobile/tablet/
 * desktop widths (see `plans/component-builder.md`). */
const DEVICE_WIDTHS: Record<Device, number> = { mobile: 375, tablet: 768, desktop: 1280 };
export const DEVICE_LABELS: Record<Device, string> = { mobile: "Mobile", tablet: "Tablet", desktop: "Desktop" };
export const DEVICES: Device[] = ["mobile", "tablet", "desktop"];
const MIN_WIDTH = 240;
const WIDTH_STEP = 20;

export interface UseDevicePreviewResult {
  device: Device;
  widthOverride: number | null;
  width: number;
  scale: number;
  viewportRef: RefObject<HTMLDivElement>;
  selectDevice: (next: Device) => void;
  widen: () => void;
  narrow: () => void;
  reset: () => void;
}

/** Device-width state + auto-scale-to-fit, split out from the rendering
 * (`ComponentPreview.tsx`) so the picker controls can live in the page's
 * top toolbar while the frame itself renders in the preview panel below -
 * two different DOM locations sharing one state. `zoom` (not `transform:
 * scale`, applied by the caller using `scale`) does the shrink-to-fit - it
 * reflows layout at the scaled size, so the viewport's own height tracks
 * the *scaled* content height with no leftover whitespace `transform:
 * scale` would leave behind. */
export function useDevicePreview(): UseDevicePreviewResult {
  const [device, setDevice] = useState<Device>("desktop");
  const [widthOverride, setWidthOverride] = useState<number | null>(null);
  const [scale, setScale] = useState(1);
  const viewportRef = useRef<HTMLDivElement>(null);
  const width = widthOverride ?? DEVICE_WIDTHS[device];

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const recompute = () => {
      const available = viewport.clientWidth - 32; // minus the viewport's own 1rem+1rem padding
      setScale(available > 0 && width > available ? available / width : 1);
    };
    recompute();
    const observer = new ResizeObserver(recompute);
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [width]);

  return {
    device,
    widthOverride,
    width,
    scale,
    viewportRef,
    selectDevice: (next) => {
      setDevice(next);
      setWidthOverride(null);
    },
    widen: () => setWidthOverride(width + WIDTH_STEP),
    narrow: () => setWidthOverride(Math.max(MIN_WIDTH, width - WIDTH_STEP)),
    reset: () => setWidthOverride(null),
  };
}
