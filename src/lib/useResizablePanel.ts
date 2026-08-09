import { useCallback, useRef, useState } from "preact/hooks";

export interface UseResizablePanelOptions {
  initial: number;
  min: number;
  max: number;
  /** Which pointer coordinate drives the size - `"x"` for a vertical divider
   * (dragging left/right resizes a width), `"y"` for a horizontal one
   * (dragging up/down resizes a height). */
  axis: "x" | "y";
  /** Flips the drag direction - default assumes the resizable panel sits
   * BEFORE the handle in DOM/visual order (dragging toward positive x/y
   * grows it, e.g. a left sidebar or a left-hand preview column). Set this
   * when the panel instead sits AFTER the handle (e.g. a bottom panel whose
   * handle is above it) - there, dragging toward positive x/y shrinks the
   * space left for the panel, so the size delta must be negated to match. */
  invert?: boolean;
}

export interface UseResizablePanelResult {
  size: number;
  /** Spread onto the divider element between the two panels. */
  handleProps: {
    onPointerDown: (event: PointerEvent) => void;
    onPointerMove: (event: PointerEvent) => void;
    onPointerUp: (event: PointerEvent) => void;
    onPointerCancel: (event: PointerEvent) => void;
  };
  dragging: boolean;
}

/**
 * A single draggable divider driving one CSS size (width or height) between
 * `min`/`max` - the VS Code-style "drag the panel border to resize"
 * interaction. Deliberately much simpler than `dnd/useSortableList.ts`
 * (no reorder, no FLIP animation, no overlay clone): the divider itself
 * never moves during a drag, only the number driving the panel's own
 * `style.width`/`height` does.
 *
 * Tracks the drag via `setPointerCapture` on the handle itself, not a
 * `document`-level `pointermove` listener (the original approach here) -
 * found live (`PageEditor.tsx`'s preview panel, flanked by a real
 * `<iframe>`): a fast drag routinely overshoots the handle's own 4px hit
 * area, and once the cursor lands over the iframe, its pointer events fire
 * inside THAT document instead of bubbling to the parent's `document`
 * listener at all - the drag would just silently stop tracking. Capture
 * (the same fix `overlay.ts`'s own `panelResizeHandle` already uses for an
 * identical drag) redirects every subsequent event for this pointer straight
 * to the handle regardless of what's actually underneath it, iframe
 * included, so the listeners can live as plain props on the handle itself
 * instead of a manually added/removed `document` pair.
 */
export function useResizablePanel({ initial, min, max, axis, invert = false }: UseResizablePanelOptions): UseResizablePanelResult {
  const [size, setSize] = useState(initial);
  const [dragging, setDragging] = useState(false);
  const dragState = useRef<{ startPos: number; startSize: number } | null>(null);

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      const state = dragState.current;
      if (!state) return;
      const pos = axis === "x" ? event.clientX : event.clientY;
      const delta = invert ? state.startPos - pos : pos - state.startPos;
      setSize(Math.min(max, Math.max(min, state.startSize + delta)));
    },
    [axis, min, max, invert],
  );

  const endDrag = useCallback((event: PointerEvent) => {
    if (!dragState.current) return;
    dragState.current = null;
    setDragging(false);
    const handle = event.currentTarget as Element;
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
  }, []);

  const onPointerDown = useCallback(
    (event: PointerEvent) => {
      event.preventDefault();
      dragState.current = { startPos: axis === "x" ? event.clientX : event.clientY, startSize: size };
      setDragging(true);
      (event.currentTarget as Element).setPointerCapture(event.pointerId);
    },
    [axis, size],
  );

  return {
    size,
    handleProps: { onPointerDown, onPointerMove, onPointerUp: endDrag, onPointerCancel: endDrag },
    dragging,
  };
}
