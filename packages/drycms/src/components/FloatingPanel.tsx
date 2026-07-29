import { useEffect, useRef, useState } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { useTrackRect } from "./list-nav.js";

export interface FloatingPanelProps {
  /** Element the panel follows - its position *and* size (via `ResizeObserver`)
   * drive where the panel appears, re-measured on every scroll/resize too.
   * Pass `null` to hide the panel; swap in a different element (or the same
   * one after it moved) to reposition. Unlike Popover.tsx's trigger+menu
   * pair, visibility isn't this component's own state - the caller derives
   * it from whatever it's tracking (an editor selection, a hovered row, a
   * canvas annotation, ...) and passes the anchor through. */
  anchor: HTMLElement | null;
  children: ComponentChildren;
  /** Gap between the anchor and the panel, in px. @default 6 */
  gap?: number;
  /** Estimated panel height used only to decide flip direction before the
   * panel has ever been measured (its real height isn't known until after
   * first paint). @default 220 */
  estimatedHeight?: number;
  class?: string;
}

/**
 * A panel that stays anchored to an arbitrary DOM element as it moves,
 * resizes, or scrolls - e.g. a floating toolbar that follows the currently
 * selected node in a rich-text editor (see RichTextField), but generic:
 * nothing here is ProseMirror-specific, so it's just as usable anchored to a
 * hovered table row, a canvas annotation, or any other element the caller
 * already has a handle to.
 *
 * Rendered via the Popover API (`popover="manual"`), same top-layer/
 * above-dialog reasoning as Popover.tsx's own menu - but shown/hidden
 * imperatively from `anchor` rather than relying on native light-dismiss,
 * since visibility here is derived from external state instead of a click
 * toggle (see Toast.tsx for the other `popover="manual"` precedent).
 */
export default function FloatingPanel({
  anchor,
  children,
  gap = 6,
  estimatedHeight = 220,
  class: className,
}: FloatingPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
    openUp: boolean;
  } | null>(null);

  // Unlike Popover.tsx's trigger+menu (which used to lock background scroll
  // while open so its one-shot position never went stale, before it also
  // moved to this same tracker), this panel was never scroll-locked in the
  // first place, so it has always needed to keep re-measuring instead.
  useTrackRect(!!anchor, anchor, () => {
    if (!anchor) return;
    const box = anchor.getBoundingClientRect();
    const spaceBelow = window.innerHeight - box.bottom;
    const spaceAbove = box.top;
    const openUp = spaceBelow < estimatedHeight && spaceAbove > spaceBelow;
    setPosition({
      left: box.left,
      top: openUp ? box.top - gap : box.bottom + gap,
      openUp,
    });
  });

  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    if (anchor) el.showPopover?.();
    else el.hidePopover?.();
  }, [anchor]);

  return (
    <div
      ref={panelRef}
      popover="manual"
      class={["floating-panel", className].filter(Boolean).join(" ")}
      style={
        position
          ? {
              position: "fixed",
              left: `${position.left}px`,
              top: `${position.top}px`,
              transform: position.openUp ? "translateY(-100%)" : undefined,
            }
          : undefined
      }
    >
      {anchor ? children : null}
    </div>
  );
}
