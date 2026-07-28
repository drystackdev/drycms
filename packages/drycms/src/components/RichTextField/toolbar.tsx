import { Fragment, type RefObject } from "preact";
import type { LexicalEditor } from "lexical";
import AlignMenu from "./align-menu.js";
import { TOOLBAR_GROUPS, type ToolbarButton } from "./toolbar-buttons.js";
import type { ToolbarState } from "./types.js";

/** `TOOLBAR_GROUPS` index after which the (non-`ToolbarButton`) alignment
 * popover is inserted - currently right after the bold/italic/underline
 * group. If a second bespoke, non-toggle item shows up, generalize
 * `ToolbarButton` into a button-or-custom union instead of hardcoding a
 * second index here. */
const ALIGN_MENU_AFTER_GROUP = 1;

export interface RichTextToolbarProps {
  /** The ref itself, not `editorRef.current` - the editor is only assigned
   * after mount, and a button clicked before this component's next render
   * needs the live value, not whatever was there at render time. */
  editorRef: RefObject<LexicalEditor | null>;
  state: ToolbarState;
  disabled?: boolean;
  contentRef: RefObject<HTMLElement>;
}

/** Purely presentational - rendering whatever `./toolbar-buttons.ts` lists.
 * Shouldn't need to change when a button is added/removed/edited. */
export default function RichTextToolbar({ editorRef, state, disabled = false, contentRef }: RichTextToolbarProps) {
  // A plain click on a toolbar button would blur the contenteditable and
  // collapse its selection before the click handler ever runs.
  const preserveSelection = (event: MouseEvent) => event.preventDefault();

  const runButton = (button: ToolbarButton) => {
    const editor = editorRef.current;
    if (!editor) return;
    contentRef.current?.focus();
    button.run(editor);
  };

  return (
    <div class="richtext-toolbar" role="group" aria-label="Formatting">
      {TOOLBAR_GROUPS.map((group, index) => (
        <Fragment key={index}>
          {index > 0 && <hr class="separator" role="separator" aria-orientation="vertical" />}
          {group.map((button) => (
            <button
              key={button.key}
              type="button"
              class="ghost icon sm"
              aria-label={button.label}
              data-tooltip={button.label}
              aria-pressed={button.isActive?.(state)}
              disabled={disabled || button.isDisabled?.(state)}
              onMouseDown={preserveSelection}
              onClick={() => runButton(button)}
            >
              <button.Icon />
            </button>
          ))}
          {index === ALIGN_MENU_AFTER_GROUP && (
            <>
              <hr class="separator" role="separator" aria-orientation="vertical" />
              <AlignMenu editorRef={editorRef} contentRef={contentRef} align={state.align} disabled={disabled} />
            </>
          )}
        </Fragment>
      ))}
    </div>
  );
}
