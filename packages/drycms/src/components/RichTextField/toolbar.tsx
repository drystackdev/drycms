import { Fragment, type RefObject } from "preact";
import type { EditorView } from "prosemirror-view";
import { runCommand } from "./commands.js";
import type { FileManagerSource } from "../file-manager-types.js";
import { TOOLBAR_GROUPS, type ToolbarButton } from "./toolbar-buttons.js";
import type { ToolbarIconSize, ToolbarState } from "./types.js";

export interface RichTextToolbarProps {
  /** The ref itself, not `viewRef.current` - the view is only assigned
   * after mount, and a button clicked before this component's next render
   * needs the live value, not whatever was there at render time. */
  viewRef: RefObject<EditorView | null>;
  state: ToolbarState;
  disabled?: boolean;
  contentRef: RefObject<HTMLElement>;
  /** Hides `blockOnly` items (`BlockTypeMenu`, `AlignMenu`) - see
   * `RichTextField`'s own `inline` prop. @default false */
  inline?: boolean;
  /** Passed through to every custom item as `ToolbarCustomProps.source` -
   * only `ImageInsertButton` reads it. Absent hides that button (see
   * `requiresSource` in `toolbar-buttons.ts`). */
  source?: FileManagerSource;
  /** Applied to every button's own icon-only sizing class (`class="ghost
   * icon <iconSize>"`), both the plain toolbar buttons and each custom
   * item's own trigger button. @default "md" */
  iconSize?: ToolbarIconSize;
}

/** Purely presentational - rendering whatever `./toolbar-buttons.ts` lists.
 * Shouldn't need to change when a button is added/removed/edited. */
export default function RichTextToolbar({
  viewRef,
  state,
  disabled = false,
  contentRef,
  inline = false,
  source,
  iconSize = "md"
}: RichTextToolbarProps) {
  // A plain click on a toolbar button would blur the contenteditable and
  // collapse its selection before the click handler ever runs.
  const preserveSelection = (event: MouseEvent) => event.preventDefault();

  const runButton = (button: ToolbarButton) => {
    const view = viewRef.current;
    if (!view) return;
    runCommand(view, button.run);
  };

  // Groups can end up empty once `blockOnly` items are filtered out (e.g. the
  // align-only group under `inline`) - drop those so the `index > 0`
  // separator below doesn't leave a stray `<hr>` next to nothing.
  const visibleGroups = TOOLBAR_GROUPS.map((group) =>
    group.filter(
      (item) =>
        !(inline && item.type === "custom" && item.blockOnly) &&
        !(item.type === "custom" && item.requiresSource && !source),
    ),
  ).filter((group) => group.length > 0);

  return (
    <div class="richtext-toolbar" role="group" aria-label="Formatting">
      {visibleGroups.map((group, index) => (
        <Fragment key={index}>
          {index > 0 && <hr class="separator" role="separator" aria-orientation="vertical" />}
          {group.map((item) =>
            item.type === "custom" ? (
              <item.Component
                key={item.key}
                viewRef={viewRef}
                contentRef={contentRef}
                state={state}
                disabled={disabled}
                source={source}
                iconSize={iconSize}
              />
            ) : (
              <button
                key={item.key}
                type="button"
                class={`ghost icon ${iconSize}`}
                aria-label={item.label}
                data-tooltip={item.label}
                aria-pressed={item.isActive?.(state)}
                disabled={disabled || item.isDisabled?.(state)}
                onMouseDown={preserveSelection}
                onClick={() => runButton(item)}
              >
                <item.Icon />
              </button>
            ),
          )}
        </Fragment>
      ))}
    </div>
  );
}
