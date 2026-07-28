import { useRef, useState } from "preact/hooks";
import {
  $createParagraphNode,
  $getNodeByKey,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
} from "lexical";
import FileManager from "../FileManager.js";
import type { FileEntry } from "../file-manager-types.js";
import { parentFolderOf } from "../file-manager-utils.js";
import { MediaIcon } from "../icons.js";
import { useDialogSync } from "../list-nav.js";
import { useOverlayScrollbars } from "../overlayscrollbars.js";
import { $createImageNode } from "./image-node.js";
import type { ToolbarCustomProps } from "./types.js";

const IMAGE_EXTENSIONS = ["jpg", "jpeg", "png", "gif", "svg", "webp"];

/**
 * Toolbar button opening a `FileManager`-backed picker dialog (same shape as
 * `ImageField`'s) and inserting the chosen file as an inline `ImageNode` -
 * appended into whichever block (paragraph/heading/quote) had focus when the
 * dialog opened, the same way `<em>`/`<strong>` sit among a block's other
 * inline content rather than as their own top-level element (see
 * `image-node.ts`). The dialog steals focus/selection away from the editor,
 * so there's no live selection left to insert at by the time "Insert" is
 * clicked - the focused block's key is captured up front instead
 * (`openPicker`) and resolved back at insert time; if it's gone (or was
 * never available), the image is appended to the last block in the document
 * instead.
 */
export default function ImageInsertButton({ editorRef, contentRef, disabled = false, source }: ToolbarCustomProps) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState("");
  const anchorKeyRef = useRef<string | null>(null);
  const dialogRef = useDialogSync(open, () => setOpen(false));
  const { ref: pickerBody } = useOverlayScrollbars<HTMLDivElement>([open]);

  if (!source) return <></>;

  const openPicker = () => {
    if (disabled) return;
    anchorKeyRef.current = null;
    editorRef.current?.getEditorState().read(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        anchorKeyRef.current = selection.anchor.getNode().getTopLevelElementOrThrow().getKey();
      }
    });
    setPending("");
    setOpen(true);
  };

  const insertImage = (entry: FileEntry) => {
    const editor = editorRef.current;
    if (!editor || !entry.previewUrl) return;
    contentRef.current?.focus();
    editor.update(() => {
      const imageNode = $createImageNode(entry.previewUrl!, entry.name);
      const anchor = anchorKeyRef.current ? $getNodeByKey(anchorKeyRef.current) : null;
      const block = anchor && $isElementNode(anchor) ? anchor : $getRoot().getLastChild();
      if (block && $isElementNode(block)) {
        block.append(imageNode);
      } else {
        const paragraph = $createParagraphNode();
        paragraph.append(imageNode);
        $getRoot().append(paragraph);
      }
    });
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
        class="ghost icon sm"
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
