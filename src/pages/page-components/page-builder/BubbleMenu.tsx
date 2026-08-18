import { useState } from "preact/hooks";
import { PAGES_SOURCE_ROOTS, PAGES_ROOT, COMPONENT_ROOT, STYLES_ROOT, MD_ROOT, isCoreStyleFilePath, rootOf } from "../../../server/app-router/source-roots.js";
import { AddIcon, CloseIcon } from "../../../components/icons/index.js";
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

/** The extension `routes/pages-source.ts`'s `requirePageSourceFileName`
 * accepts for each root - offered as the default so the common case is one
 * word typed, not a path with an extension the server would reject. */
function defaultExtension(rootId: string): string {
  if (rootId === STYLES_ROOT) return ".css";
  if (rootId === MD_ROOT) return ".md";
  return ".tsx";
}

/** Starter content for a brand new file, so a just-created page/component
 * renders something instead of failing the build on an empty module. */
function fileTemplate(rootId: string, path: string): string {
  if (rootId === STYLES_ROOT || rootId === MD_ROOT) return "";
  const leaf = path.slice(path.lastIndexOf("/") + 1).replace(/\.[^.]+$/, "");
  if (rootId === PAGES_ROOT) {
    if (leaf === "layout") return `export default function Layout({ children }: { children?: unknown }) {\n  return <div>{children}</div>;\n}\n`;
    return `export default function Page() {\n  return <main>New page</main>;\n}\n`;
  }
  const componentName = /^[A-Za-z_][\w]*$/.test(leaf) ? leaf : "Component";
  return `export default function ${componentName}() {\n  return <div>${componentName}</div>;\n}\n`;
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
  /** `{ from: null }` = create, `{ from: path }` = rename. `null` = neither
   * form is open. */
  const [form, setForm] = useState<{ from: string | null; value: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

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

  function openCreate() {
    setError(null);
    setForm({ from: null, value: `${props.activeRoot}/` });
  }

  function openRename(path: string) {
    setError(null);
    setForm({ from: path, value: path });
  }

  async function submitForm(event: Event) {
    event.preventDefault();
    if (!form || busy) return;
    const target = form.value.trim().replace(/^\/+|\/+$/g, "");
    if (!target || target === form.from) {
      setForm(null);
      return;
    }
    // Any of the four roots is fair game, not just the tab that happens to
    // be open - a path typed here names where the file goes, and the tree
    // follows it (`onRootChange` below) rather than the other way round.
    const targetRoot = rootOf(target)?.id;
    if (!targetRoot || target === targetRoot) {
      setError(`Path must start with one of: ${PAGES_SOURCE_ROOTS.map((root) => `${root.id}/`).join(", ")}.`);
      return;
    }
    if (form.from === null && target in props.sourceByPath) {
      setError(`"${target}" already exists.`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Switch tabs BEFORE the write, not after: creating a file closes this
      // menu (the caller opens the new file instead), and switching after
      // that would pop it straight back open.
      if (targetRoot !== props.activeRoot) props.onRootChange(targetRoot);
      if (form.from === null) await props.onCreateFile(target, fileTemplate(targetRoot, target));
      else await props.onRenameFile(form.from, target);
      setForm(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The operation failed.");
    } finally {
      setBusy(false);
    }
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
        <button type="button" class="icon ghost sm" aria-label="New file" title={`New file in ${props.activeRoot}/`} onClick={openCreate}>
          <AddIcon />
        </button>
        <button type="button" class="icon ghost sm" aria-label="Close menu" onClick={props.onClose}>
          <CloseIcon />
        </button>
      </div>

      {form && (
        <form class="page-builder-bubble-form" onSubmit={(event) => void submitForm(event)}>
          <input
            type="text"
            autoFocus
            value={form.value}
            placeholder={form.from === null ? `${props.activeRoot}/about/page${defaultExtension(props.activeRoot)}` : undefined}
            aria-label={form.from === null ? "New file path" : "New path"}
            aria-invalid={error ? "true" : undefined}
            onInput={(event) => setForm({ ...form, value: (event.target as HTMLInputElement).value })}
            onKeyDown={(event) => {
              if (event.key === "Escape") setForm(null);
            }}
          />
          <button type="submit" class="sm" disabled={busy}>
            {form.from === null ? "Create" : "Rename"}
          </button>
          <button type="button" class="ghost sm" disabled={busy} onClick={() => setForm(null)}>
            Cancel
          </button>
          {error && <small class="error">{error}</small>}
        </form>
      )}

      {props.activeRoot === STYLES_ROOT && props.recoveredCoreFiles.length > 0 && (
        <SystemFilesPanel recovered={props.recoveredCoreFiles} onOpen={props.onSelectOtherFile} />
      )}

      <BubbleFileTree
        sourceByPath={props.sourceByPath}
        activeRoot={props.activeRoot}
        activePath={props.activePath}
        onSelectFile={handleSelectFile}
        onRenameFile={openRename}
        // `globals.css`/`theme.css`/`base.css` are delete-locked server-side
        // too (`routes/pages-source.ts`) - hiding the button keeps the UI
        // from offering an action that can only ever fail.
        canDelete={(path) => !isCoreStyleFilePath(path)}
        onDeleteFile={setPendingDelete}
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
