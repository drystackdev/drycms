import { useDialogSync } from "../../../hooks/list-nav.js";
import Editer from "../../../components/Editer.js";
import type { EditerFormatLanguage } from "../../../components/Editer/format-code.js";
import type { EditerResult } from "../../../components/Editer/types.js";
import { STYLES_ROOT, rootOf } from "../../../server/app-router/source-roots.js";
import { HistoryIcon } from "../../../components/icons/index.js";

export interface FileDialogProps {
  path: string;
  source: string;
  /** Every other file (plus `dry.generated.d.ts`) for the `Editer`'s
   * cross-file TS resolution - see `PageBuilder.tsx`'s `baseExtraFiles`/
   * `extraFilesExcluding`. Only matters for a `.css` file's `@apply`
   * completions/`var(--...)` lookups today - a `.md` file gets no
   * completions of any kind either way (`Editer`'s own `language="md"`
   * branch). */
  extraFiles: Record<string, string>;
  /** Has changes that have not been built and published yet. */
  dirty: boolean;
  /** See `CodePanelProps.canDiscard`. */
  canDiscard: boolean;
  saving: boolean;
  onChange: (code: string) => void;
  /** A debounced write is in flight - shows "Saving…" instead of "Saved". */
  autosaving: boolean;
  onReset: () => void;
  onClose: () => void;
  readOnly?: boolean;
  onOpenHistory?: () => void;
}

function languageForPath(path: string): EditerFormatLanguage {
  return rootOf(path)?.id === STYLES_ROOT ? "css" : "md";
}

/**
 * `styles/*.css`/`md/*.md` files (`plans/new-ui-page-builder.md` mục 7) -
 * every `.tsx` file (page, layout, or component) opens in the main
 * `CodePanel` now instead (`status/page-builder-code-preview-sync.md`'s
 * "always open in preview" decision), which is why this dialog carries no
 * preview column of its own any more - neither a stylesheet nor a plain
 * Markdown note has one. Save/Reset write straight to `pagesSourceStorage` -
 * there's no staged-apply here, matching Page Editor's own current
 * behavior for this same storage.
 */
export default function FileDialog(props: FileDialogProps) {
  const dialogRef = useDialogSync(true, props.onClose);

  function handleChange(result: EditerResult) {
    props.onChange(result.code);
  }

  return (
    <dialog ref={dialogRef} aria-label={props.path} class="xl page-builder-file-dialog">
      <header class="page-builder-file-dialog-header">
        <strong class="page-builder-file-dialog-title">{props.path}</strong>
        <span class="spacer" />
        {/* See `CodePanel.tsx` - editing writes itself through, so there is
            nothing for a Save button to do here either. */}
        <span class="hint">{props.autosaving ? "Saving…" : props.dirty ? "Not published" : "Saved"}</span>
        {props.onOpenHistory && <button type="button" class="ghost icon sm" aria-label="File history" title="History" onClick={props.onOpenHistory}><HistoryIcon /></button>}
        <button type="button" class="outline sm" disabled={props.readOnly || !props.canDiscard || props.saving} onClick={props.onReset} title="Restore this file from the last published commit">Discard</button>
        <button type="button" class="ghost sm" onClick={props.onClose}>Close</button>
      </header>
      <div class="page-builder-file-dialog-body">
        <div class="page-builder-file-dialog-editor">
          <Editer
            key={`${props.path}:${props.readOnly ? "readonly" : "edit"}`}
            value={props.source}
            onChange={handleChange}
            extraFiles={props.extraFiles}
            language={languageForPath(props.path)}
            style={{ height: "100%" }}
            readOnly={props.readOnly}
          />
        </div>
      </div>
    </dialog>
  );
}
