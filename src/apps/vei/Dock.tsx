import type { ComponentChildren } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { ColumnsIcon, EditIcon, FullscreenIcon, type IconProps } from "../../components/icons/index.js";

/** The field editor's on-screen shape - `overlay.ts`'s `openFrame` reads
 * this to decide whether `.sheet` gets its `docked` class. Picked here (the
 * dock, not the frame itself) since it's a per-session UI preference, not
 * anything the iframe's own content needs to know about. */
export type EditorMode = "dialog" | "panel";

const modeIconProps: IconProps = { width: 16, height: 16, fill: "none", stroke: "currentColor", strokeWidth: 1.5 };

/** Same `[aria-pressed="true"]` pill-toggle pattern as `FileManager.tsx`'s
 * `.file-view-toggle` (`components.css:4179-4192`) - re-styled locally in
 * `overlay-styles.ts` rather than reusing that class, since this shadow root
 * never loads `components.css`. `FullscreenIcon` stands in for "dialog" -
 * nothing in the icon set names a centered-window concept more directly. */
function ModeToggle(props: { mode: EditorMode; onChange: (mode: EditorMode) => void }) {
  return (
    <div className="mode-toggle" role="group" aria-label="Field editor layout">
      <button
        type="button"
        className="ghost icon sm"
        title="Open fields in a centered dialog"
        aria-label="Dialog"
        aria-pressed={props.mode === "dialog"}
        onClick={() => props.onChange("dialog")}
      >
        <FullscreenIcon {...modeIconProps} />
      </button>
      <button
        type="button"
        className="ghost icon sm"
        title="Open fields in a right-docked panel"
        aria-label="Panel"
        aria-pressed={props.mode === "panel"}
        onClick={() => props.onChange("panel")}
      >
        <ColumnsIcon {...modeIconProps} />
      </button>
    </div>
  );
}

/**
 * Animates `.dock`'s width across a content change - CSS `transition: width`
 * alone can't do this, because a `transition` on `width` never animates
 * to/from "auto" (the dock's resting state, sized by its content). This
 * measures a real pixel width before and after whatever `deps` change just
 * did to the DOM, and lets the `.dock` CSS transition (`overlay-styles.ts`)
 * interpolate between them - same trick `overlay.ts` used to do imperatively
 * via its own `animateDockWidth`, just re-anchored to `useLayoutEffect` since
 * the mutation itself now happens through Preact's own re-render instead of
 * a function this hook calls directly.
 *
 * The "after" width is measured with the explicit width released back to
 * "auto" rather than read off `scrollWidth` - `scrollWidth` on an element
 * still pinned to the OLD width can only ever report a value >= that, so it
 * can grow a mutation that adds content but can't shrink one that removes it
 * (e.g. the preview badge disappearing entirely). "auto" always yields the
 * true content-fit size in either direction.
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
    // pixel width the last animation landed on) - e.g. a viewport resize
    // that reflows the label shouldn't leave the box stale until the next
    // `deps` change happens to fire another animation.
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

/**
 * The floating dock shown to a signed-in admin who hasn't entered edit mode
 * yet - `overlay.ts`'s `!config.edit` branch. `onOpenEditor` is `navigateTo`
 * bound to `/vei/enter`, a real navigation (see that function's doc comment
 * for why) - this component's only job is showing a spinner for the moment
 * before the page actually unloads.
 */
export function EditButtonDock(props: { onOpenEditor: () => void }) {
  const [opening, setOpening] = useState(false);
  return (
    <div className="dock">
      <button
        type="button"
        className={opening ? "ghost round" : "icon"}
        title="Edit content"
        aria-label="Edit content"
        disabled={opening}
        onClick={() => {
          setOpening(true);
          props.onOpenEditor();
        }}
      >
        {opening ? (
          <>
            <span className="vei-spinner" />
            Opening editor
          </>
        ) : (
          <EditIcon width={20} height={20} fill="none" stroke="currentColor" strokeWidth={1.5} />
        )}
      </button>
    </div>
  );
}

/**
 * Imperative controls `overlay.ts` drives from outside Preact's own data
 * flow: `setStatus`/`setSaving` are called from `saveAll()`'s async save
 * loop and the cross-tab draft subscription, and `setPreviewCount` from
 * `refreshPreviewCount()`'s IndexedDB read - none of which has any business
 * holding a `useState` setter itself. Handed back once via `onReady` rather
 * than the component reaching out to read state owned elsewhere.
 */
export interface EditingDockHandle {
  setStatus(text: string): void;
  setSaving(saving: boolean): void;
  setPreviewCount(count: number): void;
  setSheetOpen(open: boolean): void;
}

/** The full dock shown once edit mode is on - a "Dashboard" button (in place
 * of the old permanent "Edit mode" label), transient status text (save
 * progress/result, `EditingDockHandle.setStatus` - empty otherwise, so
 * nothing renders there most of the time), "Preview all" (with its
 * pending-changes badge), Save, and Exit. */
export function EditingDock(props: {
  initialMode: EditorMode;
  onModeChange: (mode: EditorMode) => void;
  onExit: () => void;
  /** Omit to hide the "Dashboard" button entirely - `undefined` (every call
   * site before `PageBuilder.tsx`) keeps it exactly as before.
   * `PageBuilder.tsx`'s `Toolbar.tsx` omits it: unlike the public-site
   * overlay (where "Dashboard" is the only way back INTO the admin app),
   * Page Builder already IS the admin app, so "Dashboard" and "Exit" would
   * be two buttons doing the same thing. */
  onDashboard?: () => void;
  onPreviewAll: () => void;
  onSave: () => void;
  onReady: (handle: EditingDockHandle) => void;
  /** Extra buttons rendered BEFORE "Dashboard" - `undefined` (every call
   * site before `PageBuilder.tsx`) renders nothing extra, so this is a
   * purely additive slot, not a behavior change for `overlay.ts`'s own
   * usage. `PageBuilder.tsx`'s `Toolbar.tsx` uses it for its "open file
   * menu"/"toggle VEI mode" buttons rather than forking this component. */
  extraActions?: ComponentChildren;
}) {
  const [exiting, setExiting] = useState(false);
  const [navigatingToDashboard, setNavigatingToDashboard] = useState(false);
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);
  // null until refreshPreviewCount's first read comes back - not 0, so a
  // real "zero pending drafts" answer doesn't animate the width twice.
  const [previewCount, setPreviewCount] = useState<number | null>(null);
  // Owned here, not by overlay.ts - only this component's own toggle ever
  // changes it. overlay.ts keeps its own copy (updated via onModeChange)
  // for openFrame() to read, since it drives the sheet outside Preact.
  const [mode, setMode] = useState<EditorMode>(props.initialMode);
  // Set by overlay.ts's openFrame()/closeDialog() - switching mode while a
  // dialog/panel is ALREADY open has no visible effect (`openFrame` only
  // applies `mode` to the `.sheet`'s `docked` class on the open it's
  // currently doing, not retroactively to one already open), so the toggle
  // would silently do nothing if left up. Hidden instead of disabled: a
  // disabled control still invites the click that won't do anything.
  const [sheetOpen, setSheetOpen] = useState(false);

  const ref = useDockWidthAnimation([status, saving, previewCount, sheetOpen]);

  useLayoutEffect(() => {
    props.onReady({ setStatus, setSaving, setPreviewCount, setSheetOpen });
    // Handed back once, on mount - overlay.ts's own callers are all async
    // (a save loop, a draft subscription), so they never run before this does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="dock" ref={ref}>
      {props.extraActions}
      {props.onDashboard && (
        <button
          type="button"
          className="ghost round"
          disabled={navigatingToDashboard}
          onClick={() => {
            setNavigatingToDashboard(true);
            props.onDashboard!();
          }}
        >
          {navigatingToDashboard ? (
            <>
              <span className="vei-spinner" />
              Opening dashboard
            </>
          ) : (
            "Dashboard"
          )}
        </button>
      )}
      {status && <span className="label">{status}</span>}
      {!sheetOpen && (
        <ModeToggle
          mode={mode}
          onChange={(next) => {
            setMode(next);
            props.onModeChange(next);
          }}
        />
      )}
      {previewCount !== null && previewCount > 0 && (
        <button type="button" className="ghost" onClick={props.onPreviewAll}>
          Preview all
          <span className="badge sm secondary">{previewCount}</span>
        </button>
      )}
      <button type="button" className="round" disabled={saving} onClick={props.onSave}>
        {saving ? (
          <>
            <span className="vei-spinner" />
            Saving
          </>
        ) : (
          "Save"
        )}
      </button>
      <button
        type="button"
        className="ghost round"
        disabled={exiting}
        onClick={() => {
          setExiting(true);
          props.onExit();
        }}
      >
        {exiting ? (
          <>
            <span className="vei-spinner" />
            Exiting
          </>
        ) : (
          "Exit"
        )}
      </button>
    </div>
  );
}
