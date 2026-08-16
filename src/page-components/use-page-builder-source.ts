import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { createPagesSourceApi } from "./pages-source-http-api.js";
import { loadAllPagesSource } from "./pages-source-http.js";

/**
 * Page Builder's own, deliberately minimal tree/draft/save-reset state -
 * `plans/new-ui-page-builder.md` mục 10's sanctioned cut: `PageEditor.tsx`'s
 * own version of this (IndexedDB draft persistence, optimistic cache-first
 * hydration, a bounded-concurrency background sync pool) is real, tested
 * behavior this hook does NOT attempt to duplicate or share - only the
 * genuinely reusable, mostly-pure "call `buildPage()`, turn the result into
 * a `srcdoc`" half moved into `page-preview-engine.ts`. This is real,
 * accepted tech debt: a Page Builder session's unsaved edits live in
 * memory only (a reload loses them, same as this file never having existed),
 * unlike Page Editor's local-draft recovery. Revisit if that gap turns out
 * to matter in practice.
 *
 * Loads every pages-source file's content ONCE via `loadAllPagesSource`
 * (`PageBuild.tsx`'s own loader - a flat `Record<path, content>`, no
 * `FileEntry` tree), then tracks in-memory edits against that saved
 * baseline. `save`/`reset` operate on ONE path at a time (Page Builder edits
 * one file's code at a time, either the Page tab's `CodePanel` or a
 * `FileDialog`), unlike `PageEditor.tsx`'s `handleSave` (saves every dirty
 * file at once, needed there because Magic Chat can touch files other than
 * the open one - a scenario that doesn't exist here, mục "Không làm ở lần
 * này").
 */
export interface UsePageBuilderSourceResult {
  /** `null` while the initial load is in flight. */
  sourceByPath: Record<string, string> | null;
  loading: boolean;
  error: string | null;
  /** Live in-memory edit, not yet saved. */
  updateSource: (path: string, code: string) => void;
  /** `true` when `path`'s in-memory content differs from what's on storage. */
  isDirty: (path: string) => boolean;
  save: (path: string) => Promise<void>;
  reset: (path: string) => void;
  saving: boolean;
  dirtyPaths: string[];
  /** Registers a brand new path (Page Builder itself never creates files -
   * this is here only so a resolved-but-not-yet-loaded path, e.g. right
   * after `save()` creates one, can be read back without a full reload). */
  reload: () => Promise<void>;
}

export function usePageBuilderSource(adminPath: string, enabled = true): UsePageBuilderSourceResult {
  const [sourceByPath, setSourceByPath] = useState<Record<string, string> | null>(null);
  const [savedByPath, setSavedByPath] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const api = useMemo(() => createPagesSourceApi(`${adminPath}/api/pages-source`), [adminPath]);

  const reload = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const source = await loadAllPagesSource(adminPath);
      setSourceByPath(source);
      setSavedByPath(source);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load pages source.");
    } finally {
      setLoading(false);
    }
  }, [adminPath, enabled]);

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adminPath, enabled]);

  const updateSource = useCallback((filePath: string, code: string) => {
    setSourceByPath((prev) => (prev && prev[filePath] === code ? prev : { ...prev, [filePath]: code }));
  }, []);

  const isDirty = useCallback(
    (filePath: string) => !!sourceByPath && sourceByPath[filePath] !== savedByPath[filePath],
    [sourceByPath, savedByPath],
  );

  const save = useCallback(
    async (filePath: string) => {
      if (!sourceByPath) return;
      const code = sourceByPath[filePath] ?? "";
      if (code === savedByPath[filePath]) return;
      setSaving(true);
      try {
        await api.save(filePath, code);
        setSavedByPath((prev) => ({ ...prev, [filePath]: code }));
      } finally {
        setSaving(false);
      }
    },
    [api, sourceByPath, savedByPath],
  );

  const reset = useCallback(
    (filePath: string) => {
      setSourceByPath((prev) => (prev ? { ...prev, [filePath]: savedByPath[filePath] ?? "" } : prev));
    },
    [savedByPath],
  );

  const dirtyPaths = useMemo(
    () => (sourceByPath ? Object.keys(sourceByPath).filter((filePath) => sourceByPath[filePath] !== savedByPath[filePath]) : []),
    [sourceByPath, savedByPath],
  );

  return { sourceByPath, loading, error, updateSource, isDirty, save, reset, saving, dirtyPaths, reload };
}
