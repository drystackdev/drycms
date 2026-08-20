import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { createPagesSourceApi } from "./pages-source-http-api.js";
import { rewriteImportsAfterMove } from "./import-rewrite.js";
import { ensureRepoReady, gitState, refreshGitStatus } from "./git/git-state.js";
import { loadAllPagesSource } from "./pages-source-http.js";

const PAGES_SOURCE_BROWSER_EVENT = "dry:pages-source-change";

/**
 * Which files have been written but not yet built and published, when there
 * is NO repository connected.
 *
 * With git, `git.statusMatrix` answers this for free and survives anything -
 * the working copy is the record. Without it, a write lands straight in the
 * HTTP store and the store has no notion of "published", so the only place
 * that knowledge can live is here. Session-scoped rather than in-memory
 * because losing it on a reload would strand the change exactly the way it
 * did before this existed: written to storage, invisible to Build & publish,
 * never reaching the live site.
 *
 * A stale entry (published from `/dry/page-build` instead) costs one
 * redundant rebuild of a page that was already current, which is why erring
 * toward keeping the entry is the safe direction.
 */
const UNPUBLISHED_KEY = "drycms:page-builder-unpublished";

function readUnpublished(): Set<string> {
  try {
    const raw = JSON.parse(sessionStorage.getItem(UNPUBLISHED_KEY) ?? "[]") as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === "string") : []);
  } catch {
    return new Set();
  }
}

function writeUnpublished(paths: Set<string>): void {
  try {
    sessionStorage.setItem(UNPUBLISHED_KEY, JSON.stringify([...paths]));
  } catch {
    // Private-mode/quota - the badge just goes back to being session-local.
  }
}

/** Long enough that a fast typist writes once per pause rather than per
 * word, short enough that closing a panel (or the tab) right after typing
 * has already persisted. */
const AUTOSAVE_DELAY_MS = 400;

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
  /** `true` when `path` has changes that have not been built and published
   * yet - against HEAD under git, against `UNPUBLISHED_KEY`'s ledger without
   * it. NOT "has an unwritten buffer": autosave makes that go false within a
   * second of the last keystroke, long before anything reaches the site. */
  isDirty: (path: string) => boolean;
  /** `true` when Discard has something to restore. Under git that is any
   * unpublished change (HEAD is the baseline); without git the only baseline
   * is the file already in storage, so this narrows to "the buffer differs
   * from what was written" and goes false once autosave lands. */
  canDiscard: (path: string) => boolean;
  /** Writes any debounced edit out immediately - Build & publish awaits this
   * before committing. */
  flushPendingWrites: () => Promise<void>;
  /** Discards a file's changes: back to HEAD under git. */
  reset: (path: string) => Promise<void>;
  saving: boolean;
  /** A debounced write is in flight - drives the "Saving…/Saved" hint. */
  autosaving: boolean;
  /** Unsaved editor buffers. */
  dirtyPaths: string[];
  /** Buffers PLUS everything already written through but not yet published -
   * file create/rename/delete included, since those never had a buffer of
   * their own. This is what Build & publish acts on. */
  pendingCommitPaths: string[];
  /** Clears `paths` from the unpublished ledger - called once Build & publish
   * has actually built and published them. */
  markPublished: (paths: string[]) => void;
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
  /** Set once a background poll (every 5s, git only) auto-pulls new commits
   * from the remote - the paths it pulled, for a one-time "here's what
   * changed" dialog. `null` once dismissed. */
  remoteUpdateNotice: { changedPaths: string[] } | null;
  dismissRemoteUpdateNotice: () => void;
  /** The remote has moved but this working copy has uncommitted edits, so the
   * background poll could not auto-pull - a soft warning, not a block. */
  remoteDiverged: boolean;
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
  /** Debounced writes still in flight, keyed by path (see `updateSource`). */
  const pendingWritesRef = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; code: string; done: Promise<void> }>());
  const [autosaving, setAutosaving] = useState(false);
  /** See `UNPUBLISHED_KEY` - only maintained when there is no repository; with
   * one, `gitState.dirty` is the authoritative answer and this stays empty. */
  const [unpublishedPaths, setUnpublishedPaths] = useState<Set<string>>(readUnpublished);
  /** Paths a background remote poll (below) auto-pulled - already at HEAD, so
   * `gitState.dirty` alone would never flag them, yet nothing has built and
   * published them either. Session-only, unlike `unpublishedPaths`: losing
   * this on reload just costs one extra look at `/dry/page-build`, and a real
   * fix (comparing HEAD against a persisted `lastBuiltCommit`) is the
   * deferred item `status/git-page-source.md` already tracks. */
  const [pendingRemotePaths, setPendingRemotePaths] = useState<Set<string>>(() => new Set());
  /** Set right after a background auto-pull moved HEAD forward - Page Builder
   * shows this once, then the admin dismisses it. */
  const [remoteUpdateNotice, setRemoteUpdateNotice] = useState<{ changedPaths: string[] } | null>(null);
  /** The remote moved while this working copy has its own uncommitted edits.
   * `ensureCloned` never auto-pulls in that case (it would either overwrite
   * or silently need a merge it doesn't attempt) - this only tells the admin
   * a pull is waiting once they finish or discard. */
  const [remoteDiverged, setRemoteDiverged] = useState(false);

  const api = useMemo(() => createPagesSourceApi(`${adminPath}/api/pages-source`), [adminPath]);

  /**
   * Which store this session reads and writes: the browser git working copy
   * when a repository is connected, the `/api/pages-source` HTTP store when
   * one isn't.
   *
   * The HTTP path is not legacy cruft - it is what a tenant that has never
   * configured git (and every e2e run, where `scripts/e2e-server.mjs` blanks
   * `GITHUB_*` on purpose) still uses. It goes away with Giai đoạn 5-6, once
   * the server-side writers (MCP, Magic Chat) commit too.
   */
  const gitPhase = gitState.value.phase;
  const usingGit = gitPhase !== "unconfigured";

  /** Records a write against the no-repository ledger. A no-op under git,
   * where the working copy already tracks exactly this. */
  const markUnpublished = useCallback(
    (...paths: string[]) => {
      if (usingGit) return;
      setUnpublishedPaths((previous) => {
        if (paths.every((filePath) => previous.has(filePath))) return previous;
        const next = new Set(previous);
        for (const filePath of paths) next.add(filePath);
        writeUnpublished(next);
        return next;
      });
    },
    [usingGit],
  );

  const markPublished = useCallback((paths: string[]) => {
    setUnpublishedPaths((previous) => {
      if (!paths.some((filePath) => previous.has(filePath))) return previous;
      const next = new Set(previous);
      for (const filePath of paths) next.delete(filePath);
      writeUnpublished(next);
      return next;
    });
    setPendingRemotePaths((previous) => {
      if (!paths.some((filePath) => previous.has(filePath))) return previous;
      const next = new Set(previous);
      for (const filePath of paths) next.delete(filePath);
      return next;
    });
  }, []);

  /** In dev the Vite server renders the site straight off `.dry/pages-source`
   * (`DevPagesSource`), so a save that only landed in IndexedDB would leave
   * live preview and HMR showing yesterday's file. Mirroring the same bytes
   * through the HTTP store keeps that whole path working untouched. Never in
   * production, where nothing reads that store to render a page. */
  const mirrorToDisk = useCallback(
    async (filePath: string, code: string) => {
      if (!import.meta.env.DEV || !usingGit) return;
      await api.save(filePath, code).catch(() => undefined);
    },
    [api, usingGit],
  );

  const reload = useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await ensureRepoReady(adminPath);
      const phase = gitState.value.phase;
      let source: Record<string, string>;
      if (phase === "unconfigured") {
        source = await loadAllPagesSource(adminPath);
      } else if (phase === "ready" || phase === "diverged") {
        source = await (await import("./git/git-repo.js")).readAllSource();
      } else {
        throw new Error(gitState.value.error ?? "The git working copy is not ready yet.");
      }
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
    // Dev-only mirror of EXTERNAL edits (a VS Code save into
    // `.dry/pages-source`). Skipped once git is the working copy: the same
    // saves also land there through `mirrorToDisk`, so polling the HTTP
    // store back in would fight the copy git is tracking. Picking up a real
    // outside-the-browser edit under git is a `fetch`/pull concern, not a
    // poll - see `status/git-page-source.md`.
    if (!enabled || !import.meta.env.DEV || usingGit) return;
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
  }, [adminPath, enabled, locallyEditedPaths, usingGit]);

  useEffect(() => {
    // Git's own equivalent of the dev-only poll above - a `fetch` against
    // the real remote (GitHub/GitLab), so it runs in every environment,
    // production included. Safe to run unattended: `ensureCloned` only ever
    // fast-forwards when the working copy has no edits of its own, and
    // otherwise reports `diverged` for the admin to see rather than
    // overwriting or merging anything (`git-repo.ts`'s own comment on why
    // that decision is never automatic).
    if (!enabled || !usingGit) return;
    let cancelled = false;
    let polling = false;
    const poll = async () => {
      if (polling) return;
      // Only once a working copy actually exists: "cloning" hasn't produced
      // one yet, and "error" (a broken PAT, a repo that no longer resolves)
      // won't be fixed by retrying the same request every 5s - the admin has
      // to fix the config, at which point a full reload re-clones anyway.
      const phase = gitState.value.phase;
      if (phase !== "ready" && phase !== "diverged") return;
      polling = true;
      try {
        const before = gitState.value.head;
        await ensureRepoReady(adminPath);
        if (cancelled) return;
        if (gitState.value.phase === "diverged") {
          setRemoteDiverged(true);
          return;
        }
        setRemoteDiverged(false);
        const after = gitState.value.head;
        if (!before || !after || before === after) return;
        const { changedPathsBetween, readAllSource } = await import("./git/git-repo.js");
        const changed = await changedPathsBetween(before, after);
        if (changed.length === 0 || cancelled) return;
        // A direct source swap, not `reload()`: that flips `loading` and
        // would flash the whole builder into its loading skeleton mid-session
        // for what should be an invisible background refresh.
        const fresh = await readAllSource();
        setSourceByPath(fresh);
        setSavedByPath(fresh);
        setPendingRemotePaths((previous) => new Set([...previous, ...changed]));
        setRemoteUpdateNotice({ changedPaths: changed });
      } catch {
        // A missed poll just tries again in 5s - not worth interrupting an
        // edit session for.
      } finally {
        polling = false;
      }
    };
    const timer = window.setInterval(() => void poll(), 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [enabled, usingGit, adminPath]);

  const dismissRemoteUpdateNotice = useCallback(() => setRemoteUpdateNotice(null), []);

  /**
   * Typing persists itself - there is no Save button anywhere in Page
   * Builder, because with the working copy in this browser there is nothing
   * a Save could add: `writeThrough` below is a local IndexedDB write, not a
   * network round trip, so the honest model is "edits are drafts, and drafts
   * live in the working copy". Publishing them is Build & publish's job.
   *
   * Debounced per path rather than per keystroke, the same 400ms/keyed-Map
   * shape `entry-draft-store.ts` uses for content drafts - keyed, not a
   * single timer, so switching files mid-debounce still flushes the first
   * one instead of cancelling it.
   */
  const updateSource = useCallback((filePath: string, code: string) => {
    setSourceByPath((prev) => (prev && prev[filePath] === code ? prev : { ...prev, [filePath]: code }));

    // An `onChange` that reports the file's CURRENT content is not an edit.
    // `Editer` emits one on mount (and after a format pass), so without this
    // every file merely OPENED would be written back to storage and counted
    // as an unpublished change - found live: opening a page in the code panel
    // and touching nothing still queued it for Build & publish. Also cancels
    // a debounce still in flight, since typing back to the stored content
    // leaves nothing to write.
    const currentlyStored = savedByPath[filePath];
    if (currentlyStored !== undefined && code === currentlyStored) {
      const inFlight = pendingWritesRef.current.get(filePath);
      if (inFlight) {
        clearTimeout(inFlight.timer);
        pendingWritesRef.current.delete(filePath);
      }
      return;
    }

    setLocallyEditedPaths((previous) => {
      if (previous.has(filePath)) return previous;
      editBaseByPathRef.current[filePath] = savedByPath[filePath] ?? "";
      return new Set(previous).add(filePath);
    });

    const pending = pendingWritesRef.current;
    const existing = pending.get(filePath);
    if (existing) clearTimeout(existing.timer);
    const write = () => {
      pending.delete(filePath);
      return writeThroughRef.current(filePath, code, editBaseByPathRef.current[filePath]).then(() => {
        setSavedByPath((prev) => (prev[filePath] === code ? prev : { ...prev, [filePath]: code }));
      });
    };
    let resolveDone: () => void;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    const timer = setTimeout(() => {
      setAutosaving(true);
      void write()
        .catch((err: unknown) => setError(err instanceof Error ? err.message : "Failed to write the file."))
        .finally(() => {
          setAutosaving(false);
          resolveDone();
        });
    }, AUTOSAVE_DELAY_MS);
    pending.set(filePath, { timer, code, done: done.then(() => undefined) });
  }, [savedByPath]);

  /**
   * Waits for every debounced write to have landed - what Build & publish
   * calls before committing, so the last few keystrokes before the click are
   * part of the commit rather than the next one. Flushes immediately instead
   * of waiting out the remaining debounce.
   */
  const flushPendingWrites = useCallback(async () => {
    const pending = [...pendingWritesRef.current.entries()];
    for (const [filePath, entry] of pending) {
      clearTimeout(entry.timer);
      pendingWritesRef.current.delete(filePath);
      try {
        await writeThroughRef.current(filePath, entry.code, editBaseByPathRef.current[filePath]);
        setSavedByPath((prev) => ({ ...prev, [filePath]: entry.code }));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to write the file.");
      }
    }
  }, []);

  /** One place every write goes through, whichever store is active - the
   * whole point of keeping file operations behind this hook (see its own doc
   * comment): swapping the backend touched exactly these three functions. */
  const writeThrough = useCallback(
    async (filePath: string, code: string, baseSource?: string) => {
      if (usingGit) {
        await (await import("./git/git-repo.js")).writeFile(filePath, code);
        await mirrorToDisk(filePath, code);
        await refreshGitStatus();
        return;
      }
      await api.save(filePath, code, baseSource);
      markUnpublished(filePath);
    },
    [api, usingGit, mirrorToDisk, markUnpublished],
  );

  const moveThrough = useCallback(
    async (from: string, to: string) => {
      if (usingGit) {
        await (await import("./git/git-repo.js")).movePath(from, to);
        if (import.meta.env.DEV) await api.move(from, to).catch(() => undefined);
        await refreshGitStatus();
        return;
      }
      await api.move(from, to);
      // Both halves of a move need publishing: the new path so the site gains
      // it, the old one so whatever referenced it is rebuilt against its
      // absence.
      markUnpublished(from, to);
    },
    [api, usingGit, markUnpublished],
  );

  /** `updateSource`'s debounced timer fires long after the render that
   * scheduled it, and `writeThrough` is a fresh closure each render - the ref
   * is what keeps a pending write pointed at the CURRENT one (and lets
   * `updateSource` be declared before it without reordering the file). */
  const writeThroughRef = useRef(writeThrough);
  writeThroughRef.current = writeThrough;

  const removeThrough = useCallback(
    async (filePath: string) => {
      if (usingGit) {
        await (await import("./git/git-repo.js")).removeFile(filePath);
        if (import.meta.env.DEV) await api.remove(filePath).catch(() => undefined);
        await refreshGitStatus();
        return;
      }
      await api.remove(filePath);
      markUnpublished(filePath);
    },
    [api, usingGit, markUnpublished],
  );

  /** The buffer half of "dirty": what has been typed but not written out yet.
   * True for at most a second after the last keystroke (`AUTOSAVE_DELAY_MS`),
   * which is precisely why it can't be the whole answer below. */
  const hasUnwrittenBuffer = useCallback(
    (filePath: string) => !!sourceByPath && sourceByPath[filePath] !== savedByPath[filePath],
    [sourceByPath, savedByPath],
  );

  /**
   * "Has unpublished changes", NOT "has unwritten buffer" - with autosave
   * those are different questions and only the first one is useful: a
   * keystroke is written a few hundred ms later, so a buffer-vs-store
   * comparison goes false almost immediately and would leave the file looking
   * published when nothing has been built.
   *
   * Against HEAD (`git.statusMatrix`, via `gitState`) under git; against the
   * `UNPUBLISHED_KEY` ledger without one, where the store itself cannot
   * answer the question.
   */
  const isDirty = useCallback(
    (filePath: string) => {
      if (usingGit ? gitState.value.dirty.includes(filePath) : unpublishedPaths.has(filePath)) return true;
      return hasUnwrittenBuffer(filePath);
    },
    [hasUnwrittenBuffer, usingGit, gitState.value.dirty, unpublishedPaths],
  );

  /** Discard needs a baseline to restore FROM. Git has one (HEAD); without it
   * the only recoverable state is the file already in storage, so once
   * autosave has landed there is genuinely nothing left to undo. */
  const canDiscard = useCallback(
    (filePath: string) => (usingGit ? isDirty(filePath) : hasUnwrittenBuffer(filePath)),
    [usingGit, isDirty, hasUnwrittenBuffer],
  );

  const save = useCallback(
    async (filePath: string) => {
      if (!sourceByPath) return;
      const code = sourceByPath[filePath] ?? "";
      if (code === savedByPath[filePath]) return;
      setSaving(true);
      try {
        await writeThrough(filePath, code, editBaseByPathRef.current[filePath] ?? savedByPath[filePath] ?? "");
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
    [writeThrough, sourceByPath, savedByPath],
  );

  /**
   * Throws this file's changes away. With no Save button there is no
   * "last saved" state to return to any more, so under git this restores the
   * file from HEAD - the last thing that was actually published - and drops
   * whatever the working copy held. Without git it falls back to the last
   * value read from the HTTP store, the old behavior.
   */
  const reset = useCallback(
    async (filePath: string) => {
      const pendingWrite = pendingWritesRef.current.get(filePath);
      if (pendingWrite) {
        clearTimeout(pendingWrite.timer);
        pendingWritesRef.current.delete(filePath);
      }
      let restored = savedByPath[filePath] ?? "";
      if (usingGit) {
        setSaving(true);
        try {
          restored = await (await import("./git/git-repo.js")).restoreFromHead(filePath);
          await mirrorToDisk(filePath, restored);
          await refreshGitStatus();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed to discard the changes.");
          return;
        } finally {
          setSaving(false);
        }
      }
      setSourceByPath((prev) => (prev ? { ...prev, [filePath]: restored } : prev));
      setSavedByPath((prev) => ({ ...prev, [filePath]: restored }));
      delete editBaseByPathRef.current[filePath];
      setLocallyEditedPaths((previous) => {
        if (!previous.has(filePath)) return previous;
        const next = new Set(previous);
        next.delete(filePath);
        return next;
      });
    },
    [savedByPath, usingGit, mirrorToDisk],
  );

  /** Unsaved EDITOR BUFFERS - what Reset acts on and what a Save has to
   * write out first. */
  const dirtyPaths = useMemo(
    () => (sourceByPath ? [...locallyEditedPaths].filter((filePath) => sourceByPath[filePath] !== savedByPath[filePath]) : []),
    [sourceByPath, savedByPath, locallyEditedPaths],
  );

  /**
   * Everything the next Build & publish would carry: unwritten buffers PLUS
   * everything already written but not yet published. The second half matters
   * twice over - creating, renaming or deleting a file writes straight through
   * (there is no buffer for it), and autosave empties the first half within a
   * second of the last keystroke. Without it the dock offers nothing to
   * publish moments after an edit, and the change sits in storage reaching
   * nobody.
   */
  const pendingCommitPaths = useMemo(
    () => [...new Set([...dirtyPaths, ...(usingGit ? gitState.value.dirty : unpublishedPaths), ...pendingRemotePaths])],
    [dirtyPaths, usingGit, gitState.value.dirty, unpublishedPaths, pendingRemotePaths],
  );

  const createFile = useCallback(
    async (filePath: string, code = "") => {
      setSaving(true);
      try {
        await writeThrough(filePath, code);
        setSavedByPath((prev) => ({ ...prev, [filePath]: code }));
        setSourceByPath((prev) => ({ ...prev, [filePath]: code }));
      } finally {
        setSaving(false);
      }
    },
    [writeThrough],
  );

  const renameFile = useCallback(
    async (from: string, to: string) => {
      if (!sourceByPath || from === to) return;
      setSaving(true);
      try {
        // Rewriting imports has to see what the admin has TYPED, not only
        // what has been written out: an edit sits in `pendingWritesRef` for
        // up to `AUTOSAVE_DELAY_MS`, and renaming a file inside that window
        // would otherwise rewrite against the previous contents and silently
        // leave the importer pointing at a path that no longer exists.
        await flushPendingWrites();
        await moveThrough(from, to);
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
          await writeThrough(updatedPath, updatedCode);
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
    [moveThrough, writeThrough, sourceByPath, flushPendingWrites],
  );

  const deleteFile = useCallback(
    async (filePath: string) => {
      setSaving(true);
      try {
        await removeThrough(filePath);
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
    [removeThrough],
  );

  return {
    sourceByPath,
    loading,
    error,
    updateSource,
    isDirty,
    canDiscard,
    flushPendingWrites,
    reset,
    saving,
    autosaving,
    dirtyPaths,
    pendingCommitPaths,
    markPublished,
    reload,
    createFile,
    renameFile,
    deleteFile,
    remoteUpdateNotice,
    dismissRemoteUpdateNotice,
    remoteDiverged,
  };
}
