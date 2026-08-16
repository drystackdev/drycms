import { useEffect, useState } from "preact/hooks";
import Editer from "../../../components/Editer.js";
import type { EditerDiagnostic, EditerResult } from "../../../components/Editer/types.js";
import { useResizablePanel } from "../../../lib/useResizablePanel.js";
import { ArrowRightIcon } from "../../../components/icons/index.js";

const PANEL_WIDTH = { initial: 480, min: 320, max: 900 };
const DIAGNOSTICS_HEIGHT = { initial: 160, min: 80, max: 360 };

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
  onWidthChange: (width: number) => void;
  initialWidth: number;
  layoutPaths: string[];
  onOpenLayout: (path: string) => void;
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
  const panel = useResizablePanel({
    ...PANEL_WIDTH,
    initial: Math.min(PANEL_WIDTH.max, Math.max(PANEL_WIDTH.min, props.initialWidth)),
    axis: "x",
    invert: true,
    onSizeChange: props.onWidthChange,
  });
  const diagnosticsPanel = useResizablePanel({ ...DIAGNOSTICS_HEIGHT, axis: "y", invert: true });
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(true);
  const [diagnostics, setDiagnostics] = useState<EditerDiagnostic[]>([]);

  useEffect(() => setDiagnostics([]), [props.path]);

  function handleChange(result: EditerResult) {
    props.onChange(result.code);
    setDiagnostics(result.errors);
  }

  const errorCount = diagnostics.filter((diagnostic) => diagnostic.source === "syntax").length;
  const warningCount = diagnostics.length - errorCount;

  return (
    <div class="page-builder-code-panel" style={{ width: `${panel.size}px` }}>
      <div class="page-builder-code-panel-handle" {...panel.handleProps} />
      <div class="page-builder-code-panel-header">
        <strong class="page-builder-code-panel-path">{props.path}</strong>
        <button type="button" class="outline sm" disabled={!props.dirty || props.saving} onClick={props.onReset}>
          Reset
        </button>
        <button type="button" class="sm page-builder-code-panel-save" disabled={!props.dirty || props.saving} aria-busy={props.saving} onClick={props.onSave}>
          Save
        </button>
        <button type="button" class="ghost sm" onClick={props.onClose}>
          Cancel
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
      {diagnosticsOpen && (
        <div
          class={`page-components-resize-handle horizontal${diagnosticsPanel.dragging ? " dragging" : ""}`}
          {...diagnosticsPanel.handleProps}
        />
      )}
      <div class="page-editor-diagnostics" style={diagnosticsOpen ? { height: `${diagnosticsPanel.size}px` } : undefined}>
        <div class="page-editor-diagnostics-header">
          <button
            type="button"
            class="page-editor-diagnostics-toggle"
            aria-expanded={diagnosticsOpen}
            aria-label={diagnosticsOpen ? "Collapse problems panel" : "Expand problems panel"}
            onClick={() => setDiagnosticsOpen((open) => !open)}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
              <path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9.343 6.343L15 12l-5.657 5.657" />
            </svg>
          </button>
          {errorCount === 0 && warningCount === 0 ? (
            <span class="hint">No problems</span>
          ) : (
            <>
              {errorCount > 0 && <span class="badge sm destructive">{errorCount} error{errorCount === 1 ? "" : "s"}</span>}
              {warningCount > 0 && <span class="badge sm warning">{warningCount} warning{warningCount === 1 ? "" : "s"}</span>}
            </>
          )}
        </div>
        {diagnosticsOpen && (
          diagnostics.length > 0 ? (
            <ul class="page-editor-diagnostics-list">
              {diagnostics.map((diagnostic, index) => (
                <li key={index} class={diagnostic.source === "syntax" ? "error" : "warning"}>
                  <span class="page-editor-diagnostics-location">{diagnostic.line}:{diagnostic.column}</span>
                  <span>{diagnostic.message}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p class="hint" style={{ padding: "0.5rem" }}>No problems detected.</p>
          )
        )}
      </div>
      <div class="page-builder-code-panel-layouts">
        <span class="hint">Layouts</span>
        {props.layoutPaths.length > 0 ? props.layoutPaths.map((layoutPath) => (
          <span class="page-builder-code-panel-layout-crumb" key={layoutPath}>
            <ArrowRightIcon />
            <button type="button" class="ghost sm" title={`Edit ${layoutPath}`} onClick={() => props.onOpenLayout(layoutPath)}>
              {layoutPath}
            </button>
          </span>
        )) : <span class="hint">No layout</span>}
      </div>
    </div>
  );
}
