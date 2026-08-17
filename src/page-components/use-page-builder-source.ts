import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { createPagesSourceApi } from "./pages-source-http-api.js";
import { rewriteImportsAfterMove } from "./import-rewrite.js";
import { loadAllPagesSource } from "./pages-source-http.js";

const PAGES_SOURCE_BROWSER_EVENT = "dry:pages-source-change";

function sameSourceSnapshot(left: Record<string, string>, right: Record<string, string>): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length && leftKeys.every((key) => left[key] === right[key]);
}

export function mergeExternalSourceSnapshot(
  current: Record<string, string>,
  fresh: Record<string, string>,
  locallyEditedPaths: ReadonlySet<string>,
): Record<string, string> {
  const merged = { ...fresh };
  for (const filePath of locallyEditedPaths) {
    if (filePath in current) merged[filePath] = current[filePath]!;
  }
  return sameSourceSnapshot(current, merged) ? current : merged;
}

/**
 * Page Builder's own, deliberately minimal tree/draft/save-reset state -
 * `plans/new-ui-page-builder.md` mục 10's sanctioned cut: `PageBuilder.tsx`'s
 * own version of this (IndexedDB draft persistence, optimistic cache-first
 * hydration, a bounded-concurrency background sync pool) is real, tested
 * behavior this hook does NOT attempt to duplicate or share - only the
 * genuinely reusable, mostly-pure "call `buildPage()`, turn the result into
 * a `srcdoc`" half moved into `page-preview-engine.ts`. This is real,
 * accepted tech debt: a Page Builder session's unsaved edits live in
 * memory only (a reload loses them), unlike the deleted Page Editor's
 * IndexedDB draft recovery. Revisit if that gap turns out to matter in
 * practice.
 *
 * Loads every pages-source file's content ONCE via `loadAllPagesSource`
 * (`PageBuild.tsx`'s own loader - a flat `Record<path, content>`, no
 * `FileEntry` tree), then tracks in-memory edits against that saved
 * baseline. `save`/`reset` operate on ONE path at a time (the Page tab's
 * `CodePanel`, or a `FileDialog`); saving EVERY dirty path at once is
 * `PageBuilder.tsx`'s `saveAndPublish` job instead, walking `dirtyPaths` -
 * which matters because Magic Chat can touch files other than the open one
 * (`status/magic-chat-multifile.md`).

 * `createFile`/`renameFile`/`deleteFile` write through to storage
 * immediately (there is no "dirty" state a new/renamed/deleted file could
 * sit in), and are the ONE seam every structural change goes through, so a
 * future backend swap has a single place to change.
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
  /** Writes an empty (or templated) file straight to storage and adds it to
   * the tree - unlike `updateSource`, a brand-new file has nothing to be
   * dirty against, so this is immediate rather than deferred to Save. */
  createFile: (path: string, code?: string) => Promise<void>;
  /** Move/rename one FILE, rewriting every relative import that pointed at
   * it (and its own, since its directory changed) - `import-rewrite.ts`,
   * the same helper Page Editor used. Rewritten files are saved too, so the
   * tree is never left half-renamed. */
  renameFile: (from: string, to: string) => Promise<void>;
  deleteFile: (path: string) => Promise<void>;
  /** Re-reads the whole tree from storage, discarding local edits. */
  reload: () => Promise<void>;
}

export function usePageBuilderSource(adminPath: string, enabled = true): UsePageBuilderSourceResult {
  const [sourceByPath, setSourceByPath] = useState<Record<string, string> | null>(null);
  const [savedByPath, setSavedByPath] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [locallyEditedPaths, setLocallyEditedPaths] = useState<Set<string>>(() => new Set());
  // The exact storage content from when a local edit began. `savedByPath`
  // may advance when HMR/polling observes an external VS Code save while
  // the local buffer is deliberately preserved, so it cannot also serve as
  // the optimistic-concurrency base for that buffer.
  const editBaseByPathRef = useRef<Record<string, string>>({});

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

  useEffect(() => {
    if (!enabled || !import.meta.env.DEV) return;
    let refreshing = false;
    const refreshExternalChange = () => {
      if (refreshing) return;
      refreshing = true;
      void (async () => {
        try {
          const fresh = await loadAllPagesSource(adminPath, "no-store");
          setSavedByPath((previousSaved) => {
            setSourceByPath((current) => {
              if (!current) return fresh;
              // An external save wins everywhere except a file explicitly
              // edited in Page Builder itself.
              return mergeExternalSourceSnapshot(current, fresh, locallyEditedPaths);
            });
            return sameSourceSnapshot(previousSaved, fresh) ? previousSaved : fresh;
          });
          setError(null);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed to refresh pages source.");
        } finally {
          refreshing = false;
        }
      })();
    };
    window.addEventListener(PAGES_SOURCE_BROWSER_EVENT, refreshExternalChange);
    // The semantic HMR event is the fast path. Polling is a dev-only safety
    // net for a tab that stayed open across a Vite server restart and thus
    // missed the new subscription; no IndexedDB cache participates here.
    refreshExternalChange();
    const timer = window.setInterval(refreshExternalChange, 1_000);
    return () => {
      window.removeEventListener(PAGES_SOURCE_BROWSER_EVENT, refreshExternalChange);
      window.clearInterval(timer);
    };
  }, [adminPath, enabled, locallyEditedPaths]);

  const updateSource = useCallback((filePath: string, code: string) => {
    setSourceByPath((prev) => (prev && prev[filePath] === code ? prev : { ...prev, [filePath]: code }));
    setLocallyEditedPaths((previous) => {
      const shouldBeDirty = code !== savedByPath[filePath];
      if (previous.has(filePath) === shouldBeDirty) return previous;
      const next = new Set(previous);
      if (shouldBeDirty) {
        editBaseByPathRef.current[filePath] = savedByPath[filePath] ?? "";
        next.add(filePath);
      } else {
        delete editBaseByPathRef.current[filePath];
        next.delete(filePath);
      }
      return next;
    });
  }, [savedByPath]);

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
        await api.save(filePath, code, editBaseByPathRef.current[filePath] ?? savedByPath[filePath] ?? "");
        setSavedByPath((prev) => ({ ...prev, [filePath]: code }));
        delete editBaseByPathRef.current[filePath];
        setLocallyEditedPaths((previous) => {
          if (!previous.has(filePath)) return previous;
          const next = new Set(previous);
          next.delete(filePath);
          return next;
        });
      } finally {
        setSaving(false);
      }
    },
    [api, sourceByPath, savedByPath],
  );

  const reset = useCallback(
    (filePath: string) => {
      setSourceByPath((prev) => (prev ? { ...prev, [filePath]: savedByPath[filePath] ?? "" } : prev));
      delete editBaseByPathRef.current[filePath];
      setLocallyEditedPaths((previous) => {
        if (!previous.has(filePath)) return previous;
        const next = new Set(previous);
        next.delete(filePath);
        return next;
      });
    },
    [savedByPath],
  );

  const dirtyPaths = useMemo(
    () => (sourceByPath ? [...locallyEditedPaths].filter((filePath) => sourceByPath[filePath] !== savedByPath[filePath]) : []),
    [sourceByPath, savedByPath, locallyEditedPaths],
  );

  const createFile = useCallback(
    async (filePath: string, code = "") => {
      setSaving(true);
      try {
        await api.save(filePath, code);
        setSavedByPath((prev) => ({ ...prev, [filePath]: code }));
        setSourceByPath((prev) => ({ ...prev, [filePath]: code }));
      } finally {
        setSaving(false);
      }
    },
    [api],
  );

  const renameFile = useCallback(
    async (from: string, to: string) => {
      if (!sourceByPath || from === to) return;
      setSaving(true);
      try {
        await api.move(from, to);
        // The move itself only relocates bytes; every relative specifier
        // that pointed at `from` (and the moved file's own, now resolved
        // from a different directory) still has to be rewritten and saved,
        // or the next build fails on an import that no longer resolves.
        const moved: Record<string, string> = { ...sourceByPath };
        moved[to] = moved[from] ?? "";
        delete moved[from];
        const updates = rewriteImportsAfterMove(sourceByPath, from, to);
        for (const [updatedPath, updatedCode] of Object.entries(updates)) {
          moved[updatedPath] = updatedCode;
          await api.save(updatedPath, updatedCode);
        }
        setSourceByPath(moved);
        setSavedByPath((prev) => {
          const next = { ...prev, ...updates };
          next[to] = moved[to] ?? "";
          delete next[from];
          return next;
        });
        setLocallyEditedPaths((previous) => {
          if (!previous.has(from)) return previous;
          const next = new Set(previous);
          next.delete(from);
          next.add(to);
          return next;
        });
        editBaseByPathRef.current[to] = editBaseByPathRef.current[from] ?? "";
        delete editBaseByPathRef.current[from];
      } finally {
        setSaving(false);
      }
    },
    [api, sourceByPath],
  );

  const deleteFile = useCallback(
    async (filePath: string) => {
      setSaving(true);
      try {
        await api.remove(filePath);
        const drop = (map: Record<string, string>) => {
          const next = { ...map };
          for (const key of Object.keys(next)) {
            // A folder delete is recursive on the server; mirror that here
            // instead of leaving orphaned descendants in the local tree.
            if (key === filePath || key.startsWith(`${filePath}/`)) delete next[key];
          }
          return next;
        };
        setSourceByPath((prev) => (prev ? drop(prev) : prev));
        setSavedByPath(drop);
        setLocallyEditedPaths((previous) => {
          const next = new Set([...previous].filter((key) => key !== filePath && !key.startsWith(`${filePath}/`)));
          return next.size === previous.size ? previous : next;
        });
        delete editBaseByPathRef.current[filePath];
      } finally {
        setSaving(false);
      }
    },
    [api],
  );

  return { sourceByPath, loading, error, updateSource, isDirty, save, reset, saving, dirtyPaths, reload, createFile, renameFile, deleteFile };
}
