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
 * Once the drag arms, the row is cloned into a `position: fixed` overlay
 * appended to `document.body`, with an explicit `top` computed once from
 * the row's pointerdown-time rect plus total pointer delta - deliberately
 * NOT a transform re-derived from the overlay's own `getBoundingClientRect()`
 * each tick, which is a self-referential feedback loop that produces visible
 * jitter. Being a clone appended to `body` (rather than the row itself going
 * `position: fixed`) also means reorders (which move the row to a new DOM
 * index) never disturb the overlay's on-screen position mid-drag. The real
 * row stays in normal flow, styled as a dashed "drop slot" placeholder -
 * so the list never collapses the gap shut and hides whatever row would
 * otherwise slide underneath it, and the placeholder doubles as the
 * "landing here" indicator as it moves with each reorder.
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
const DROP_DURATION_MS = 220;
/** Same spring-ish overshoot curve used for the toast pop-in (see
 * `.toast` in components.css) - reused here so drop settles read as part of
 * the same design language rather than inventing a new "nice" curve. */
const DROP_EASING = "cubic-bezier(0.34, 1.56, 0.64, 1)";

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

/** Animates every row (except `skipId`, the dragged row's own placeholder -
 * it should snap straight to its new slot, not ease into it) from its
 * captured "before" top to wherever it now sits, via an inverted transform
 * eased back to none - the FLIP technique. */
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
    /** The floating clone tracking the pointer, created on arm. */
    overlay: HTMLElement | null;
  } | null>(null);

  const endDrag = () => {
    const state = dragState.current;
    const container = containerRef.current;
    dragState.current = null;
    setDraggingId(null);
    if (!state || !container) return;
    const row = rowsIn(container).get(state.id);

    if (!state.armed || !row) {
      // Never crossed the activation distance - nothing was ever detached
      // from flow (no overlay was created), so there's nothing to settle.
      state.overlay?.remove();
      return;
    }

    row.classList.remove("dnd-drag-placeholder");

    // Drop settle: rather than snapping the row straight into its resting
    // slot, invert from the overlay's last position into a transform (FLIP,
    // as in `playFlip` above) applied to the row, and ease it - and the
    // lifted card look - back to normal over one frame. The overlay itself
    // is removed synchronously in the same tick the transform is applied,
    // so the handoff paints as one continuous element, never both at once.
    const overlayRect = state.overlay?.getBoundingClientRect();
    state.overlay?.remove();
    if (!overlayRect) return;
    const restRect = row.getBoundingClientRect();
    const deltaX = overlayRect.left - restRect.left;
    const deltaY = overlayRect.top - restRect.top;

    row.style.transition = "none";
    row.style.transform = `translate(${deltaX}px, ${deltaY}px)`;
    row.style.backgroundColor = "var(--dry-card)";
    row.style.boxShadow = "var(--dry-shadow-lg)";
    requestAnimationFrame(() => {
      row.style.transition = `transform ${DROP_DURATION_MS}ms ${DROP_EASING}, background-color ${DROP_DURATION_MS}ms ease, box-shadow ${DROP_DURATION_MS}ms ease`;
      row.style.transform = "";
      row.style.backgroundColor = "";
      row.style.boxShadow = "";
      setTimeout(() => {
        row.style.transition = "";
      }, DROP_DURATION_MS);
    });
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
        // Clone the row into a floating overlay that tracks the pointer,
        // rather than taking the row itself out of flow - that would
        // collapse its slot immediately, snapping whatever's below up into
        // the gap before any reorder was actually earned by crossing a
        // swap threshold.
        const overlay = row.cloneNode(true) as HTMLElement;
        overlay.removeAttribute("data-sortable-id");
        overlay.classList.add("dnd-dragging");
        overlay.style.position = "fixed";
        overlay.style.top = `${state.startRect.top}px`;
        overlay.style.left = `${state.startRect.left}px`;
        overlay.style.width = `${state.startRect.width}px`;
        overlay.style.margin = "0";
        overlay.style.zIndex = "50";
        // A cloned `<li>` row loses its `<ul>` parent's `list-style: none`
        // the moment it's appended to `body` instead - `list-style` is
        // inherited, and the clone's new parent doesn't carry it, so the
        // browser's default disc/decimal marker reappears just outside the
        // row's left edge. Harmless (and a no-op) for any other tag.
        overlay.style.listStyle = "none";
        // Appended to the nearest open `<dialog>` (if the list being
        // reordered lives inside one), not always `document.body` - a
        // `<dialog>` is promoted to the top layer, which paints above
        // regular `body` content regardless of z-index, so a plain
        // `body`-level overlay dragged inside an open dialog would render
        // *underneath* that same dialog. Appending inside it instead makes
        // the clone part of the dialog's own top-layer subtree.
        (container.closest("dialog[open]") ?? document.body).appendChild(overlay);
        state.overlay = overlay;

        // The row itself stays in flow, restyled as the "drop slot" - it
        // keeps the list's height stable and, as reorders move it through
        // the DOM, shows exactly where the item would land.
        row.classList.add("dnd-drag-placeholder");
      }
    }

    if (!state.overlay) return;
    const draggedTop = state.startRect.top + deltaY;
    state.overlay.style.top = `${draggedTop}px`;

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
            overlay: null,
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
