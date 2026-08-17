import { STYLES_ROOT } from "../../../server/app-router/source-roots.js";
import { CORE_STYLE_FILES } from "./registry.js";

interface SystemFilesPanelProps {
  /** Core `styles/` filenames Page Builder found missing this session and
   * recreated with their default content (`PageBuilder.tsx`'s recovery
   * effect) - what this panel exists to announce. */
  recovered: string[];
  onOpen: (path: string) => void;
}

/** Shown above the styles tree in Page Builder's file menu, and only right
 * after a recovery (see `recovered`'s doc comment) - a card per file that
 * was just restored, not a tree. */
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
