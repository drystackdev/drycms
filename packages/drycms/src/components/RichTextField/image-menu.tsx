import { useState } from "preact/hooks";
import type { RefObject } from "preact";
import type { Command } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import FileManager from "../FileManager.js";
import FloatingPanel from "../FloatingPanel.js";
import type { FileManagerSource } from "../file-manager-types.js";
import { parentFolderOf } from "../file-manager-utils.js";
import { AlignCenterIcon, AlignLeftIcon, AlignRightIcon, ReplaceIcon, TrashIcon } from "../icons.js";
import { useDialogSync } from "../list-nav.js";
import { useOverlayScrollbars } from "../overlayscrollbars.js";
import { removeNodeAt, replaceImageSrc, runCommand, setImageAlign } from "./commands.js";
import type { ImageAlign } from "./schema.js";
import type { ToolbarIconSize, ToolbarState } from "./types.js";

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "gif", "svg", "webp"];

export interface ImageMenuProps {
  viewRef: RefObject<EditorView | null>;
  state: ToolbarState;
  disabled?: boolean;
  /** Same optionality as `ImageInsertButton`'s - only lights up "Replace
   * image" (that button's the only thing here needing a file source). */
  source?: FileManagerSource;
  iconSize?: ToolbarIconSize;
}

/**
 * Floating per-image toolbar - ported from drystack's own image popover
 * (`form/fields/markdoc/editor/popovers/images.tsx`), trimmed to what this
 * field's own minimal image node (`schema.ts`) actually carries: no caption/
 * lock-aspect-ratio/dimensions dialog (the resize handles in `image-view.ts`
 * already cover sizing) - just align, replace, and remove. Anchored via
 * `FloatingPanel` to the selected image's own node-view DOM (`view.nodeDOM`),
 * the same "follow an arbitrary element" mechanism that component's own
 * docstring already calls out this feature as its intended use for.
 */
export default function ImageMenu({ viewRef, state, disabled = false, source, iconSize = "md" }: ImageMenuProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState("");
  const dialogRef = useDialogSync(open, () => setOpen(false));
  const { ref: pickerBody } = useOverlayScrollbars<HTMLDivElement>([open]);

  const selected = state.selectedImage;
  const view = viewRef.current;
  const anchor = selected && view ? (view.nodeDOM(selected.pos) as HTMLElement | null) : null;

  const run = (command: Command) => {
    if (!view) return;
    runCommand(view, command);
  };

  const toggleAlign = (value: ImageAlign) => {
    if (!selected) return;
    const current = (selected.node.attrs.align as ImageAlign | null) ?? null;
    run(setImageAlign(selected.pos, current === value ? null : value));
  };

  const openReplace = () => {
    if (disabled || !selected) return;
    setPending("");
    setOpen(true);
  };

  const confirmReplace = async () => {
    if (!pending || !selected || !source) return;
    const all = (await source.listAll?.()) ?? null;
    const list = all ?? (await source.list(parentFolderOf(pending)));
    const entry = list.find((item) => item.id === pending);
    setOpen(false);
    if (entry?.previewUrl) run(replaceImageSrc(selected.pos, entry.previewUrl, entry.name));
  };

  if (!selected) return null;
  const align = (selected.node.attrs.align as ImageAlign | null) ?? null;

  return (
    <>
      <FloatingPanel anchor={anchor}>
        <div class="richtext-image-menu">
          <button
            type="button"
            class={`ghost icon ${iconSize}`}
            aria-label="Align left"
            data-tooltip="Align left"
            aria-pressed={align === "left"}
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => toggleAlign("left")}
          >
            <AlignLeftIcon />
          </button>
          <button
            type="button"
            class={`ghost icon ${iconSize}`}
            aria-label="Align center"
            data-tooltip="Align center"
            aria-pressed={align === "center"}
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => toggleAlign("center")}
          >
            <AlignCenterIcon />
          </button>
          <button
            type="button"
            class={`ghost icon ${iconSize}`}
            aria-label="Align right"
            data-tooltip="Align right"
            aria-pressed={align === "right"}
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => toggleAlign("right")}
          >
            <AlignRightIcon />
          </button>
          {source && (
            <>
              <hr class="separator" role="separator" aria-orientation="vertical" />
              <button
                type="button"
                class={`ghost icon ${iconSize}`}
                aria-label="Replace image"
                data-tooltip="Replace image"
                aria-haspopup="dialog"
                disabled={disabled}
                onMouseDown={(event) => event.preventDefault()}
                onClick={openReplace}
              >
                <ReplaceIcon />
              </button>
            </>
          )}
          <hr class="separator" role="separator" aria-orientation="vertical" />
          <button
            type="button"
            class={`ghost icon ${iconSize}`}
            aria-label="Remove image"
            data-tooltip="Remove image"
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => run(removeNodeAt(selected.pos, selected.node.nodeSize))}
          >
            <TrashIcon />
          </button>
        </div>
      </FloatingPanel>
      {source && (
        <dialog ref={dialogRef} class="file-dialog image-picker-dialog" aria-label="Replace image">
          {open && (
            <>
              <header>
                <h3>Replace image</h3>
              </header>
              <div class="image-picker-body" ref={pickerBody}>
                <FileManager
                  source={source}
                  value={pending}
                  onChange={(next) => setPending(next as string)}
                  multiple={false}
                  accept={IMAGE_EXTENSIONS}
                  syncUrl={false}
                />
              </div>
              <footer>
                <button type="button" class="outline" onClick={() => setOpen(false)}>
                  Cancel
                </button>
                <button type="button" disabled={!pending} onClick={confirmReplace}>
                  Replace
                </button>
              </footer>
            </>
          )}
        </dialog>
      )}
    </>
  );
}
