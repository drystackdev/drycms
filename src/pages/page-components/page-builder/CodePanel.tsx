import Editer from "../../../components/Editer.js";
import type { EditerResult } from "../../../components/Editer/types.js";
import { useResizablePanel } from "../../../lib/useResizablePanel.js";
import { OpenInNewTabIcon } from "./icons.js";

const PANEL_WIDTH = { initial: 480, min: 320, max: 900 };

export interface CodePanelProps {
  path: string;
  source: string;
  dirty: boolean;
  saving: boolean;
  extraFiles: Record<string, string>;
  onChange: (code: string) => void;
  onSave: () => void;
  onReset: () => void;
  onClose: () => void;
  pageEditorHref: string;
}

/**
 * The Page tab's drag-resizable code panel (`plans/new-ui-page-builder.md`
 * mục 6) - `useResizablePanel` (already used 3x in `PageEditor.tsx`) drives
 * the divider, `Editer` is the same editor component, unmodified. Kept to
 * ONE file's worth of Save/Reset (the currently-previewed `page.tsx`), not
 * `PageEditor.tsx`'s whole-tree save-everything-dirty behavior - Page
 * Builder edits one file at a time by design (mục 10's sanctioned cut).
 */
export default function CodePanel(props: CodePanelProps) {
  const panel = useResizablePanel({ ...PANEL_WIDTH, axis: "x", invert: true });

  function handleChange(result: EditerResult) {
    props.onChange(result.code);
  }

  return (
    <div class="page-builder-code-panel" style={{ width: `${panel.size}px` }}>
      <div class="page-builder-code-panel-handle" {...panel.handleProps} />
      <div class="page-builder-code-panel-header">
        <strong class="page-builder-code-panel-path">{props.path}</strong>
        <a class="icon ghost sm" href={props.pageEditorHref} target="_blank" rel="noopener" title="Open in Page Editor">
          <OpenInNewTabIcon />
        </a>
        <button type="button" class="icon ghost sm" aria-label="Close code panel" onClick={props.onClose}>
          ×
        </button>
      </div>
      <div class="page-builder-code-panel-body">
        <Editer
          key={props.path}
          value={props.source}
          onChange={handleChange}
          extraFiles={props.extraFiles}
          language="tsx"
          style={{ height: "100%" }}
        />
      </div>
      <div class="page-builder-code-panel-footer">
        <button type="button" class="outline" disabled={!props.dirty || props.saving} onClick={props.onReset}>
          Reset
        </button>
        <button type="button" disabled={!props.dirty || props.saving} aria-busy={props.saving} onClick={props.onSave}>
          Save
        </button>
      </div>
    </div>
  );
}
