import { configureSingle, fs } from "@zenfs/core";
import { IndexedDB } from "@zenfs/dom";

/**
 * The browser filesystem the git working copy lives on - ZenFS mounted on an
 * IndexedDB backend, so a clone survives a reload (and a closed tab) instead
 * of being re-fetched every session (`status/git-page-source.md`).
 *
 * One module-scoped instance, initialised once: `configureSingle` mounts at
 * `/`, and a second call would tear the first mount down under whatever is
 * currently reading it. Every caller goes through `gitFs()`.
 *
 * The whole module is only ever reached through a dynamic `import()` (same
 * discipline `page-build.js` uses) - isomorphic-git plus ZenFS is ~1 MB of
 * JS that nothing outside Page Builder's git flow needs.
 */
const STORE_NAME = "drycms-git";

/** Where the working copy is checked out. A constant, not configurable:
 * the repo is fixed by the server's own config, so there is only ever one. */
export const REPO_DIR = "/repo";

let ready: Promise<typeof fs> | undefined;

export function gitFs(): Promise<typeof fs> {
  ready ??= (async () => {
    await configureSingle({ backend: IndexedDB, storeName: STORE_NAME });
    return fs;
  })().catch((error: unknown) => {
    // Never cache a failed init - a denied storage permission or a private
    // window can be retried after the user changes it.
    ready = undefined;
    throw error;
  });
  return ready;
}

/**
 * Serialises every WRITE against the working copy across tabs. Two admin
 * tabs on the same origin share one IndexedDB, so an interleaved
 * clone/commit/checkout from both would corrupt the object store - and git's
 * own index/lock files can't help here, since ZenFS gives each tab its own
 * in-memory view of them.
 *
 * Falls back to running unlocked where the Web Locks API is missing (Safari
 * < 15.4), which is no worse than not having this at all.
 */
export async function withGitLock<T>(run: () => Promise<T>): Promise<T> {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks) return run();
  return locks.request("drycms-git-working-copy", run);
}

/** `true` once a clone has produced a real `.git` directory - what
 * `ensureCloned` uses to tell "first run" from "already have it". */
export async function isCloned(): Promise<boolean> {
  const filesystem = await gitFs();
  try {
    await filesystem.promises.stat(`${REPO_DIR}/.git/HEAD`);
    return true;
  } catch {
    return false;
  }
}

/**
 * A tab or browser shutdown can interrupt isomorphic-git after it creates the
 * index but before it writes its contents. An absent index is valid and is
 * rebuilt from HEAD on the next status/checkout; a zero-byte index instead
 * makes every isomorphic-git command fail before it can repair anything.
 * Remove only that exact interrupted-write artifact, leaving the working tree
 * (including uncommitted page edits) untouched.
 */
export async function repairEmptyGitIndex(): Promise<boolean> {
  const filesystem = await gitFs();
  const indexPath = `${REPO_DIR}/.git/index`;
  try {
    const stat = await filesystem.promises.stat(indexPath);
    if (stat.size !== 0) return false;
    await filesystem.promises.rm(indexPath, { force: true });
    return true;
  } catch {
    return false;
  }
}

/** Bytes the working copy currently occupies, as reported by the browser
 * (whole-origin, so this includes the app's other IndexedDB databases) -
 * only used for diagnostics/telemetry in the UI, never for a decision. */
export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (!navigator.storage?.estimate) return null;
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { usage, quota };
}
