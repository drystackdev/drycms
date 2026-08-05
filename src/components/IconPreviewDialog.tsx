import { useMemo, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
const { path } = window.__DRY_CONFIG__;
import { createIconsApi, type IconEntry } from "../icons/icons-http-api.js";
import CodeBlock from "./CodeBlock.js";
import ConfirmDialog from "./ConfirmDialog.js";
import IconGlyph from "./IconGlyph.js";
import { CloseIcon, RenameIcon, TrashIcon, XIcon } from "./icons/index.js";
import { useDialogSync } from "../hooks/list-nav.js";

interface Props {
  entry: IconEntry;
  onClose: () => void;
  onDeleted: () => void;
}

function maskSnippet(entry: IconEntry): string {
  const url = entry.url;
  return [
    "<i",
    ` style="display:inline-block;width:1em;height:1em;background-color:currentColor;`,
    `-webkit-mask:url('${url}') no-repeat center / contain;`,
    `mask:url('${url}') no-repeat center / contain;"`,
    "></i>",
  ].join("");
}

/**
 * Clicking an icon in `IconManagement`'s grid opens this: a larger preview,
 * an edit action (-> the manual add/edit form, prefilled), a destructive
 * delete (behind the same `ConfirmDialog` every other destructive action in
 * this codebase uses), and a copy-pasteable `<i>` snippet using Iconify's own
 * CSS-mask technique against this icon's own storage URL. Renders its own
 * preview via `IconGlyph` (the same mask technique, live) rather than
 * `dangerouslySetInnerHTML` - the bytes behind that URL are sanitized on
 * write, but this stays on the safe rendering path regardless.
 *
 * Note: the mask-image technique only reproduces monochrome icons correctly
 * (multi-color/duotone icons collapse to a solid `currentColor` shape) - an
 * inherent limitation of `mask`, not a bug here.
 */
export default function IconPreviewDialog({
  entry,
  onClose,
  onDeleted,
}: Props) {
  const { route } = useLocation();
  const ref = useDialogSync(true, onClose);
  const iconsApi = useMemo(() => createIconsApi(`${path}/api/icons`), []);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const displayName = entry.name.replace(/\.svg$/, "");

  const handleDelete = () => {
    setBusy(true);
    iconsApi
      .remove(entry.name)
      .then(() => onDeleted())
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Failed to delete icon.");
        setBusy(false);
        setConfirmingDelete(false);
      });
  };

  return (
    <>
      <dialog
        ref={ref}
        class="md icon-preview-dialog"
        aria-label={`Preview: ${displayName}`}
      >
        <header class="row justify-between">
          <h3>{displayName}</h3>
          <button onClick={onClose} class="icon ghost">
            <XIcon />
          </button>
        </header>

        {error && <span class="error">{error}</span>}
        <div class="row" style={{alignItems: 'flex-start'}}>
          <div class="icon-preview-body center">
            <IconGlyph src={entry.url} size={48} />
          </div>

          <CodeBlock
            maxHeight="min(80vh, 20rem)"
            code={maskSnippet(entry)}
            wrap
            copyable
            formatHtml
            style={{flex: 1}}
          />
        </div>

        <footer>
          <button
            type="button"
            class="destructive"
            onClick={() => setConfirmingDelete(true)}
          >
            <TrashIcon /> Delete
          </button>
          <button
            type="button"
            class="outline"
            onClick={() =>
              route(
                `${path}/icon-management/manual/${encodeURIComponent(entry.name)}`,
              )
            }
          >
            <RenameIcon /> Edit
          </button>
          <button type="button" onClick={onClose}>
            Close
          </button>
        </footer>
      </dialog>

      <ConfirmDialog
        open={confirmingDelete}
        title="Delete icon?"
        message={`"${displayName}" will be permanently removed.`}
        confirmLabel="Delete"
        destructive
        busy={busy}
        onConfirm={handleDelete}
        onCancel={() => setConfirmingDelete(false)}
      />
    </>
  );
}
