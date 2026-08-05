import { useDialogSync } from "../../hooks/list-nav.js";
import { useOverlayScrollbars } from "../../hooks/overlayscrollbars.js";
import { EraserIcon, UndoIcon } from "../../components/icons/index.js";
import { formatDiffValue, type EntryFieldDiff } from "../../content-types/entry-draft-diff.js";

export interface EntryPreviewDialogProps {
  open: boolean;
  diffs: EntryFieldDiff[];
  onClose: () => void;
  /** Reverts one field back to its last-saved value. */
  onResetField: (fieldName: string) => void;
  /** Opens the "Reset all changes?" confirm dialog (owned by
   * `ContentEntryEditor.tsx`, stacked on top of this one - same nested-dialog
   * pattern `IconPreviewDialog.tsx` already uses for its own destructive
   * sub-action). */
  onRequestResetAll: () => void;
}

/**
 * "Preview" button's dialog (`ContentEntryEditor.tsx`) - a changed-fields
 * diff list (label + before/after), not a fully rendered preview of the
 * entry - same shape as the content-type builder's `ApplyBuildDialog.tsx`
 * review step. Both reset actions (per-field and Reset all) live here rather
 * than on the field rows themselves - see `status/entry-drafts.md`.
 */
export default function EntryPreviewDialog({
  open,
  diffs,
  onClose,
  onResetField,
  onRequestResetAll,
}: EntryPreviewDialogProps) {
  const ref = useDialogSync(open, onClose);
  const { ref: bodyScroll } = useOverlayScrollbars<HTMLDivElement>([open]);

  return (
    <dialog ref={ref} class="lg" aria-label="Review changes">
      {open && (
        <>
          <header>
            <h3>Review changes</h3>
            <p>{diffs.length} field{diffs.length === 1 ? "" : "s"} changed since the last save.</p>
          </header>

          {/* `ContentEntryEditor.tsx` closes this dialog itself the moment
              `diffs` would go empty (the last field reset, or Reset all) -
              there's no "no changes" state to design for here. */}
          <div class="under" ref={bodyScroll}>
            <ul class="entry-preview-diff-list">
              {diffs.map((diff) => (
                <li key={diff.fieldName} class="entry-preview-diff-item">
                  <div class="entry-preview-diff-item-head">
                    <strong>{diff.label}</strong>
                    <button
                      type="button"
                      class="ghost icon sm"
                      title="Reset to saved value"
                      onClick={() => onResetField(diff.fieldName)}
                    >
                      <UndoIcon />
                    </button>
                  </div>
                  <div class="entry-preview-diff-values">
                    <span class="entry-preview-diff-before">{formatDiffValue(diff.before)}</span>
                    <span class="entry-preview-diff-after">{formatDiffValue(diff.after)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <footer>
            <button type="button" class="destructive" onClick={onRequestResetAll}>
              <EraserIcon /> Reset all
            </button>
            <span class="spacer" />
            <button type="button" onClick={onClose}>Close</button>
          </footer>
        </>
      )}
    </dialog>
  );
}
