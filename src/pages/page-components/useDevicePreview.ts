import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { RefCallback } from "preact";

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
  viewportRef: RefCallback<HTMLDivElement>;
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
  viewportRef: RefCallback<HTMLDivElement>;
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
 * whitespace `transform: scale` would leave behind.
 *
 * `viewportRef` is a callback ref, not a plain object ref - the viewport div
 * isn't always mounted (`PageEditor.tsx` swaps it out for an error message,
 * or for a "select a file" hint, while keeping this hook alive across the
 * swap), and a plain ref's `.current` reassignment is invisible to
 * `useEffect`'s dependency array, so a remount left the `ResizeObserver`
 * watching the old, now-detached node forever - found live as "scale stops
 * updating after an error, then recovery, cycle". A callback ref fires on
 * every attach/detach, so the observer always tracks whichever DOM node is
 * *currently* there. */
export function useScaledPreview<K extends string>(widths: Record<K, number>, initialKey: K): UseScaledPreviewResult<K> {
  const [key, setKey] = useState<K>(initialKey);
  const [widthOverride, setWidthOverride] = useState<number | null>(null);
  const [scale, setScale] = useState(1);
  const width = widthOverride ?? widths[key];

  const elementRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const widthRef = useRef(width);
  widthRef.current = width;

  const recompute = useCallback(() => {
    const viewport = elementRef.current;
    if (!viewport) return;
    const available = viewport.clientWidth;
    setScale(available > 0 && widthRef.current > available ? available / widthRef.current : 1);
  }, []);

  // Re-derives scale whenever `width` changes against whichever element is
  // currently attached (a no-op via `recompute`'s own guard if none is).
  useEffect(() => {
    recompute();
  }, [width, recompute]);

  const viewportRef = useCallback<RefCallback<HTMLDivElement>>(
    (node) => {
      observerRef.current?.disconnect();
      observerRef.current = null;
      elementRef.current = node;
      if (!node) return;
      recompute();
      const observer = new ResizeObserver(recompute);
      observer.observe(node);
      observerRef.current = observer;
    },
    [recompute],
  );

  useEffect(() => () => observerRef.current?.disconnect(), []);

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
