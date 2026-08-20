import http from "isomorphic-git/http/web";
import { PAGES_SOURCE_ROOTS } from "../../server/app-router/source-roots.js";
import { gitFs, isCloned, repairEmptyGitIndex, REPO_DIR, withGitLock } from "./git-fs.js";

/**
 * Every git operation Page Builder performs, in one place - isomorphic-git
 * driven, against the ZenFS working copy (`git-fs.ts`) and this server's own
 * smart-HTTP proxy (`server/routes/git.ts`).
 *
 * The remote URL is always our own `{adminPath}/api/git`, never github.com:
 * the proxy resolves the real repository from server config and injects the
 * PAT, so the browser never holds a credential and can't be pointed at
 * another repository. Auth needs no `onAuth` callback for the same reason;
 * the admin's ordinary session cookie (plus the CSRF header
 * `lib/native/csrf-fetch.ts` adds to every `/api/` mutation) is what
 * authorises the call.
 */
export interface GitStatus {
  head: string | null;
  /** Paths whose working-copy content differs from HEAD. */
  dirty: string[];
}

export interface CloneProgress {
  phase: string;
  loaded?: number;
  total?: number;
}

/** Absolute, not root-relative: isomorphic-git parses the remote URL to pick
 * a transport and rejects a bare path outright ("Cannot parse remote URL").
 * Still same-origin - `window.location.origin` is this admin app's own. */
function remoteUrl(adminPath: string): string {
  return `${window.location.origin}${adminPath}/api/git`;
}

/** Shallow by default: page source is small, but its HISTORY may not be, and
 * nothing in Page Builder reads more than the current tree plus a short log.
 * `singleBranch` for the same reason - a tenant only ever edits its own
 * branch. */
const CLONE_DEPTH = 1;

/**
 * isomorphic-git assumes a global `Buffer` and dies with "Missing Buffer
 * dependency" the moment it parses GitHub's first refs advertisement in a
 * browser (confirmed live during the G0a spike). Its UMD bundle carries a
 * polyfill, but `package.json`'s `exports` map doesn't expose that file, so
 * the supported fix is to install one: `buffer` (~50 KB), assigned once here
 * rather than in a global bootstrap, so a tab that never opens Page
 * Builder's git flow never loads it.
 *
 * Both this and the git module itself are loaded on demand, like
 * `page-build.js` - see `git-fs.ts`'s own comment.
 */
async function git() {
  const scope = globalThis as typeof globalThis & { Buffer?: unknown };
  scope.Buffer ??= (await import("buffer")).Buffer;
  return (await import("isomorphic-git")).default;
}

export interface EnsureClonedOptions {
  adminPath: string;
  branch: string;
  onProgress?: (progress: CloneProgress) => void;
}

/**
 * Clones on first use, fast-forwards on every later one. Returns the commit
 * the working copy now points at.
 *
 * Deliberately NOT a `git pull`: a fetch + fast-forward can only ever move
 * HEAD along the remote's own history, so it can't silently merge (or
 * conflict with) a local edit. Anything that isn't a fast-forward surfaces
 * to the caller as `{ diverged: true }`, for the UI to resolve explicitly.
 */
export async function ensureCloned(options: EnsureClonedOptions): Promise<{ head: string; cloned: boolean; diverged: boolean }> {
  const { adminPath, branch, onProgress } = options;
  const api = await git();
  const fs = await gitFs();

  return withGitLock(async () => {
    await repairEmptyGitIndex();

    // The configured branch can change under an existing working copy (an
    // admin edits `GITHUB_BRANCH`, or a tenant is re-pointed). A `depth: 1`
    // clone of the OLD branch has none of the new branch's objects, so
    // fetching into it fails in a confusing way - the working copy is a
    // cache, so throw it away and clone fresh instead. Never when it holds
    // uncommitted work, though: that is the one thing here that exists
    // nowhere else.
    if (await isCloned()) {
      const checkedOut = await api.currentBranch({ fs, dir: REPO_DIR, fullname: false }).catch(() => null);
      if (checkedOut && checkedOut !== branch) {
        const dirty = (await api.statusMatrix({ fs, dir: REPO_DIR })).some(([, head, workdir]) => head !== workdir);
        if (dirty) {
          return { head: await api.resolveRef({ fs, dir: REPO_DIR, ref: "HEAD" }), cloned: false, diverged: true };
        }
        await fs.promises.rm(REPO_DIR, { recursive: true, force: true });
      }
    }

    if (!(await isCloned())) {
      await api.clone({
        fs,
        http,
        dir: REPO_DIR,
        url: remoteUrl(adminPath),
        ref: branch,
        singleBranch: true,
        depth: CLONE_DEPTH,
        onProgress: onProgress ? (event) => onProgress({ phase: event.phase, loaded: event.loaded, total: event.total }) : undefined,
      });
      return { head: await api.resolveRef({ fs, dir: REPO_DIR, ref: "HEAD" }), cloned: true, diverged: false };
    }

    const before = await api.resolveRef({ fs, dir: REPO_DIR, ref: "HEAD" });
    const remoteBefore = await api.resolveRef({ fs, dir: REPO_DIR, ref: `refs/remotes/origin/${branch}` }).catch(() => null);
    await api.fetch({
      fs,
      http,
      dir: REPO_DIR,
      url: remoteUrl(adminPath),
      ref: branch,
      singleBranch: true,
      depth: CLONE_DEPTH,
      onProgress: onProgress ? (event) => onProgress({ phase: event.phase, loaded: event.loaded, total: event.total }) : undefined,
    });
    const remote = await api.resolveRef({ fs, dir: REPO_DIR, ref: `refs/remotes/origin/${branch}` });
    if (remote === before) return { head: before, cloned: false, diverged: false };

    // Fast-forward only, and only when it is provably safe. `isDescendent`
    // is useless on a `depth: 1` clone (the ancestry it would walk simply
    // isn't there), so the check is done against what the remote pointed at
    // BEFORE this fetch instead: HEAD still on that commit means this working
    // copy has no commits of its own, so moving it forward can't lose
    // anything. A local commit, or an uncommitted edit, makes this a real
    // divergence the UI has to resolve - never a forced checkout, which would
    // silently discard exactly the work the admin came here to keep.
    const dirty = (await api.statusMatrix({ fs, dir: REPO_DIR })).some(([, head, workdir]) => head !== workdir);
    if (dirty || (remoteBefore !== null && before !== remoteBefore)) {
      return { head: before, cloned: false, diverged: true };
    }

    await api.writeRef({ fs, dir: REPO_DIR, ref: `refs/heads/${branch}`, value: remote, force: true });
    await api.checkout({ fs, dir: REPO_DIR, ref: branch, force: true });
    return { head: remote, cloned: false, diverged: false };
  });
}

/** The four source roots as a flat `path -> content` map - exactly the shape
 * `page-build.ts` already consumes, so the build pipeline never learns that
 * its source now comes from git rather than HTTP. */
export async function readAllSource(): Promise<Record<string, string>> {
  const fs = await gitFs();
  const out: Record<string, string> = {};

  async function walk(relative: string): Promise<void> {
    const absolute = `${REPO_DIR}/${relative}`;
    let entries: string[];
    try {
      entries = await fs.promises.readdir(absolute);
    } catch {
      return; // A root that doesn't exist in this repo yet is not an error.
    }
    for (const name of entries) {
      const childRelative = `${relative}/${name}`;
      const stat = await fs.promises.stat(`${REPO_DIR}/${childRelative}`);
      if (stat.isDirectory()) await walk(childRelative);
      else out[childRelative] = await fs.promises.readFile(`${REPO_DIR}/${childRelative}`, "utf8") as string;
    }
  }

  for (const root of PAGES_SOURCE_ROOTS) await walk(root.id);
  return out;
}

export async function writeFile(path: string, content: string): Promise<void> {
  const fs = await gitFs();
  await withGitLock(async () => {
    const absolute = `${REPO_DIR}/${path}`;
    await fs.promises.mkdir(absolute.slice(0, absolute.lastIndexOf("/")), { recursive: true });
    await fs.promises.writeFile(absolute, content, "utf8");
  });
}

export async function removeFile(path: string): Promise<void> {
  const fs = await gitFs();
  await withGitLock(() => fs.promises.rm(`${REPO_DIR}/${path}`, { recursive: true, force: true }));
}

export async function movePath(from: string, to: string): Promise<void> {
  const fs = await gitFs();
  await withGitLock(async () => {
    const target = `${REPO_DIR}/${to}`;
    await fs.promises.mkdir(target.slice(0, target.lastIndexOf("/")), { recursive: true });
    await fs.promises.rename(`${REPO_DIR}/${from}`, target);
  });
}

/**
 * Restores one file to what HEAD has, dropping the working copy's version -
 * "discard my changes" for a file, and the only undo left now that editing
 * writes straight through. Returns the restored content so the caller can
 * put it back in the editor buffer without a second read. A file that HEAD
 * doesn't have (created and not yet committed) is simply removed, and comes
 * back as `""`.
 */
export async function restoreFromHead(path: string): Promise<string> {
  const api = await git();
  const fs = await gitFs();
  return withGitLock(async () => {
    let content: string | null = null;
    try {
      const { blob } = await api.readBlob({ fs, dir: REPO_DIR, oid: await api.resolveRef({ fs, dir: REPO_DIR, ref: "HEAD" }), filepath: path });
      content = new TextDecoder().decode(blob);
    } catch {
      content = null;
    }
    const absolute = `${REPO_DIR}/${path}`;
    if (content === null) {
      await fs.promises.rm(absolute, { force: true });
      return "";
    }
    await fs.promises.mkdir(absolute.slice(0, absolute.lastIndexOf("/")), { recursive: true });
    await fs.promises.writeFile(absolute, content, "utf8");
    return content;
  });
}

/**
 * Cheap remote-only check: one `info/refs` GET (git's own "list remote refs"
 * negotiation step), no `git-upload-pack` object transfer, no `fs`/`dir` -
 * nothing local is touched. What the Page Builder 30s remote-change poll uses
 * so an idle tab isn't running a full clone-weight `fetch` (refs AND a pack
 * transfer negotiation) every 30 seconds for as long as it stays open; only
 * once this reports a real change does the poll pay for `ensureCloned`'s
 * full fetch-and-fast-forward.
 */
export async function remoteHeadSha(adminPath: string, branch: string): Promise<string | null> {
  const api = await git();
  const info = (await api.getRemoteInfo({ http, url: remoteUrl(adminPath) })) as { refs?: { heads?: Record<string, string> } };
  return info.refs?.heads?.[branch] ?? null;
}

/** Working-copy paths that differ from HEAD - the dirty list Page Builder's
 * Save/commit UI shows. `statusMatrix`'s rows are
 * `[path, head, workdir, stage]`; anything where workdir doesn't match head
 * is a real change (added, modified or deleted). */
export async function status(): Promise<GitStatus> {
  const api = await git();
  const fs = await gitFs();
  if (!(await isCloned())) return { head: null, dirty: [] };
  const matrix = await api.statusMatrix({ fs, dir: REPO_DIR });
  return {
    head: await api.resolveRef({ fs, dir: REPO_DIR, ref: "HEAD" }).catch(() => null),
    dirty: matrix.filter(([, head, workdir]) => head !== workdir).map(([path]) => path),
  };
}

/** Sends only dirty paths to the server-side Git Data API. The server layers
 * them on the latest remote tree, so unrelated concurrent edits survive. */
export async function commitWorkingCopy(
  adminPath: string,
  message: string,
  author: { name: string; email: string },
): Promise<{ committed: boolean; commitSha?: string; reason?: string }> {
  const fs = await gitFs();
  const pending = await status();
  if (pending.dirty.length === 0) return { committed: false };
  const files: Record<string, string | null> = {};
  for (const path of pending.dirty) {
    try {
      files[path] = await fs.promises.readFile(`${REPO_DIR}/${path}`, "utf8") as string;
    } catch {
      files[path] = null;
    }
  }
  const response = await fetch(`${adminPath}/api/pages-source/commit`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, author, files }),
  });
  const result = await response.json().catch(() => ({})) as { committed?: boolean; commitSha?: string; reason?: string; message?: string };
  if (!response.ok) throw new Error(result.reason ?? result.message ?? `Commit failed (${response.status}).`);
  return { committed: result.committed === true, commitSha: result.commitSha, reason: result.reason };
}

/** The working copy is a cache. After a successful remote commit, replace it
 * wholesale so HEAD and every file exactly match the merged remote tree. */
export async function resyncWorkingCopy(options: EnsureClonedOptions): Promise<void> {
  const fs = await gitFs();
  await withGitLock(() => fs.promises.rm(REPO_DIR, { recursive: true, force: true }));
  await ensureCloned(options);
}

export interface CommitOptions {
  message: string;
  /** The signed-in admin, so a commit is attributed to the person who made
   * it even though the PAT (and therefore the committer) belongs to the
   * system - git keeps author and committer separate for exactly this. */
  author: { name: string; email: string };
}

/** Stages every change under the four source roots and commits them.
 * Returns the new commit's oid, or `null` when there was nothing to commit. */
export async function commitAll(options: CommitOptions): Promise<string | null> {
  const api = await git();
  const fs = await gitFs();
  return withGitLock(async () => {
    const matrix = await api.statusMatrix({ fs, dir: REPO_DIR });
    let staged = 0;
    for (const [path, head, workdir] of matrix) {
      if (head === workdir) continue;
      if (workdir === 0) await api.remove({ fs, dir: REPO_DIR, filepath: path });
      else await api.add({ fs, dir: REPO_DIR, filepath: path });
      staged += 1;
    }
    if (staged === 0) return null;
    return api.commit({ fs, dir: REPO_DIR, message: options.message, author: options.author });
  });
}

export type PushResult = { ok: true; head: string } | { ok: false; reason: string; rejected: boolean };

/** Pushes the current branch. A non-fast-forward rejection comes back as
 * `{ rejected: true }` rather than an exception - that is an ordinary
 * outcome (someone else pushed first) the UI resolves, not a failure. */
export async function push(adminPath: string, branch: string): Promise<PushResult> {
  const api = await git();
  const fs = await gitFs();
  try {
    const result = await withGitLock(() =>
      api.push({ fs, http, dir: REPO_DIR, url: remoteUrl(adminPath), ref: branch, remoteRef: branch }),
    );
    if (result.ok === false || result.error) {
      return { ok: false, reason: result.error ?? "GitHub rejected the push.", rejected: true };
    }
    return { ok: true, head: await api.resolveRef({ fs, dir: REPO_DIR, ref: "HEAD" }) };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Push failed.";
    return { ok: false, reason: message, rejected: /not a fast-forward|rejected/i.test(message) };
  }
}

export interface GitLogEntry {
  oid: string;
  message: string;
  author: string;
  timestamp: number;
}

export async function log(depth = 20): Promise<GitLogEntry[]> {
  const api = await git();
  const fs = await gitFs();
  const entries = await api.log({ fs, dir: REPO_DIR, depth });
  return entries.map((entry) => ({
    oid: entry.oid,
    message: entry.commit.message.trim(),
    author: entry.commit.author.name,
    timestamp: entry.commit.author.timestamp * 1000,
  }));
}

/** Paths that changed between two commits - what a push hands the build
 * pipeline so only affected pages are rebuilt (`initial-publish.ts`'s
 * `publishPagesAffectedBySource`). */
export async function changedPathsBetween(from: string, to: string): Promise<string[]> {
  const api = await git();
  const fs = await gitFs();
  const changed: string[] = [];
  await api.walk({
    fs,
    dir: REPO_DIR,
    trees: [api.TREE({ ref: from }), api.TREE({ ref: to })],
    map: async (filepath, entries) => {
      if (filepath === "." || !entries) return;
      const [before, after] = entries;
      const beforeOid = before ? await before.oid() : undefined;
      const afterOid = after ? await after.oid() : undefined;
      if (beforeOid !== afterOid) changed.push(filepath);
      return;
    },
  });
  return changed.filter((path) => PAGES_SOURCE_ROOTS.some((root) => path.startsWith(`${root.id}/`)));
}
