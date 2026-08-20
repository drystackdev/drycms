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
 *
 * The FIRST run animates too: the dock mounts only once Page Builder's
 * preview is ready, replacing the single round loading button
 * (`PageBuilder.tsx`'s `PageBuilderLoadingLayer`), so it starts at that
 * circle's size and unrolls to its content width.
 */
function useDockWidthAnimation(deps: readonly unknown[]) {
  const ref = useRef<HTMLDivElement>(null);
  const widthRef = useRef<number | null>(null);
  const mounted = useRef(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Release the explicit px back to "auto" once the transition finishes,
    // so the dock's resting state stays content-fit (not pinned to whatever
    // pixel width the last animation landed on). `expanding` only exists for
    // the duration of the mount animation below (it clips the buttons the
    // dock is not wide enough to show yet).
    const handleTransitionEnd = (event: TransitionEvent) => {
      if (event.propertyName !== "width") return;
      el.style.width = "auto";
      el.classList.remove("expanding");
    };
    el.addEventListener("transitionend", handleTransitionEnd);

    let before: number;
    if (mounted.current) {
      before = widthRef.current ?? el.getBoundingClientRect().width;
      el.style.width = "auto";
    } else {
      mounted.current = true;
      // Reduced motion: land on the resting size directly - the dock still
      // appears, it just doesn't unroll.
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        widthRef.current = el.getBoundingClientRect().width;
        return () => el.removeEventListener("transitionend", handleTransitionEnd);
      }
      // The dock replaces `PageBuilder.tsx`'s loading circle, which is one
      // round button - i.e. exactly as wide as the dock is tall, since the
      // dock's own padding is symmetric around a button of that same size.
      // Starting the width there makes the arrival read as that circle
      // unrolling into the toolbar rather than as a swap.
      before = el.getBoundingClientRect().height;
      el.classList.add("expanding");
    }
    const after = el.getBoundingClientRect().width;
    el.style.width = `${before}px`;
    requestAnimationFrame(() => {
      el.style.width = `${after}px`;
    });
    widthRef.current = after;

    // `transitionend` is the normal exit, but a change that happens to leave
    // the width identical never fires one - and `expanding` clips the save
    // badge for as long as it stays on. Settle it either way.
    const settle = setTimeout(() => {
      el.style.width = "auto";
      el.classList.remove("expanding");
    }, 400);

    return () => {
      clearTimeout(settle);
      el.removeEventListener("transitionend", handleTransitionEnd);
    };
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
      <span class="dock-action" data-tooltip="Build and publish" tabIndex={props.saveDisabled ? 0 : undefined}>
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
