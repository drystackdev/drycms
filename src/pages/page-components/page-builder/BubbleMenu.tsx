import { PAGES_SOURCE_ROOTS, PAGES_ROOT, COMPONENT_ROOT, STYLES_ROOT, MD_ROOT } from "../../../server/app-router/source-roots.js";
import { FolderComponentsIcon, FolderCssIcon, FolderMarkdownIcon, FolderRoutesIcon } from "../file-type-icons.js";
import BubbleFileTree from "./BubbleFileTree.js";

/** Same root -> icon mapping `PageEditor.tsx`'s own local `sourceRootIcon`
 * uses, for the same reason (`PAGES_SOURCE_ROOTS` is deliberately
 * dependency-free, so this mapping can't live on it directly). */
function sourceRootIcon(rootId: string) {
  switch (rootId) {
    case COMPONENT_ROOT:
      return <FolderComponentsIcon />;
    case STYLES_ROOT:
      return <FolderCssIcon />;
    case MD_ROOT:
      return <FolderMarkdownIcon />;
    default:
      return <FolderRoutesIcon />;
  }
}

export interface BubbleMenuProps {
  sourceByPath: Record<string, string>;
  activeRoot: string;
  onRootChange: (root: string) => void;
  /** A file in the `pages/` root - the caller resolves it to a real `?path=`
   * pathname (static match, or the dynamic-template + entry-picker fallback,
   * `plans/new-ui-page-builder.md` mục 6/cạm bẫy 4) since that needs the
   * route manifest this component doesn't own. */
  onSelectPageFile: (entryPath: string) => void;
  /** A file in `component/`/`styles/`/`md/` - opens `FileDialog`. */
  onSelectOtherFile: (path: string) => void;
  onClose: () => void;
}

/**
 * The bubble popup `plans/new-ui-page-builder.md` mục 5/15 describes: one tab
 * per `PAGES_SOURCE_ROOTS` entry, an expandable folder tree under whichever
 * is active - `BubbleFileTree.tsx`, reusing the SAME tree component/CSS Page
 * Editor's own `ComponentTreePanel` sidebar uses (`page-components-tree*`),
 * minus every write operation (create/rename/delete/move/paste) this popup
 * doesn't need.
 */
export default function BubbleMenu(props: BubbleMenuProps) {
  function handleSelectFile(path: string) {
    // Only `page.tsx` files go to the preview+CodePanel flow -
    // `layout.tsx`/`404.tsx`/`500.tsx` (also under `pages/`) have no single
    // pathname of their own to preview against, so they open in `FileDialog`
    // like every other non-page file.
    if (props.activeRoot === PAGES_ROOT && /(^|\/)page\.tsx$/.test(path)) props.onSelectPageFile(path);
    else props.onSelectOtherFile(path);
  }

  return (
    <div class="page-builder-bubble-menu" role="dialog" aria-label="Page source files">
      <div class="page-builder-bubble-tabs" role="tablist">
        {PAGES_SOURCE_ROOTS.map((root) => (
          <button
            type="button"
            key={root.id}
            role="tab"
            class="icon ghost sm"
            aria-selected={props.activeRoot === root.id}
            title={root.label}
            onClick={() => props.onRootChange(root.id)}
          >
            {sourceRootIcon(root.id)}
          </button>
        ))}
        <span class="spacer" />
        <button type="button" class="icon ghost sm" aria-label="Close menu" onClick={props.onClose}>
          ×
        </button>
      </div>
      <BubbleFileTree sourceByPath={props.sourceByPath} activeRoot={props.activeRoot} onSelectFile={handleSelectFile} />
    </div>
  );
}
