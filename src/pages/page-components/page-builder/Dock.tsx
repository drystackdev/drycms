import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";
import { CloseIcon, DashboardIcon } from "../../../components/icons/index.js";

/**
 * Page Builder's floating bottom-left dock. Started life as
 * `apps/vei/Dock.tsx`'s `EditingDock`, shared with the public site's VEI
 * overlay; that overlay is gone (the public site now only deep-links into
 * this page - `apps/edit-launcher.ts`), so the component moved here and lost
 * everything only the overlay ever used: the `EditButtonDock` collapsed
 * state, the dialog/panel `ModeToggle`, "Preview all" + its draft count, and
 * the imperative `EditingDockHandle` (`setStatus`/`setSaving`) an
 * outside-Preact save loop drove. Page Builder owns all of that state itself
 * (`SavePreviewDialog.tsx`'s staged progress), so a plain props-in component
 * is the whole contract now.
 *
 * Its CSS lives in `src/styles/components.css` (`.dock`, `.round`,
 * `.dock-save`, `.vei-spinner`), NOT in a shadow-root stylesheet - that was
 * the overlay's constraint, never this page's.
 */
export interface DockProps {
  /** Rendered first, left of Dashboard - the file menu / VEI / code toggles
   * `Toolbar.tsx` owns. */
  extraActions?: ComponentChildren;
  onDashboard: () => void;
  /** Leaves Page Builder for the public page currently being previewed. */
  onExit: () => void;
  onSave: () => void;
  saveDisabled?: boolean;
  saveIcon: ComponentChildren;
  saveCount?: number;
}

/**
 * Animates `.dock`'s width across a content change - CSS `transition: width`
 * alone can't do this, because a `transition` on `width` never animates
 * to/from "auto" (the dock's resting state, sized by its content). This
 * measures a real pixel width before and after whatever `deps` change just
 * did to the DOM, and lets the `.dock` CSS transition interpolate between
 * them.
 *
 * The "after" width is measured with the explicit width released back to
 * "auto" rather than read off `scrollWidth` - `scrollWidth` on an element
 * still pinned to the OLD width can only ever report a value >= that, so it
 * can grow a mutation that adds content but can't shrink one that removes it
 * (e.g. the save badge disappearing entirely). "auto" always yields the true
 * content-fit size in either direction.
 */
function useDockWidthAnimation(deps: readonly unknown[]) {
  const ref = useRef<HTMLDivElement>(null);
  const widthRef = useRef<number | null>(null);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Nothing to animate a mount FROM - just record the resting size this
    // render settled on, for the next change to measure against.
    if (!mounted.current) {
      mounted.current = true;
      widthRef.current = el.getBoundingClientRect().width;
      return;
    }
    const before = widthRef.current ?? el.getBoundingClientRect().width;
    el.style.width = "auto";
    const after = el.getBoundingClientRect().width;
    el.style.width = `${before}px`;
    requestAnimationFrame(() => {
      el.style.width = `${after}px`;
    });
    widthRef.current = after;
    // Release the explicit px back to "auto" once the transition finishes,
    // so the dock's resting state stays content-fit (not pinned to whatever
    // pixel width the last animation landed on).
    const handleTransitionEnd = (event: TransitionEvent) => {
      if (event.propertyName === "width") el.style.width = "auto";
    };
    el.addEventListener("transitionend", handleTransitionEnd);
    return () => el.removeEventListener("transitionend", handleTransitionEnd);
    // `deps` drives WHEN this runs; the body itself only ever reads the DOM.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

export default function Dock(props: DockProps) {
  const ref = useDockWidthAnimation([props.saveCount, props.saveDisabled]);

  return (
    <div class="dock" ref={ref}>
      {props.extraActions}
      <span class="dock-action" data-tooltip="Dashboard"><button type="button" class="icon ghost round" aria-label="Dashboard" onClick={props.onDashboard}><DashboardIcon /></button></span>
      <span class="dock-action" data-tooltip="Build and publish - commits saved changes to git, then rebuilds affected pages" tabIndex={props.saveDisabled ? 0 : undefined}>
        <button
          type="button"
          class="round dock-save icon"
          aria-label="Build and publish"
          disabled={props.saveDisabled}
          onClick={props.onSave}
        >
          {props.saveIcon}
          {!!props.saveCount && <span class="badge sm secondary dock-save-badge">{props.saveCount}</span>}
        </button>
      </span>
      <span class="dock-action" data-tooltip="Back to the page"><button type="button" class="icon ghost round" aria-label="Close page builder" onClick={props.onExit}><CloseIcon /></button></span>
    </div>
  );
}
