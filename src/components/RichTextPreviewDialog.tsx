import { useDialogSync } from "../hooks/list-nav.js";
import CodeBlock from "./CodeBlock.js";
import { XIcon } from "./icons/index.js";

/** Opened by a block-level richtext cell's "View HTML" button
 * (`EntryCellValue.tsx`'s `renderEntryCellValue`) - same `CodeBlock`/
 * `formatHtml` pattern `IconPreviewDialog.tsx` uses for its own read-only
 * snippet view. */
export default function RichTextPreviewDialog({
  preview,
  onClose,
}: {
  preview: { label: string; html: string } | null;
  onClose: () => void;
}) {
  const ref = useDialogSync(preview !== null, onClose);
  return (
    <dialog
      ref={ref}
      class="lg"
      aria-label={preview ? `${preview.label} HTML` : "HTML preview"}
    >
      {preview && (
        <>
          <header class="row justify-between">
            <h3>{preview.label}</h3>
            <button type="button" class="icon ghost" onClick={onClose}>
              <XIcon />
            </button>
          </header>
          <CodeBlock
            code={preview.html}
            formatHtml
            wrap
            copyable
            maxHeight="min(70vh, 32rem)"
          />
          <footer>
            <button type="button" onClick={onClose}>
              Close
            </button>
          </footer>
        </>
      )}
    </dialog>
  );
}
