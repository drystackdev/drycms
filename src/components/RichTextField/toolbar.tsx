import { useEffect, useRef } from "preact/hooks";
import type { RefObject } from "preact";
import type { EditorView } from "prosemirror-view";
import { runCommand } from "./commands.js";
import type { FileManagerSource } from "../file-manager-types.js";
import DryComponentMenu from "./dry-component-menu.js";
import GridMenu from "./grid-menu.js";
import TableMenu from "./table-menu.js";
import { TOOLBAR_GROUPS, type ToolbarButton } from "./toolbar-buttons.js";
import type { ToolbarIconSize, ToolbarState } from "./types.js";
import { displayShortcut } from "./shortcuts.js";

interface ToolbarScrollSnapshot {
  anchor: HTMLElement;
  container: HTMLElement | Window;
  anchorTop: number;
}

function isScrollable(element: HTMLElement): boolean {
  const style = getComputedStyle(element);
  return /(auto|scroll|overlay)/.test(`${style.overflow}${style.overflowY}`);
}

function scrollContainerFor(element: HTMLElement): HTMLElement | Window {
  let parent = element.parentElement;
  while (parent) {
    if (isScrollable(parent)) return parent;
    parent = parent.parentElement;
  }
  return window;
}

function captureToolbarScroll(anchor: HTMLElement | null): ToolbarScrollSnapshot | null {
  if (!anchor) return null;
  return { anchor, container: scrollContainerFor(anchor), anchorTop: anchor.getBoundingClientRect().top };
}

function restoreToolbarScroll(snapshot: ToolbarScrollSnapshot) {
  const delta = snapshot.anchor.getBoundingClientRect().top - snapshot.anchorTop;
  if (Math.abs(delta) < 0.5) return;
  if (snapshot.container === window) {
    window.scrollTo({ top: window.scrollY + delta, behavior: "auto" });
  } else {
    (snapshot.container as HTMLElement).scrollTop += delta;
  }
}

export interface RichTextToolbarProps {
  /** The ref itself, not `viewRef.current` - the view is only assigned
   * after mount, and a button clicked before this component's next render
   * needs the live value, not whatever was there at render time. */
  viewRef: RefObject<EditorView | null>;
  state: ToolbarState;
  disabled?: boolean;
  contentRef: RefObject<HTMLElement>;
  /** Hides `blockOnly` items (`BlockTypeMenu`, `AlignMenu`) and the whole
   * `TableMenu` card (tables are block-level too, but it isn't part of
   * `TOOLBAR_GROUPS` for `blockOnly` to reach) - see `RichTextField`'s own
   * `inline` prop. @default false */
  inline?: boolean;
  /** Passed through to every custom item as `ToolbarCustomProps.source` -
   * only `ImageInsertButton` reads it. Absent hides that button (see
   * `requiresSource` in `toolbar-buttons.ts`). */
  source?: FileManagerSource;
  /** Applied to every button's own icon-only sizing class (`class="ghost
   * icon <iconSize>"`), both the plain toolbar buttons and each custom
   * item's own trigger button. @default "md" */
  iconSize?: ToolbarIconSize;
  /** Passed through to every custom item, same as `source` - only
   * `fullscreen-button.tsx` reads either. */
  fullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

/** Purely presentational - rendering whatever `./toolbar-buttons.ts` lists.
 * Shouldn't need to change when a button is added/removed/edited. Each
 * group renders as its own bordered `.richtext-toolbar-block` (undo/redo;
 * inline formatting + image; block-level menus, fullscreen now among them)
 * rather than being separated by an `<hr>` - a group of *related* controls
 * reading as one visual unit, not a flat row divided by lines. `TableMenu`
 * is the one exception, rendered directly rather than through
 * `TOOLBAR_GROUPS`: it's a card with its own internal collapse/expand
 * transition (see that file) this generic per-group wrapper has no notion
 * of, so it keeps building its own card rather than being wrapped in a
 * second one here. */
export default function RichTextToolbar({
  viewRef,
  state,
  disabled = false,
  contentRef,
  inline = false,
  source,
  iconSize = "md",
  fullscreen,
  onToggleFullscreen,
}: RichTextToolbarProps) {
  const scrollSnapshotRef = useRef<ToolbarScrollSnapshot | null>(null);

  // A plain click on a toolbar button would blur the contenteditable and
  // collapse its selection before the click handler ever runs.
  const preserveSelection = (event: MouseEvent) => event.preventDefault();

  const runButton = (button: ToolbarButton) => {
    const view = viewRef.current;
    if (!view) return;
    runCommand(view, button.run);
  };

  const captureScrollBeforeAction = () => {
    scrollSnapshotRef.current = captureToolbarScroll(contentRef.current);
  };

  const restoreScrollAfterAction = () => {
    const snapshot = scrollSnapshotRef.current;
    scrollSnapshotRef.current = null;
    if (!snapshot) return;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => restoreToolbarScroll(snapshot));
    });
  };

  useEffect(() => {
    // Popover actions can render in the browser top layer and stop the click
    // before it bubbles back to this toolbar. Document bubble phase runs
    // after the action itself, so it is the reliable final measurement point.
    document.addEventListener("click", restoreScrollAfterAction);
    return () => document.removeEventListener("click", restoreScrollAfterAction);
  });

  // Groups can end up empty once `blockOnly` items are filtered out (e.g. the
  // align-only group under `inline`) - drop those so an empty block never
  // renders as a bare, content-less bordered box.
  const visibleGroups = TOOLBAR_GROUPS.map((group) =>
    group.filter(
      (item) =>
        !(inline && item.blockOnly) &&
        !(item.type === "custom" && item.requiresSource && !source),
    ),
  ).filter((group) => group.length > 0);

  return (
    <div
      class="richtext-toolbar"
      role="group"
      aria-label="Formatting"
      onMouseDownCapture={captureScrollBeforeAction}
      onClick={restoreScrollAfterAction}
    >
      {visibleGroups.map((group, index) => (
        <div class="richtext-toolbar-block" key={index}>
          {group.map((item) =>
            item.type === "custom" ? (
              <item.Component
                key={item.key}
                viewRef={viewRef}
                contentRef={contentRef}
                state={state}
                disabled={disabled || state.reorderModeActive || !!item.isDisabled?.(state)}
                source={source}
                iconSize={iconSize}
                shortcut={item.shortcut ? displayShortcut(item.shortcut) : undefined}
                fullscreen={fullscreen}
                onToggleFullscreen={onToggleFullscreen}
              />
            ) : (
              <button
                key={item.key}
                type="button"
                class={`ghost icon ${iconSize}`}
                aria-label={item.label}
                data-tooltip={item.shortcut ? `${item.label} (${displayShortcut(item.shortcut)})` : item.label}
                aria-pressed={item.isActive?.(state)}
                disabled={
                  disabled ||
                  state.reorderModeActive ||
                  item.isDisabled?.(state)
                }
                onMouseDown={preserveSelection}
                onClick={() => runButton(item)}
              >
                <item.Icon />
              </button>
            ),
          )}
        </div>
      ))}
      {!inline && <TableMenu viewRef={viewRef} state={state} disabled={disabled || state.reorderModeActive} iconSize={iconSize} />}
      {!inline && <GridMenu viewRef={viewRef} state={state} disabled={disabled || state.reorderModeActive} iconSize={iconSize} />}
      <DryComponentMenu
        viewRef={viewRef}
        state={state}
        disabled={disabled || state.reorderModeActive}
        source={source}
        iconSize={iconSize}
      />
    </div>
  );
}
