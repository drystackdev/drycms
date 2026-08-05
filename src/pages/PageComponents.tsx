import { useEffect, useMemo, useState } from "preact/hooks";
import type { ComponentType } from "preact";
const { path } = window.__DRY_CONFIG__;
import ConfirmDialog from "../components/ConfirmDialog.js";
import Editer from "../components/Editer.js";
import type { EditerResult } from "../components/Editer/types.js";
import type { FileEntry } from "../storage/entry-types.js";
import { MenuIcon } from "../components/icons/index.js";
import { toast } from "../components/Toast.js";
import { useResizablePanel } from "../lib/useResizablePanel.js";
import { rewriteImportsAfterMove } from "../page-components/import-rewrite.js";
import { createPageComponentsApi } from "../page-components/http-api.js";
import { evalPageComponent } from "../page-components/sucrase-eval.js";
import { useDocumentTitle } from "./page-common.js";
import ComponentPreview from "./page-components/ComponentPreview.js";
import ComponentTreePanel from "./page-components/ComponentTreePanel.js";
import DevicePickerControls from "./page-components/DevicePickerControls.js";
import { useDevicePreview } from "./page-components/useDevicePreview.js";

const DEFAULT_COMPONENT_SOURCE = `export default function () {
  return <div></div>;
}
`;

const SIDEBAR_WIDTH = { initial: 280, min: 200, max: 480 };
const PREVIEW_HEIGHT = { initial: 320, min: 120, max: 640 };

/**
 * Component Builder (`plans/component-builder.md`): write/save/preview
 * standalone `.tsx` components for a future page builder - this page only
 * owns that loop, not where the components end up being used.
 */
export default function PageComponents() {
  useDocumentTitle("Page Components");
  const api = useMemo(() => createPageComponentsApi(`${path}/api/page-components`), []);

  const [entries, setEntries] = useState<FileEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sourceByPath, setSourceByPath] = useState<Record<string, string>>({});
  const [savedByPath, setSavedByPath] = useState<Record<string, string>>({});
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<FileEntry | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  const sidebar = useResizablePanel({ ...SIDEBAR_WIDTH, axis: "x" });
  const previewSplit = useResizablePanel({ ...PREVIEW_HEIGHT, axis: "y" });
  const devicePreview = useDevicePreview();

  async function loadTree() {
    try {
      const result = await api.listTree();
      if (!result.supported) {
        setLoadError("This storage backend doesn't support listing the whole component tree.");
        return;
      }
      setEntries(result.entries);
      const files = result.entries.filter((entry) => entry.kind === "file");
      const contents = await Promise.all(files.map((file) => api.read(file.id).catch(() => "")));
      const nextSource: Record<string, string> = {};
      files.forEach((file, index) => {
        nextSource[file.id] = contents[index]!;
      });
      setSourceByPath(nextSource);
      setSavedByPath(nextSource);
      setSelectedPath((current) => {
        if (current && nextSource[current] !== undefined) return current;
        return files.length > 0 ? files[0]!.id : null;
      });
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Failed to load components.");
    }
  }

  useEffect(() => {
    loadTree();
  }, []);

  const code = selectedPath ? (sourceByPath[selectedPath] ?? "") : "";
  const dirty = !!selectedPath && sourceByPath[selectedPath] !== savedByPath[selectedPath];

  /** Every OTHER loaded file - `Editer`'s ambient reference set for
   * cross-file TS resolution, same shape `CodeEditerDemo.tsx` builds. */
  const extraFiles = useMemo(() => {
    if (!selectedPath) return sourceByPath;
    const rest = { ...sourceByPath };
    delete rest[selectedPath];
    return rest;
  }, [sourceByPath, selectedPath]);

  const [preview, previewError] = useMemo((): [ComponentType<any> | null, string | null] => {
    if (!selectedPath || !(selectedPath in sourceByPath)) return [null, null];
    try {
      return [evalPageComponent(selectedPath, sourceByPath), null];
    } catch (error) {
      return [null, error instanceof Error ? error.message : "Failed to render preview."];
    }
  }, [selectedPath, sourceByPath]);

  function handleChange(result: EditerResult) {
    if (!selectedPath) return;
    setSourceByPath((prev) => (prev[selectedPath] === result.code ? prev : { ...prev, [selectedPath]: result.code }));
  }

  async function handleSave() {
    if (!selectedPath) return;
    setSaving(true);
    try {
      await api.save(selectedPath, sourceByPath[selectedPath] ?? "");
      setSavedByPath((prev) => ({ ...prev, [selectedPath]: sourceByPath[selectedPath] ?? "" }));
      toast.add({ type: "success", title: "Saved." });
    } catch (error) {
      toast.add({ type: "error", title: "Save failed", description: error instanceof Error ? error.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateFile(name: string) {
    const filePath = /\.tsx?$/i.test(name) ? name : `${name}.tsx`;
    try {
      await api.save(filePath, DEFAULT_COMPONENT_SOURCE);
      await loadTree();
      setSelectedPath(filePath);
      toast.add({ type: "success", title: `Created "${filePath}".` });
    } catch (error) {
      toast.add({ type: "error", title: "Failed to create component", description: error instanceof Error ? error.message : undefined });
    }
  }

  async function handleCreateFolder(name: string) {
    try {
      const segments = name.split("/");
      const leaf = segments.pop()!;
      await api.mkdir(segments.join("/"), leaf);
      await loadTree();
      toast.add({ type: "success", title: `Created folder "${name}".` });
    } catch (error) {
      toast.add({ type: "error", title: "Failed to create folder", description: error instanceof Error ? error.message : undefined });
    }
  }

  async function handleDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await api.remove(pendingDelete.id);
      if (selectedPath === pendingDelete.id) setSelectedPath(null);
      setPendingDelete(null);
      await loadTree();
      toast.add({ type: "success", title: "Deleted." });
    } catch (error) {
      toast.add({ type: "error", title: "Delete failed", description: error instanceof Error ? error.message : undefined });
    } finally {
      setDeleting(false);
    }
  }

  /** Move (rename or drag into another folder) - also recomputes any
   * relative import affected by the path change (see `import-rewrite.ts`)
   * and persists those alongside the move itself, not just in the open
   * editor buffer. */
  async function handleMove(from: string, to: string) {
    if (from === to) return;
    try {
      const rewrites = rewriteImportsAfterMove(sourceByPath, from, to);
      await api.move(from, to);
      if (rewrites[to] !== undefined) await api.save(to, rewrites[to]);
      for (const [otherPath, content] of Object.entries(rewrites)) {
        if (otherPath !== to) await api.save(otherPath, content);
      }
      if (selectedPath === from) setSelectedPath(to);
      await loadTree();
      toast.add({ type: "success", title: `Moved to "${to}".` });
    } catch (error) {
      toast.add({ type: "error", title: "Move failed", description: error instanceof Error ? error.message : undefined });
    }
  }

  if (loadError) return <span class="error">{loadError}</span>;
  if (entries === null) return <span class="hint">Loading…</span>;

  return (
    <div class="page-components-shell">
      <div class="page-components-toolbar">
        <button type="button" class="ghost icon sm" aria-label={sidebarOpen ? "Hide sidebar" : "Show sidebar"} aria-pressed={sidebarOpen} onClick={() => setSidebarOpen((v) => !v)}>
          <MenuIcon />
        </button>
        <DevicePickerControls preview={devicePreview} />
        <div class="spacer" />
        {selectedPath && (
          <button type="button" class="sm" disabled={!dirty || saving} aria-busy={saving} onClick={handleSave}>
            Save
          </button>
        )}
      </div>

      <div class="page-components-body">
        {sidebarOpen && (
          <>
            <div style={{ width: `${sidebar.size}px` }}>
              <ComponentTreePanel
                entries={entries}
                selectedPath={selectedPath}
                onSelect={setSelectedPath}
                onCreateFile={handleCreateFile}
                onCreateFolder={handleCreateFolder}
                onDelete={setPendingDelete}
                onMove={handleMove}
              />
            </div>
            <div class={`page-components-resize-handle${sidebar.dragging ? " dragging" : ""}`} {...sidebar.handleProps} />
          </>
        )}

        <div class="page-components-main">
          <div style={{ height: `${previewSplit.size}px` }}>
            <ComponentPreview Component={preview} error={previewError} preview={devicePreview} />
          </div>
          <div class={`page-components-resize-handle horizontal${previewSplit.dragging ? " dragging" : ""}`} {...previewSplit.handleProps} />
          <div class="page-components-editor">
            {selectedPath ? (
              <Editer key={selectedPath} value={code} onChange={handleChange} extraFiles={extraFiles} style={{ height: "100%" }} />
            ) : (
              <p class="hint">Select or create a component on the left to edit it.</p>
            )}
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete "${pendingDelete?.name ?? ""}"?`}
        message={
          pendingDelete?.kind === "folder"
            ? "This deletes the folder and everything inside it. This cannot be undone."
            : "This cannot be undone."
        }
        confirmLabel="Delete"
        destructive
        busy={deleting}
        onConfirm={handleDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
