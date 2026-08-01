import type { Readable } from "node:stream";
import { Readable as NodeReadable } from "node:stream";
import type { ResolvedGitlabStorageOption } from "../server/options.js";
import { applyRecursiveFolderTotals } from "./aggregate.js";
import { joinStoragePath, storagePathName } from "./path.js";
import {
  StorageError,
  type StorageAdapter,
  type StorageReadResult,
  type StorageStatEntry,
} from "./types.js";
import { bufferOf, commitMessage, mapWithConcurrency, stripRoot } from "./util.js";

/** Empty-folder marker - see `local.ts`'s `MARKER_FILE`. Git has no native
 * concept of an empty directory (same reason `github.ts` needs one). */
const MARKER_FILE = ".dir";

/** Entries appearing in a folder each cost up to two round trips here
 * (a `HEAD` for size/blob-id plus a `/commits` lookup for the date) - twice
 * `github.ts`'s per-entry cost, since GitLab's Tree API carries neither, so
 * this is kept lower than `github.ts`'s equivalent constant. */
const CONCURRENCY_LIMIT = 16;

interface GitlabTreeItem {
  id: string;
  name: string;
  type: "tree" | "blob";
  path: string;
}

interface GitlabCommitAction {
  action: "create" | "delete" | "move" | "update";
  file_path: string;
  previous_path?: string;
  content?: string;
  encoding?: "base64";
}

interface GitlabFileHead {
  size: number;
  blobId: string;
}

interface GitlabProjectInfo {
  default_branch?: string;
}

function cleanPath(path: string): string {
  return path.split("/").filter(Boolean).join("/");
}

/**
 * Backend for `kind: 'gitlab'`: reads/writes a GitLab project's repository
 * via the Repository Files, Repository Tree and Commits REST APIs. Unlike
 * `github.ts`, GitLab's Commits API accepts several file `actions` in one
 * request, so `move`/`copy`/`remove` on a whole folder become a single
 * atomic commit instead of one commit per blob - `move` in particular needs
 * no content round trip at all, since GitLab's native `move` action keeps a
 * blob's bytes unless new `content` is supplied.
 */
export function createGitlabStorageAdapter(option: ResolvedGitlabStorageOption): StorageAdapter {
  const { host, project, branch, token, root } = option;
  const apiBase = `${host}/api/v4/projects/${encodeURIComponent(project)}`;

  function fullPath(relPath: string): string {
    return cleanPath(joinStoragePath(root, relPath));
  }

  function authHeaders(extra?: Record<string, string>): Record<string, string> {
    return { "PRIVATE-TOKEN": token, ...extra };
  }

  async function readGitlabError(response: Response): Promise<string> {
    try {
      const body = (await response.json()) as { message?: unknown; error?: string };
      if (typeof body.message === "string") return body.message;
      if (body.message !== undefined) return JSON.stringify(body.message);
      if (typeof body.error === "string") return body.error;
    } catch {
      // fall through to the generic status line below
    }
    return `${response.status} ${response.statusText}`;
  }

  function filesUrl(path: string): string {
    return `${apiBase}/repository/files/${encodeURIComponent(path)}`;
  }

  /** One page of `path`'s immediate (or, with `recursive`, full subtree)
   * children, or `null` on a 404 - GitLab has no way to tell "exists but
   * empty" apart from "doesn't exist" here (git never stores empty trees),
   * matching `local`/`github`'s existence semantics. Paginated (`per_page`
   * maxes at 100, unlike GitHub's single recursive-tree response), so this
   * pages through via the `x-next-page` response header until exhausted. */
  let branchReady: Promise<void> | null = null;

  async function fetchTree(path: string, recursive: boolean, ref = branch): Promise<GitlabTreeItem[] | null> {
    if (ref === branch) await ensureBranch();
    const items: GitlabTreeItem[] = [];
    let page = 1;
    for (;;) {
      const query = new URLSearchParams({
        ref,
        recursive: String(recursive),
        per_page: "100",
        page: String(page),
      });
      if (path) query.set("path", path);
      const response = await fetch(`${apiBase}/repository/tree?${query}`, {
        headers: authHeaders(),
      });
      if (response.status === 404) return page === 1 ? null : items;
      if (!response.ok) {
        throw new Error(`[drycms] GitLab API error: ${await readGitlabError(response)}`);
      }
      items.push(...((await response.json()) as GitlabTreeItem[]));
      const next = response.headers.get("x-next-page");
      if (!next) return items;
      page = Number(next);
    }
  }

  /** `HEAD` on the Repository Files API - headers only, no body, so cheap to
   * call once per file when only size/blob-id are needed (folder listings,
   * existence checks) rather than the full base64 content. */
  async function headFile(path: string): Promise<GitlabFileHead | null> {
    await ensureBranch();
    const response = await fetch(`${filesUrl(path)}?${new URLSearchParams({ ref: branch })}`, {
      method: "HEAD",
      headers: authHeaders(),
    });
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(`[drycms] GitLab API error: ${response.status} ${response.statusText}`);
    }
    return {
      size: Number(response.headers.get("x-gitlab-size") ?? "0"),
      blobId: response.headers.get("x-gitlab-blob-id") ?? "",
    };
  }

  /** Last commit touching `path` (`""` = whole branch) - git has no per-blob
   * modification time, so this is the only accurate source for
   * `modifiedAt`, same rationale as `github.ts`'s `lastModified`. */
  async function lastModified(path: string): Promise<string> {
    await ensureBranch();
    const query = new URLSearchParams({ ref_name: branch, per_page: "1" });
    if (path) query.set("path", path);
    const response = await fetch(`${apiBase}/repository/commits?${query}`, {
      headers: authHeaders(),
    });
    if (!response.ok) {
      throw new Error(`[drycms] GitLab API error: ${await readGitlabError(response)}`);
    }
    const commits = (await response.json()) as Array<{ committed_date: string }>;
    return commits[0]?.committed_date ?? new Date(0).toISOString();
  }

  /** Lazily creates a missing branch with an empty tree. GitLab's commit API
   * creates the branch from `start_branch`; deleting every source blob in the
   * first commit makes the new branch contain no repository data. */
  async function ensureBranch(): Promise<void> {
    branchReady ??= (async () => {
      const branchResponse = await fetch(
        `${apiBase}/repository/branches/${encodeURIComponent(branch)}`,
        { headers: authHeaders() },
      );
      if (branchResponse.ok) return;
      if (branchResponse.status !== 404) {
        throw new Error(`[drycms] GitLab API error: ${await readGitlabError(branchResponse)}`);
      }

      const projectResponse = await fetch(apiBase, { headers: authHeaders() });
      if (!projectResponse.ok) {
        throw new Error(`[drycms] GitLab API error: ${await readGitlabError(projectResponse)}`);
      }
      const project = (await projectResponse.json()) as GitlabProjectInfo;
      const defaultBranch = project.default_branch;
      if (!defaultBranch) {
        throw new Error(`[drycms] GitLab project does not expose a default branch for creating "${branch}".`);
      }

      const sourceTree = (await fetchTree("", true, defaultBranch)) ?? [];
      const actions: GitlabCommitAction[] = sourceTree
        .filter((item) => item.type === "blob")
        .map((item) => ({ action: "delete" as const, file_path: item.path }));
      const response = await fetch(`${apiBase}/repository/commits`, {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          branch,
          start_branch: defaultBranch,
          commit_message: `Initialize empty branch: ${branch}`,
          actions,
          allow_empty: true,
        }),
      });
      if (!response.ok) {
        // A concurrent request may have created the branch while the initial
        // branch lookup was in flight. Accept a failed create only when the
        // follow-up lookup confirms that race; surface every other failure.
        const raceCheck = await fetch(
          `${apiBase}/repository/branches/${encodeURIComponent(branch)}`,
          { headers: authHeaders() },
        );
        if (!raceCheck.ok) {
          throw new Error(`[drycms] GitLab API error: ${await readGitlabError(response)}`);
        }
      }
    })();
    return branchReady;
  }

  interface PathInfo {
    kind: "file" | "folder";
    size: number;
    blobId?: string;
    children?: GitlabTreeItem[];
  }

  /** GitLab has no single endpoint like GitHub's Contents API that reports
   * "file metadata" or "directory listing" from one path - Files and Tree
   * are separate APIs here, so disambiguating "does `relPath` exist, and is
   * it a file or a folder" costs up to two concurrent requests instead of
   * GitHub's one. */
  async function statPath(relPath: string): Promise<PathInfo | null> {
    const prefix = fullPath(relPath);
    const [file, children] = await Promise.all([headFile(prefix), fetchTree(prefix, false)]);
    if (file) return { kind: "file", size: file.size, blobId: file.blobId };
    if (children !== null) return { kind: "folder", size: 0, children };
    if (relPath === "") return { kind: "folder", size: 0, children: [] };
    return null;
  }

  /** Sum of immediate file children's sizes - GitLab's Tree API never
   * reports size (unlike GitHub's Contents API, which returns it for every
   * child in one call), so this costs one bounded-concurrency `HEAD` per
   * file child. */
  async function folderChildrenSize(children: GitlabTreeItem[]): Promise<number> {
    const blobs = children.filter((child) => child.type === "blob" && child.name !== MARKER_FILE);
    const heads = await mapWithConcurrency(blobs, CONCURRENCY_LIMIT, (blob) => headFile(blob.path));
    return heads.reduce((total, head) => total + (head?.size ?? 0), 0);
  }

  /** No `size`/`modifiedAt` (unlike `stat()`'s equivalent) - deliberately
   * skips the `headFile()`/`lastModified()`/`folderChildrenSize()` calls
   * `list()`/`listAll()` would otherwise pay per entry (GitLab's Tree API
   * carries neither). `contentHash` stays free for files - `item.id` is
   * already the blob sha, the same fallback `headFile()`'s absence already
   * used. */
  async function childStatEntry(item: GitlabTreeItem, parentRelPath: string): Promise<StorageStatEntry> {
    const relPath = joinStoragePath(parentRelPath, item.name);
    if (item.type === "blob") {
      return { path: relPath, name: item.name, kind: "file", contentHash: item.id };
    }
    const children = await fetchTree(item.path, false);
    const visible = (children ?? []).filter((child) => child.name !== MARKER_FILE);
    return { path: relPath, name: item.name, kind: "folder", fileCount: visible.length };
  }

  async function list(relPath: string): Promise<StorageStatEntry[]> {
    const prefix = fullPath(relPath);
    const children = await fetchTree(prefix, false);
    if (children === null) {
      if (relPath === "") return [];
      if (await headFile(prefix)) {
        throw new StorageError("invalid_path", `"${relPath}" is not a folder.`);
      }
      throw new StorageError("not_found", `"${relPath}" does not exist.`);
    }
    const visible = children.filter((item) => item.name !== MARKER_FILE);
    return Promise.all(visible.map((item) => childStatEntry(item, relPath)));
  }

  /** `list()` without the per-entry `HEAD`/`lastModified` round trips - just
   * the Repository Tree API pages already fetched to resolve names. Callers
   * that only need filenames (the file content engine enumerating
   * `<id>.json` records) skip the up-to-two extra requests per entry
   * `childStatEntry` pays. */
  async function listNames(relPath: string): Promise<{ name: string; kind: "file" | "folder" }[]> {
    const prefix = fullPath(relPath);
    const children = await fetchTree(prefix, false);
    if (children === null) {
      if (relPath === "") return [];
      if (await headFile(prefix)) {
        throw new StorageError("invalid_path", `"${relPath}" is not a folder.`);
      }
      throw new StorageError("not_found", `"${relPath}" does not exist.`);
    }
    return children
      .filter((item) => item.name !== MARKER_FILE)
      .map((item) => ({ name: item.name, kind: item.type === "tree" ? ("folder" as const) : ("file" as const) }));
  }

  async function stat(relPath: string): Promise<StorageStatEntry | null> {
    const info = await statPath(relPath);
    if (info === null) return null;
    const modifiedAt = await lastModified(fullPath(relPath));
    const name = relPath === "" ? "" : storagePathName(relPath);
    if (info.kind === "file") {
      return { path: relPath, name, kind: "file", size: info.size, modifiedAt, contentHash: info.blobId };
    }
    const children = info.children ?? [];
    const visible = children.filter((item) => item.name !== MARKER_FILE);
    const size = await folderChildrenSize(children);
    return { path: relPath, name, kind: "folder", size, fileCount: visible.length, modifiedAt };
  }

  async function read(relPath: string): Promise<StorageReadResult> {
    const prefix = fullPath(relPath);
    const query = new URLSearchParams({ ref: branch });
    const [response, modifiedAt] = await Promise.all([
      fetch(`${filesUrl(prefix)}/raw?${query}`, { headers: authHeaders() }),
      lastModified(prefix),
    ]);
    if (response.status === 404) {
      const isFolder = (await fetchTree(prefix, false)) !== null;
      if (isFolder) throw new StorageError("invalid_path", `"${relPath}" is a folder.`);
      throw new StorageError("not_found", `"${relPath}" does not exist.`);
    }
    if (!response.ok || !response.body) {
      throw new Error(`[drycms] GitLab API error: ${response.status} ${response.statusText}`);
    }
    return {
      stream: NodeReadable.fromWeb(response.body as unknown as Parameters<typeof NodeReadable.fromWeb>[0]),
      // `x-gitlab-size` (same header `headFile` uses) is the actual blob
      // size - `content-length` can be absent or reflect a compressed size
      // if GitLab or a proxy in front of it gzips/chunks the raw response.
      size: Number(response.headers.get("x-gitlab-size") ?? response.headers.get("content-length") ?? "0"),
      modifiedAt,
    };
  }

  async function createFile(path: string, base64Content: string, message: string): Promise<void> {
    const response = await fetch(filesUrl(path), {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ branch, content: base64Content, commit_message: message, encoding: "base64" }),
    });
    if (!response.ok) {
      throw new Error(`[drycms] GitLab API error: ${await readGitlabError(response)}`);
    }
  }

  async function updateFile(path: string, base64Content: string, message: string): Promise<void> {
    const response = await fetch(filesUrl(path), {
      method: "PUT",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ branch, content: base64Content, commit_message: message, encoding: "base64" }),
    });
    if (!response.ok) {
      throw new Error(`[drycms] GitLab API error: ${await readGitlabError(response)}`);
    }
  }

  async function mkdir(relPath: string): Promise<StorageStatEntry> {
    if (relPath === "") throw new StorageError("invalid_path", "Cannot create the storage root.");
    const prefix = fullPath(relPath);
    if ((await statPath(relPath)) !== null) {
      throw new StorageError("already_exists", `"${relPath}" already exists.`);
    }
    await createFile(joinStoragePath(prefix, MARKER_FILE), "", commitMessage("mkdir", relPath));
    return {
      path: relPath,
      name: storagePathName(relPath),
      kind: "folder",
      size: 0,
      fileCount: 0,
      modifiedAt: new Date().toISOString(),
    };
  }

  async function write(relPath: string, data: Readable | Uint8Array): Promise<StorageStatEntry> {
    if (relPath === "") throw new StorageError("invalid_path", "Cannot write to the storage root.");
    const prefix = fullPath(relPath);
    const existing = await statPath(relPath);
    if (existing?.kind === "folder") {
      throw new StorageError("invalid_path", `"${relPath}" is a folder.`);
    }

    const bytes = await bufferOf(data);
    const base64 = bytes.toString("base64");
    const message = commitMessage("write", relPath);
    if (existing) {
      await updateFile(prefix, base64, message);
    } else {
      await createFile(prefix, base64, message);
    }
    return { path: relPath, name: storagePathName(relPath), kind: "file", size: bytes.length, modifiedAt: new Date().toISOString() };
  }

  /** Every blob at or beneath `prefix`, scoped directly by the Tree API's
   * `path` parameter (unlike `github.ts`, which must fetch the *whole*
   * branch tree and filter client-side, since GitHub's recursive tree call
   * has no path-scoping option). Falls back to a single-file `HEAD` when
   * `prefix` itself names a file rather than a folder (a recursive tree
   * under a blob has nothing "under" it, so `fetchTree` 404s). */
  async function blobsUnder(prefix: string): Promise<GitlabTreeItem[]> {
    const items = await fetchTree(prefix, true);
    if (items === null) {
      const file = await headFile(prefix);
      return file ? [{ id: file.blobId, name: storagePathName(prefix), type: "blob", path: prefix }] : [];
    }
    return items.filter((entry) => entry.type === "blob");
  }

  async function commitActions(actions: GitlabCommitAction[], message: string): Promise<void> {
    const response = await fetch(`${apiBase}/repository/commits`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ branch, commit_message: message, actions }),
    });
    if (!response.ok) {
      throw new Error(`[drycms] GitLab API error: ${await readGitlabError(response)}`);
    }
  }

  async function fetchBlobBase64(sha: string): Promise<string> {
    const response = await fetch(`${apiBase}/repository/blobs/${encodeURIComponent(sha)}`, {
      headers: authHeaders(),
    });
    if (!response.ok) {
      throw new Error(`[drycms] GitLab API error: ${await readGitlabError(response)}`);
    }
    const data = (await response.json()) as { content: string };
    return data.content;
  }

  async function move(fromRel: string, toRel: string): Promise<StorageStatEntry> {
    if (fromRel === "") throw new StorageError("invalid_path", "Cannot move the storage root.");
    const fromPrefix = fullPath(fromRel);
    const toPrefix = fullPath(toRel);
    const [destExists, blobs] = await Promise.all([statPath(toRel), blobsUnder(fromPrefix)]);
    if (destExists !== null) throw new StorageError("already_exists", `"${toRel}" already exists.`);
    if (blobs.length === 0) throw new StorageError("not_found", `"${fromRel}" does not exist.`);

    // GitLab's `move` action keeps a blob's content unless new `content` is
    // supplied, so a whole-folder move is one atomic commit with no blob
    // content round trip at all - strictly cheaper than `github.ts`'s
    // fetch-then-write-then-delete-per-blob sequence.
    const actions: GitlabCommitAction[] = blobs.map((blob) => ({
      action: "move",
      previous_path: blob.path,
      file_path: toPrefix + blob.path.slice(fromPrefix.length),
    }));
    await commitActions(actions, commitMessage("move", `${fromRel} -> ${toRel}`));
    return (await stat(toRel))!;
  }

  async function copy(fromRel: string, toRel: string): Promise<StorageStatEntry> {
    if (fromRel === "") throw new StorageError("invalid_path", "Cannot copy the storage root.");
    const fromPrefix = fullPath(fromRel);
    const toPrefix = fullPath(toRel);
    const [destExists, blobs] = await Promise.all([statPath(toRel), blobsUnder(fromPrefix)]);
    if (destExists !== null) throw new StorageError("already_exists", `"${toRel}" already exists.`);
    if (blobs.length === 0) throw new StorageError("not_found", `"${fromRel}" does not exist.`);

    // No native "copy" commit action, unlike `move` - each blob's content has
    // to be read back and re-created, but still batched into one commit
    // rather than `github.ts`'s one-commit-per-blob.
    const pairs = await Promise.all(
      blobs.map(async (blob) => ({ blob, content: await fetchBlobBase64(blob.id) })),
    );
    const actions: GitlabCommitAction[] = pairs.map(({ blob, content }) => ({
      action: "create",
      file_path: toPrefix + blob.path.slice(fromPrefix.length),
      content,
      encoding: "base64",
    }));
    await commitActions(actions, commitMessage("copy", `${fromRel} -> ${toRel}`));
    return (await stat(toRel))!;
  }

  async function remove(relPath: string): Promise<void> {
    if (relPath === "") throw new StorageError("invalid_path", "Cannot delete the storage root.");
    const prefix = fullPath(relPath);
    const blobs = await blobsUnder(prefix);
    if (blobs.length === 0) throw new StorageError("not_found", `"${relPath}" does not exist.`);

    const actions: GitlabCommitAction[] = blobs.map((blob) => ({ action: "delete", file_path: blob.path }));
    await commitActions(actions, commitMessage("remove", relPath));
  }

  /** Gathers several file writes/removes into ONE commit via the Commits
   * API's multi-`action` support (already used by `move`/`copy`/`remove`
   * above) - unlike `write()`, which is one Contents-API call (and one
   * commit) per file. */
  async function writeBatch(ops: { path: string; data: Uint8Array | null }[], message: string): Promise<void> {
    if (ops.length === 0) return;
    const resolved = ops.map((op) => ({ ...op, prefix: fullPath(op.path) }));
    const existing = await Promise.all(resolved.map((op) => statPath(op.path)));
    const actions: GitlabCommitAction[] = resolved.map((op, i) => {
      if (op.data === null) return { action: "delete", file_path: op.prefix };
      const content = Buffer.from(op.data).toString("base64");
      return {
        action: existing[i] ? "update" : "create",
        file_path: op.prefix,
        content,
        encoding: "base64",
      };
    });
    await commitActions(actions, message);
  }

  async function listAll(): Promise<StorageStatEntry[]> {
    const tree = await fetchTree(root, true);
    const items = tree ?? [];

    // Every folder's *recursive* size/fileCount comes from this same flat
    // list afterward (`applyRecursiveFolderTotals`); no `size`/`modifiedAt` -
    // same doc rationale as `childStatEntry`. `contentHash` for files is
    // free - `entry.id` is already the blob sha, recursive or not.
    const entries: StorageStatEntry[] = [];
    for (const entry of items) {
      const relPath = stripRoot(root, entry.path);
      if (relPath === null || relPath === "") continue;
      const name = storagePathName(relPath);
      if (name === MARKER_FILE) continue;
      entries.push(
        entry.type === "blob"
          ? { path: relPath, name, kind: "file", contentHash: entry.id }
          : { path: relPath, name, kind: "folder", size: 0, fileCount: 0 },
      );
    }
    return applyRecursiveFolderTotals(entries);
  }

  return { list, listNames, listAll, stat, read, mkdir, write, move, copy, remove, writeBatch };
}
