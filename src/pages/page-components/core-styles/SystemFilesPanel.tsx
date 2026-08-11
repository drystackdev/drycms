import { STYLES_ROOT } from "../../../server/app-router/source-roots.js";
import { CORE_STYLE_FILES } from "./registry.js";

interface SystemFilesPanelProps {
  /** Core `styles/` filenames `PageEditor.tsx`'s `loadTree` found missing
   * this session and recreated with their default content - what this tab
   * exists to announce. */
  recovered: string[];
  onOpen: (path: string) => void;
}

/** Stands in for `ComponentTreePanel` when the sidebar's "System" tab is
 * active (`PageEditor.tsx`) - that tab only ever appears right after a
 * recovery (see `recovered`'s doc comment), so unlike the other 3 tabs it
 * has no file tree of its own, just a card per file that was just restored. */
export default function SystemFilesPanel({ recovered, onOpen }: SystemFilesPanelProps) {
  const files = CORE_STYLE_FILES.filter((file) => recovered.includes(file.name));
  return (
    <div class="page-editor-system-panel scroll">
      <p class="hint page-editor-system-intro">
        These built-in files were missing and have been recreated with their default content.
      </p>
      {files.map((file) => (
        <div key={file.name} class="card page-editor-system-card">
          <file.Card />
          <button type="button" class="ghost sm" onClick={() => onOpen(`${STYLES_ROOT}/${file.name}`)}>
            Open in Styles
          </button>
        </div>
      ))}
    </div>
  );
}
