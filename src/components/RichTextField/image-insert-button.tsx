import { useRef, useState } from "preact/hooks";
import FileManager from "../FileManager.js";
import type { FileEntry } from "../file-manager-types.js";
import { parentFolderOf } from "../file-manager-utils.js";
import { MediaIcon } from "../icons.js";
import { useDialogSync } from "../list-nav.js";
import { useOverlayScrollbars } from "../overlayscrollbars.js";
import { schema } from "./schema.js";
import type { ToolbarCustomProps } from "./types.js";

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "gif", "svg", "webp"];

/**
 * Toolbar button opening a `FileManager`-backed picker dialog (same shape as
 * `ImageField`'s) and inserting the chosen file as an inline image node at
 * wherever the selection was when the dialog opened. The dialog steals
 * focus away from the editor, but ProseMirror's own state (unlike Lexical's)
 * isn't reset by losing DOM focus - the position is still captured up front
 * (`openPicker`) since `disabled`/other state could in principle change
 * before "Insert" is clicked; if it's out of range (or was never available),
 * the image is inserted at the end of the document instead.
 */
export default function ImageInsertButton({ viewRef, disabled = false, source, iconSize }: ToolbarCustomProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState("");
  const anchorPosRef = useRef<number | null>(null);
  const dialogRef = useDialogSync(open, () => setOpen(false));
  const { ref: pickerBody } = useOverlayScrollbars<HTMLDivElement>([open]);

  if (!source) return <></>;

  const openPicker = () => {
    if (disabled) return;
    anchorPosRef.current = viewRef.current?.state.selection.to ?? null;
    setPending("");
    setOpen(true);
  };

  const insertImage = (entry: FileEntry) => {
    const view = viewRef.current;
    if (!view || !entry.previewUrl) return;
    const imageNode = schema.nodes.image!.create({ src: entry.previewUrl, alt: entry.name });
    const docSize = view.state.doc.content.size;
    const pos = anchorPosRef.current !== null && anchorPosRef.current <= docSize ? anchorPosRef.current : docSize;
    view.dispatch(view.state.tr.insert(pos, imageNode));
    view.focus();
  };

  const confirm = async () => {
    if (!pending) return;
    const all = (await source.listAll?.()) ?? null;
    const list = all ?? (await source.list(parentFolderOf(pending)));
    const entry = list.find((item) => item.id === pending);
    setOpen(false);
    if (entry) insertImage(entry);
  };

  return (
    <>
      <button
        type="button"
        class={`ghost icon ${iconSize}`}
        aria-label="Insert image"
        data-tooltip="Insert image"
        aria-haspopup="dialog"
        disabled={disabled}
        onMouseDown={(event) => event.preventDefault()}
        onClick={openPicker}
      >
        <MediaIcon />
      </button>
      <dialog ref={dialogRef} class="file-dialog image-picker-dialog" aria-label="Insert image">
        {open && (
          <>
            <header>
              <h3>Insert image</h3>
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
              <button type="button" disabled={!pending} onClick={confirm}>
                Insert
              </button>
            </footer>
          </>
        )}
      </dialog>
    </>
  );
}
