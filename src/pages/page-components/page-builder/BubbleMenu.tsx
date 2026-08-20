import { useState } from "preact/hooks";
import { PAGES_SOURCE_ROOTS, PAGES_ROOT, COMPONENT_ROOT, STYLES_ROOT, MD_ROOT, isCoreStyleFilePath } from "../../../server/app-router/source-roots.js";
import { PlusIcon, UploadIcon, XIcon } from "../../../components/icons/index.js";
import { FolderComponentsIcon, FolderCssIcon, FolderMarkdownIcon, FolderRoutesIcon } from "../file-type-icons.js";
import ConfirmDialog from "../../../components/ConfirmDialog.js";
import SystemFilesPanel from "../core-styles/SystemFilesPanel.js";
import BubbleFileTree from "./BubbleFileTree.js";

/** Same root -> icon mapping `PageBuilder.tsx`'s own local `sourceRootIcon`
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
  activePath: string | null;
  onRootChange: (root: string) => void;
  /** A `pages/**\/page.tsx` route file - the caller resolves it to a real
   * `?path=` pathname (static match, or the dynamic-template +
   * entry-picker fallback, `plans/new-ui-page-builder.md` mục 6/cạm bẫy 4)
   * since that needs the route manifest this component doesn't own. */
  onSelectPageFile: (entryPath: string) => void;
  /** Any OTHER `.tsx` file - a layout/`404.tsx`/`500.tsx` under `pages/`, or
   * a `component/*.tsx` - opens in the same `CodePanel` the page.tsx flow
   * above uses, without touching the preview's own pathname. */
  onSelectComponentFile: (path: string) => void;
  /** A `styles/*.css`/`md/*.md` file - opens `FileDialog`. */
  onSelectOtherFile: (path: string) => void;
  /** Built-in `styles/` files this session had to recreate - announced above
   * the styles tree (`core-styles/SystemFilesPanel.tsx`), nowhere else. */
  recoveredCoreFiles: string[];
  onCreateFile: (path: string, code: string) => Promise<void>;
  onRenameFile: (from: string, to: string) => Promise<void>;
  onDeleteFile: (path: string) => Promise<void>;
  /** Right-click "Build" on one `pages/**\/page.tsx` file - builds and
   * publishes just the pathname(s) it resolves to. */
  onBuildFile: (entryPath: string) => void;
  /** Right-click "Build" on a folder - every `page.tsx` nested under it. */
  onBuildFolder: (folderPath: string) => void;
  /** Header "Build all" button, next to "+" - every page on the site. */
  onBuildAll: () => void;
  onClose: () => void;
}

/**
 * The bubble popup `plans/new-ui-page-builder.md` mục 5/15 describes: one tab
 * per `PAGES_SOURCE_ROOTS` entry, an expandable folder tree under whichever
 * is active - `BubbleFileTree.tsx`, reusing the SAME tree component/CSS Page
 * Editor's own `ComponentTreePanel` sidebar used (`page-components-tree*`).
 *
 * Now the ONLY place page source can be created, renamed or deleted from the
 * UI (Page Editor, which used to own that, is gone) - the operations
 * themselves live behind `use-page-builder-source.ts`'s
 * `createFile`/`renameFile`/`deleteFile`, so this component only collects a
 * path and confirms a destructive action.
 */
export default function BubbleMenu(props: BubbleMenuProps) {
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  /** Bumped on every "+" click - `BubbleFileTree` owns the actual create UI
   * (which folder it targets, the inline text box) since that's a tree
   * rendering concern, not this header's. */
  const [createSignal, setCreateSignal] = useState(0);

  function handleSelectFile(path: string) {
    // `page.tsx` navigates the preview to it; every other `.tsx`
    // (`layout.tsx`/`404.tsx`/`500.tsx`, or a `component/*.tsx`) still opens
    // in the SAME `CodePanel` but leaves the preview's pathname alone - it
    // has no single route of its own to navigate to. Only `.css`/`.md`
    // still go to `FileDialog`.
    if (props.activeRoot === PAGES_ROOT && /(^|\/)page\.tsx$/.test(path)) props.onSelectPageFile(path);
    else if (path.endsWith(".tsx")) props.onSelectComponentFile(path);
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
        {props.activeRoot === PAGES_ROOT && (
          <button type="button" class="icon ghost sm" aria-label="Build all pages" title="Build and publish every page" onClick={props.onBuildAll}>
            <UploadIcon />
          </button>
        )}
        <button type="button" class="icon ghost sm" aria-label="New file" title={`New file in ${props.activeRoot}/`} onClick={() => setCreateSignal((n) => n + 1)}>
          <PlusIcon />
        </button>
        <button type="button" class="icon ghost sm" aria-label="Close menu" onClick={props.onClose}>
          <XIcon />
        </button>
      </div>

      {props.activeRoot === STYLES_ROOT && props.recoveredCoreFiles.length > 0 && (
        <SystemFilesPanel recovered={props.recoveredCoreFiles} onOpen={props.onSelectOtherFile} />
      )}

      <BubbleFileTree
        sourceByPath={props.sourceByPath}
        activeRoot={props.activeRoot}
        activePath={props.activePath}
        onSelectFile={handleSelectFile}
        onCreateFile={props.onCreateFile}
        onRenameFile={props.onRenameFile}
        createSignal={createSignal}
        // `globals.css`/`theme.css`/`base.css` are delete-locked server-side
        // too (`routes/pages-source.ts`) - hiding the button keeps the UI
        // from offering an action that can only ever fail.
        canDelete={(path) => !isCoreStyleFilePath(path)}
        onDeleteFile={setPendingDelete}
        onBuildFile={props.onBuildFile}
        onBuildFolder={props.onBuildFolder}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete "${pendingDelete ?? ""}"?`}
        message="This cannot be undone. Pages that import it will fail to build until they are updated."
        confirmLabel="Delete"
        destructive
        busy={busy}
        onConfirm={() => {
          const target = pendingDelete;
          if (!target) return;
          setBusy(true);
          void props
            .onDeleteFile(target)
            .catch(() => undefined)
            .finally(() => {
              setBusy(false);
              setPendingDelete(null);
            });
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
