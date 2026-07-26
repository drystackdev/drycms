import { useMemo, useRef, useState } from "preact/hooks";

/**
 * Single-list pointer-based drag reorder, with a FLIP-style reorder
 * animation on drop. The nearest-swap-point detection and the FLIP
 * (First/Last/Invert/Play) position-capture/animate technique are adapted
 * from SortableJS (https://github.com/SortableJS/Sortable, MIT License) -
 * see its `src/Sortable.js` (`_onDragOver`'s nearest-target swap logic) and
 * `src/Animation.js` (`captureAnimationState`/`animate`). This is a
 * from-scratch, minimal Preact/TS reimplementation covering only a single
 * vertical list with a drag handle, driven by Pointer Events (no separate
 * mouse/touch code paths); no groups, multi-drag, swap plugin, or
 * autoscroll (all out of scope here).
 *
 * The dragged row is switched to `position: fixed` with an explicit `top`
 * computed once from its pointerdown-time rect plus total pointer delta -
 * deliberately NOT a transform re-derived from the row's own (possibly
 * already-transformed) `getBoundingClientRect()` each tick, which is a
 * self-referential feedback loop that produces visible jitter. Fixed
 * positioning also means reorders (which move the row to a new DOM index)
 * never disturb its on-screen position mid-drag.
 *
 * Contract: every row rendered by the caller must carry
 * `data-sortable-id={getId(item)}` as a direct child of the element holding
 * `containerProps`, so the hook can locate/measure rows by querying the
 * container rather than requiring a ref per row.
 */

export interface UseSortableListOptions<T> {
  items: T[];
  getId: (item: T) => string;
  onReorder: (nextItems: T[]) => void;
  /** Minimum pointer movement (px) before a drag starts. @default 4 */
  activationDistance?: number;
  disabled?: boolean;
}

export interface SortableHandleProps {
  ref: (el: HTMLElement | null) => void;
  onPointerDown: (event: PointerEvent) => void;
  "aria-label": string;
}

export interface UseSortableListResult {
  /** Spread onto the list container (the element whose direct children are
   * the `data-sortable-id`-tagged rows). */
  containerProps: { ref: (el: HTMLElement | null) => void };
  /** Spread onto each row's drag-handle element, keyed by item id - NOT onto
   * the whole row, so a row's own click-to-edit behavior is unaffected. */
  getHandleProps: (id: string) => SortableHandleProps;
  /** The id of the item currently mid-drag, if any. */
  draggingId: string | null;
}

const FLIP_DURATION_MS = 180;

function rowsIn(container: HTMLElement): Map<string, HTMLElement> {
  const rows = new Map<string, HTMLElement>();
  for (const el of Array.from(container.children)) {
    const id = (el as HTMLElement).dataset.sortableId;
    if (id) rows.set(id, el as HTMLElement);
  }
  return rows;
}

/** Captures every row's current top offset, keyed by id - the FLIP "before"
 * snapshot, taken right before a reorder is committed. */
function captureTops(container: HTMLElement, skipId: string): Map<string, number> {
  const tops = new Map<string, number>();
  for (const [id, el] of rowsIn(container)) {
    if (id === skipId) continue;
    tops.set(id, el.getBoundingClientRect().top);
  }
  return tops;
}

/** Animates every row (except `skipId`, the fixed-position dragged row)
 * from its captured "before" top to wherever it now sits, via an inverted
 * transform eased back to none - the FLIP technique. */
function playFlip(container: HTMLElement, before: Map<string, number>, skipId: string) {
  for (const [id, el] of rowsIn(container)) {
    if (id === skipId) continue;
    const beforeTop = before.get(id);
    if (beforeTop === undefined) continue;
    const afterTop = el.getBoundingClientRect().top;
    const delta = beforeTop - afterTop;
    if (!delta) continue;
    el.style.transition = "none";
    el.style.transform = `translateY(${delta}px)`;
    requestAnimationFrame(() => {
      el.style.transition = `transform ${FLIP_DURATION_MS}ms ease`;
      el.style.transform = "";
      setTimeout(() => {
        el.style.transition = "";
      }, FLIP_DURATION_MS);
    });
  }
}

export function useSortableList<T>(options: UseSortableListOptions<T>): UseSortableListResult {
  const { activationDistance = 4, disabled = false } = options;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const containerRef = useRef<HTMLElement | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  const dragState = useRef<{
    id: string;
    startY: number;
    /** The row's rect at pointerdown time - captured once, never re-read
     * from the (once dragging starts) transformed/fixed-positioned element. */
    startRect: DOMRect;
    armed: boolean;
  } | null>(null);

  const endDrag = () => {
    const state = dragState.current;
    const container = containerRef.current;
    dragState.current = null;
    setDraggingId(null);
    if (!state || !container) return;
    const row = rowsIn(container).get(state.id);
    if (row) {
      row.style.position = "";
      row.style.top = "";
      row.style.left = "";
      row.style.width = "";
      row.classList.remove("dnd-dragging");
    }
  };

  const onPointerMove = (event: PointerEvent) => {
    const state = dragState.current;
    const container = containerRef.current;
    if (!state || !container) return;
    const deltaY = event.clientY - state.startY;

    if (!state.armed) {
      if (Math.abs(deltaY) < activationDistance) return;
      state.armed = true;
      setDraggingId(state.id);
      const row = rowsIn(container).get(state.id);
      if (row) {
        row.classList.add("dnd-dragging");
        row.style.position = "fixed";
        row.style.left = `${state.startRect.left}px`;
        row.style.width = `${state.startRect.width}px`;
      }
    }

    const row = rowsIn(container).get(state.id);
    if (!row) return;
    const draggedTop = state.startRect.top + deltaY;
    row.style.top = `${draggedTop}px`;

    const { items, getId, onReorder } = optionsRef.current;
    const draggedCenter = draggedTop + state.startRect.height / 2;
    const fromIndex = items.findIndex((item) => getId(item) === state.id);
    if (fromIndex === -1) return;

    let toIndex = fromIndex;
    const rows = rowsIn(container);
    items.forEach((item, index) => {
      if (index === fromIndex) return;
      const sibling = rows.get(getId(item));
      if (!sibling) return;
      const rect = sibling.getBoundingClientRect();
      const siblingCenter = rect.top + rect.height / 2;
      const crossed = index < fromIndex ? draggedCenter < siblingCenter : draggedCenter > siblingCenter;
      if (crossed) toIndex = index;
    });

    if (toIndex !== fromIndex) {
      const before = captureTops(container, state.id);
      const next = items.slice();
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved!);
      onReorder(next);
      requestAnimationFrame(() => requestAnimationFrame(() => playFlip(container, before, state.id)));
    }
  };

  const onPointerUp = () => {
    document.removeEventListener("pointermove", stableMoveHandler.current);
    document.removeEventListener("pointerup", stableUpHandler.current);
    document.removeEventListener("pointercancel", stableUpHandler.current);
    endDrag();
  };

  // Stable refs so document listeners (attached per-drag, not per-render)
  // always call the latest closures without needing to be re-attached, and
  // so `removeEventListener` gets back the exact function it was given.
  const onPointerMoveRef = useRef(onPointerMove);
  onPointerMoveRef.current = onPointerMove;
  const onPointerUpRef = useRef(onPointerUp);
  onPointerUpRef.current = onPointerUp;
  const stableMoveHandler = useRef((event: PointerEvent) => onPointerMoveRef.current(event));
  const stableUpHandler = useRef(() => onPointerUpRef.current());

  return useMemo<UseSortableListResult>(
    () => ({
      containerProps: {
        ref: (el) => {
          containerRef.current = el;
        },
      },
      getHandleProps: (id) => ({
        // `touch-action: none` stops touch scrolling from hijacking the
        // gesture before `activationDistance` is reached.
        ref: (el) => {
          if (el) el.style.touchAction = "none";
        },
        "aria-label": "Reorder",
        onPointerDown: (event: PointerEvent) => {
          if (disabled) return;
          const container = containerRef.current;
          if (!container) return;
          const row = rowsIn(container).get(id);
          if (!row) return;
          dragState.current = {
            id,
            startY: event.clientY,
            startRect: row.getBoundingClientRect(),
            armed: false,
          };
          document.addEventListener("pointermove", stableMoveHandler.current);
          document.addEventListener("pointerup", stableUpHandler.current);
          document.addEventListener("pointercancel", stableUpHandler.current);
        },
      }),
      draggingId,
    }),
    [disabled, draggingId],
  );
}
