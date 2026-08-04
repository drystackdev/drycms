import { useCallback, useRef, useState } from "preact/hooks";

export interface UseResizablePanelOptions {
  initial: number;
  min: number;
  max: number;
  /** Which pointer coordinate drives the size - `"x"` for a vertical divider
   * (dragging left/right resizes a width), `"y"` for a horizontal one
   * (dragging up/down resizes a height). */
  axis: "x" | "y";
}

export interface UseResizablePanelResult {
  size: number;
  /** Spread onto the divider element between the two panels. */
  handleProps: { onPointerDown: (event: PointerEvent) => void };
  dragging: boolean;
}

/**
 * A single draggable divider driving one CSS size (width or height) between
 * `min`/`max` - the VS Code-style "drag the panel border to resize"
 * interaction. Deliberately much simpler than `dnd/useSortableList.ts`
 * (no reorder, no FLIP animation, no overlay clone): the divider itself
 * never moves during a drag, only the number driving the panel's own
 * `style.width`/`height` does.
 */
export function useResizablePanel({ initial, min, max, axis }: UseResizablePanelOptions): UseResizablePanelResult {
  const [size, setSize] = useState(initial);
  const [dragging, setDragging] = useState(false);
  const dragState = useRef<{ startPos: number; startSize: number } | null>(null);

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
      const state = dragState.current;
      if (!state) return;
      const pos = axis === "x" ? event.clientX : event.clientY;
      setSize(Math.min(max, Math.max(min, state.startSize + (pos - state.startPos))));
    },
    [axis, min, max],
  );

  const onPointerUp = useCallback(() => {
    dragState.current = null;
    setDragging(false);
    document.removeEventListener("pointermove", onPointerMove);
    document.removeEventListener("pointerup", onPointerUp);
  }, [onPointerMove]);

  const onPointerDown = useCallback(
    (event: PointerEvent) => {
      event.preventDefault();
      dragState.current = { startPos: axis === "x" ? event.clientX : event.clientY, startSize: size };
      setDragging(true);
      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerup", onPointerUp, { once: true });
    },
    [axis, size, onPointerMove, onPointerUp],
  );

  return { size, handleProps: { onPointerDown }, dragging };
}
