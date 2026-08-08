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

export interface UseScaledPreviewResult<K extends string> {
  key: K;
  widthOverride: number | null;
  width: number;
  scale: number;
  viewportRef: RefObject<HTMLDivElement>;
  select: (next: K) => void;
  widen: () => void;
  narrow: () => void;
  reset: () => void;
}

/** Width-table-agnostic core of `useDevicePreview` below - split out so
 * `PageEditor.tsx`'s own viewport preview (5 presets - xs/sm/md/lg/xl - not
 * this module's 3-device set, and no reason the two features should share a
 * literal key type) can reuse the exact same "zoom to fit" mechanism without
 * this module needing to know Component Builder's own preset names, or
 * `PageEditor.tsx` needing to duplicate the `ResizeObserver` plumbing.
 * `zoom` (not `transform: scale`, applied by the caller using `scale`) does
 * the shrink-to-fit - it reflows layout at the scaled size, so the
 * viewport's own height tracks the *scaled* content height with no leftover
 * whitespace `transform: scale` would leave behind. */
export function useScaledPreview<K extends string>(widths: Record<K, number>, initialKey: K): UseScaledPreviewResult<K> {
  const [key, setKey] = useState<K>(initialKey);
  const [widthOverride, setWidthOverride] = useState<number | null>(null);
  const [scale, setScale] = useState(1);
  const viewportRef = useRef<HTMLDivElement>(null);
  const width = widthOverride ?? widths[key];

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
    key,
    widthOverride,
    width,
    scale,
    viewportRef,
    select: (next) => {
      setKey(next);
      setWidthOverride(null);
    },
    widen: () => setWidthOverride(width + WIDTH_STEP),
    narrow: () => setWidthOverride(Math.max(MIN_WIDTH, width - WIDTH_STEP)),
    reset: () => setWidthOverride(null),
  };
}

/** Device-width state + auto-scale-to-fit, split out from the rendering
 * (`ComponentPreview.tsx`) so the picker controls can live in the page's
 * top toolbar while the frame itself renders in the preview panel below -
 * two different DOM locations sharing one state. */
export function useDevicePreview(): UseDevicePreviewResult {
  const scaled = useScaledPreview<Device>(DEVICE_WIDTHS, "desktop");
  return {
    device: scaled.key,
    widthOverride: scaled.widthOverride,
    width: scaled.width,
    scale: scaled.scale,
    viewportRef: scaled.viewportRef,
    selectDevice: scaled.select,
    widen: scaled.widen,
    narrow: scaled.narrow,
    reset: scaled.reset,
  };
}
