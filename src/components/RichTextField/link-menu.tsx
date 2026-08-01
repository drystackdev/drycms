import { useEffect, useState } from "preact/hooks";
import type { Command } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import Select, { type SelectOption } from "../Select.js";
import TextField from "../TextField.js";
import { useDialogSync } from "../list-nav.js";
import { LinkIcon, TrashIcon } from "../icons.js";
import { removeLink, runCommand, setLink } from "./commands.js";
import type { ToolbarCustomProps } from "./types.js";
import { RICH_TEXT_SHORTCUT_EVENT } from "./shortcuts.js";

/** `target` only ever stores `"_blank"` or `null` (see schema.ts) - this
 * dialog's own friendlier label for `null` is "Same tab". */
const TARGET_OPTIONS: SelectOption[] = [
  { value: "_self", label: "Same tab" },
  { value: "_blank", label: "New tab" },
];

/**
 * Toolbar item for the `link` mark - a single button that always opens the
 * same edit `<dialog>` (URL + a `target` `Select`), whether creating a link
 * on the current selection or editing one the cursor already sits inside
 * (`state.link.active` - see `getLinkState`/`linkMarkRange` in
 * `commands.ts`, which is what lets a *collapsed* cursor resting inside an
 * existing link enable this button without re-selecting it). "Remove link"
 * only shows up once there's an actual link to remove.
 */
export default function LinkMenu({ viewRef, state, disabled = false, iconSize, shortcut }: ToolbarCustomProps) {
  const [open, setOpen] = useState(false);
  const [href, setHref] = useState("");
  const [target, setTarget] = useState<string>("_self");
  const dialogRef = useDialogSync(open, () => setOpen(false));

  const preserveSelection = (event: MouseEvent) => event.preventDefault();

  const run = (command: Command) => {
    const view = viewRef.current;
    if (!view) return;
    runCommand(view, command);
  };

  const openDialog = () => {
    setHref(state.link.href);
    setTarget(state.link.target === "_blank" ? "_blank" : "_self");
    setOpen(true);
  };

  useEffect(() => {
    const onShortcut = (event: Event) => {
      const detail = (event as CustomEvent<{ name?: string; view?: EditorView }>).detail;
      if (detail?.name !== "link" || detail.view !== viewRef.current || disabled || state.link.disabled) return;
      openDialog();
    };
    document.addEventListener(RICH_TEXT_SHORTCUT_EVENT, onShortcut);
    return () => document.removeEventListener(RICH_TEXT_SHORTCUT_EVENT, onShortcut);
  });

  const confirm = () => {
    setOpen(false);
    const trimmedHref = href.trim();
    if (!trimmedHref) {
      run(removeLink());
      return;
    }
    run(setLink(trimmedHref, target === "_blank" ? "_blank" : null));
  };

  const remove = () => {
    setOpen(false);
    run(removeLink());
  };

  return (
    <>
      <button
        type="button"
        class={`ghost icon ${iconSize}`}
        aria-label={state.link.active ? "Edit link" : "Link"}
        data-tooltip={`${state.link.active ? "Edit link" : "Link"}${shortcut ? ` (${shortcut})` : ""}`}
        aria-pressed={state.link.active}
        aria-haspopup="dialog"
        disabled={disabled || state.link.disabled}
        onMouseDown={preserveSelection}
        onClick={openDialog}
      >
        <LinkIcon />
      </button>
      <dialog ref={dialogRef} aria-label="Link">
        {open && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              confirm();
            }}
          >
            <header>
              <h3>{state.link.active ? "Edit link" : "Insert link"}</h3>
            </header>
            <div class="stack">
              <TextField label="URL" value={href} onChange={setHref} placeholder="e.g. https://example.com" />
              <div class="field">
                <label>Open in</label>
                <Select options={TARGET_OPTIONS} value={target} onChange={setTarget} />
              </div>
            </div>
            <footer>
              {state.link.active && (
                <button
                  type="button"
                  class="outline popover-menu-danger"
                  style={{ marginInlineEnd: "auto" }}
                  onClick={remove}
                >
                  <TrashIcon /> Remove link
                </button>
              )}
              <button type="button" class="outline" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button type="submit" disabled={!href.trim()}>
                Save
              </button>
            </footer>
          </form>
        )}
      </dialog>
    </>
  );
}
