import type { Readable } from "node:stream";
import { Readable as NodeReadable } from "node:stream";
import type { ResolvedGithubStorageOption } from "../integration/options.js";
import { applyRecursiveFolderTotals } from "./aggregate.js";
import { joinStoragePath, storagePathName } from "./path.js";
import {
  StorageError,
  type StorageAdapter,
  type StorageReadResult,
  type StorageStatEntry,
} from "./types.js";
import { bufferOf, commitMessage, mapWithConcurrency, stripRoot } from "./util.js";

/** Empty-folder marker - see `local.ts`'s `MARKER_FILE`. Doubly necessary
 * here: git has no native concept of an empty directory at all, so without
 * this a freshly-`mkdir`'d folder would vanish the instant it has no other
 * blob under it. */
const MARKER_FILE = ".dir";
const API_VERSION = "2022-11-28";

/** Cloudflare Workers' fetch extension (the `cf` object) - a plain no-op
 * property everywhere else (Node's `fetch` ignores unknown `RequestInit`
 * fields), so safe to set unconditionally regardless of which runtime this
 * adapter ends up on. Not part of the standard `RequestInit` type (this
 * project has no `@cloudflare/workers-types` dependency), hence the local
 * extension instead of a cast at every call site. */
interface CloudflareRequestInit extends RequestInit {
  cf?: { cacheEverything?: boolean; cacheTtl?: number };
}

/** `git/blobs/{sha}` is the one GitHub GET in this file safe to cache at the
 * edge without any invalidation story: the URL is content-addressed by
 * `sha`, so the same sha can only ever resolve to the same bytes - unlike
 * `list`/`stat`/`lastModified`/the recursive tree, none of which are cached
 * here since they reflect state this same adapter can itself have just
 * written (caching those would risk a stale read right after a write). A
 * year is effectively "as long as Cloudflare will keep it" for content that,
 * by construction, never goes stale. */
const IMMUTABLE_BLOB_CACHE_TTL_SECONDS = 60 * 60 * 24 * 365;

interface GithubContentItem {
  name: string;
  path: string;
  sha: string;
  size: number;
  type: "file" | "dir" | "symlink" | "submodule";
}

/** A flattened, recursive `git/trees` entry - only used for folder-wide
 * move/copy/remove, where it replaces both the N nested `contents` listing
 * calls a naive recursion would need *and* the GET-before-DELETE a plain
 * `contents` delete would need (the tree already carries each blob's `sha`). */
interface GithubTreeEntry {
  path: string;
  type: "blob" | "tree" | "commit";
  sha: string;
  size?: number;
}

function encodePath(path: string): string {
  return path.split("/").filter(Boolean).map(encodeURIComponent).join("/");
}

/** Max concurrent `lastModified` lookups while resolving dates for `listAll`.
 * `list()`/`stat()` are bounded by "however many items are in one folder" and
 * can fire every lookup at once; `listAll` can cover an entire repo, so an
 * unbounded `Promise.all` there risks opening far too many sockets at once. */
const LISTALL_DATE_CONCURRENCY = 24;

/**
 * Backend for `kind: 'github'`: reads/writes a GitHub repo's contents via the
 * REST Contents API, using the Git Data API's recursive tree only where a
 * folder-wide operation needs every descendant blob at once (move/copy/
 * remove). Every mutating call is its own commit, named
 * `"<ISO-8601 UTC> <action>: <path>"`.
 */
export function createGithubStorageAdapter(option: ResolvedGithubStorageOption): StorageAdapter {
  const { owner, repo, branch, token, root } = option;
  const apiBase = `https://api.github.com/repos/${owner}/${repo}`;

  function fullPath(relPath: string): string {
    return joinStoragePath(root, relPath);
  }

  function authHeaders(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": API_VERSION,
      ...extra,
    };
  }

  async function readGithubError(response: Response): Promise<string> {
    try {
      const body = (await response.json()) as { message?: string };
      return body.message ?? `${response.status} ${response.statusText}`;
    } catch {
      return `${response.status} ${response.statusText}`;
    }
  }

  function contentsPath(path: string): string {
    const encoded = encodePath(path);
    return encoded ? `${apiBase}/contents/${encoded}` : `${apiBase}/contents`;
  }

  /** `null` on 404 - a file/folder not existing is an expected outcome here,
   * not an error, since every caller uses this for existence/sha checks.
   * A missing *branch*, though, is not: GitHub's own 404 body distinguishes
   * the two ("No commit found for the ref ..." vs. a plain "Not Found"), and
   * without checking for it a bad `GITHUB_BRANCH` would silently read back as
   * an empty (rather than nonexistent) storage root - see `list("")`. */
  async function getContent(
    path: string,
  ): Promise<GithubContentItem | GithubContentItem[] | null> {
    const query = new URLSearchParams({ ref: branch });
    const response = await fetch(`${contentsPath(path)}?${query}`, {
      headers: authHeaders({ Accept: "application/vnd.github+json" }),
    });
    if (response.status === 404) {
      const message = await readGithubError(response);
      if (message.startsWith("No commit found for the ref")) {
        throw new Error(
          `[drycms] GitHub branch "${branch}" does not exist in ${owner}/${repo}.`,
        );
      }
      return null;
    }
    if (!response.ok) {
      throw new Error(`[drycms] GitHub API error: ${await readGithubError(response)}`);
    }
    return response.json() as Promise<GithubContentItem | GithubContentItem[]>;
  }

  /** Last commit touching `path` (`""` = whole branch) - git has no per-blob
   * modification time, so this is the only accurate source for
   * `modifiedAt`. One request per entry; callers run these in parallel. */
  async function lastModified(path: string): Promise<string> {
    const query = new URLSearchParams({ sha: branch, per_page: "1" });
    if (path) query.set("path", path);
    const response = await fetch(`${apiBase}/commits?${query}`, {
      headers: authHeaders({ Accept: "application/vnd.github+json" }),
    });
    if (!response.ok) {
      throw new Error(`[drycms] GitHub API error: ${await readGithubError(response)}`);
    }
    const commits = (await response.json()) as Array<{ commit: { committer: { date: string } } }>;
    return commits[0]?.commit.committer.date ?? new Date(0).toISOString();
  }

  async function putRaw(
    path: string,
    content: string,
    message: string,
    sha?: string,
  ): Promise<void> {
    const body: Record<string, unknown> = { message, branch, content };
    if (sha) body.sha = sha;
    const response = await fetch(contentsPath(path), {
      method: "PUT",
      headers: authHeaders({ "Content-Type": "application/json", Accept: "application/vnd.github+json" }),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`[drycms] GitHub API error: ${await readGithubError(response)}`);
    }
  }

  async function deleteContent(path: string, sha: string, message: string): Promise<void> {
    const response = await fetch(contentsPath(path), {
      method: "DELETE",
      headers: authHeaders({ "Content-Type": "application/json", Accept: "application/vnd.github+json" }),
      body: JSON.stringify({ message, sha, branch }),
    });
    if (!response.ok) {
      throw new Error(`[drycms] GitHub API error: ${await readGithubError(response)}`);
    }
  }

  async function toStatEntry(item: GithubContentItem, parentRelPath: string): Promise<StorageStatEntry> {
    const relPath = joinStoragePath(parentRelPath, item.name);
    if (item.type !== "dir") {
      const modifiedAt = await lastModified(item.path);
      return { path: relPath, name: item.name, kind: "file", size: item.size, modifiedAt, contentHash: item.sha };
    }
    // A folder needs both its last-commit date and its own children (for
    // size/fileCount) - two independent GitHub calls, fetched concurrently
    // instead of paying for both round trips in sequence.
    const [modifiedAt, children] = await Promise.all([lastModified(item.path), getContent(item.path)]);
    const childArray = Array.isArray(children) ? children : [];
    const visible = childArray.filter((child) => child.name !== MARKER_FILE);
    let size = 0;
    for (const child of childArray) if (child.type === "file") size += child.size;
    return { path: relPath, name: item.name, kind: "folder", size, fileCount: visible.length, modifiedAt };
  }

  async function list(relPath: string): Promise<StorageStatEntry[]> {
    const data = await getContent(fullPath(relPath));
    if (data === null) {
      // An empty branch/prefix 404s on the Contents API - unlike `local.ts`
      // (whose root directory always exists once `ensureRoot` runs), there is
      // no real "create the root" step here, so the storage root has to be
      // treated as legitimately-empty rather than not_found.
      if (relPath === "") return [];
      throw new StorageError("not_found", `"${relPath}" does not exist.`);
    }
    if (!Array.isArray(data)) throw new StorageError("invalid_path", `"${relPath}" is not a folder.`);
    return Promise.all(
      data.filter((item) => item.name !== MARKER_FILE).map((item) => toStatEntry(item, relPath)),
    );
  }

  async function stat(relPath: string): Promise<StorageStatEntry | null> {
    const prefix = fullPath(relPath);
    // getContent and lastModified are independent GitHub calls - run them
    // concurrently rather than in sequence. lastModified never 404s on a
    // missing path (GitHub's `/commits` just returns an empty list), so this
    // is safe even when `data` turns out to be null below.
    const [data, modifiedAt] = await Promise.all([getContent(prefix), lastModified(prefix)]);
    if (data === null) {
      if (relPath === "") {
        return { path: "", name: "", kind: "folder", size: 0, fileCount: 0, modifiedAt: new Date(0).toISOString() };
      }
      return null;
    }

    const name = relPath === "" ? "" : storagePathName(relPath);
    if (!Array.isArray(data)) {
      return { path: relPath, name, kind: "file", size: data.size, modifiedAt, contentHash: data.sha };
    }
    const visible = data.filter((item) => item.name !== MARKER_FILE);
    let size = 0;
    for (const item of data) if (item.type === "file") size += item.size;
    return { path: relPath, name, kind: "folder", size, fileCount: visible.length, modifiedAt };
  }

  async function read(relPath: string): Promise<StorageReadResult> {
    const prefix = fullPath(relPath);
    const meta = await getContent(prefix);
    if (meta === null) throw new StorageError("not_found", `"${relPath}" does not exist.`);
    if (Array.isArray(meta)) throw new StorageError("invalid_path", `"${relPath}" is a folder.`);

    const query = new URLSearchParams({ ref: branch });
    // The raw content fetch and the last-commit lookup are independent -
    // run them concurrently instead of paying for both round trips in sequence.
    const [response, modifiedAt] = await Promise.all([
      fetch(`${contentsPath(prefix)}?${query}`, {
        headers: authHeaders({ Accept: "application/vnd.github.raw" }),
      }),
      lastModified(prefix),
    ]);
    if (!response.ok || !response.body) {
      throw new Error(`[drycms] GitHub API error: ${await readGithubError(response)}`);
    }
    return {
      stream: NodeReadable.fromWeb(
        response.body as unknown as Parameters<typeof NodeReadable.fromWeb>[0],
      ),
      size: meta.size,
      modifiedAt,
    };
  }

  async function mkdir(relPath: string): Promise<StorageStatEntry> {
    if (relPath === "") throw new StorageError("invalid_path", "Cannot create the storage root.");
    const prefix = fullPath(relPath);
    if ((await getContent(prefix)) !== null) {
      throw new StorageError("already_exists", `"${relPath}" already exists.`);
    }
    await putRaw(joinStoragePath(prefix, MARKER_FILE), "", commitMessage("mkdir", relPath));
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
    const existing = await getContent(prefix);
    if (existing !== null && Array.isArray(existing)) {
      throw new StorageError("invalid_path", `"${relPath}" is a folder.`);
    }

    const bytes = await bufferOf(data);
    const sha = existing && !Array.isArray(existing) ? existing.sha : undefined;
    await putRaw(prefix, bytes.toString("base64"), commitMessage("write", relPath), sha);
    return {
      path: relPath,
      name: storagePathName(relPath),
      kind: "file",
      size: bytes.length,
      modifiedAt: new Date().toISOString(),
    };
  }

  /** The whole branch's tree, flattened, in one call - shared by `blobsUnder`
   * (folder-wide move/copy/remove) and `listAll`. GitHub truncates this
   * response past a size limit (`truncated: true`, with `tree` cut short) -
   * silently proceeding would make `remove`/`move`/`listAll` act on a subset
   * of the real tree, so this throws instead of returning a partial view. */
  async function fetchRecursiveTree(): Promise<GithubTreeEntry[]> {
    const response = await fetch(`${apiBase}/git/trees/${encodeURIComponent(branch)}?recursive=1`, {
      headers: authHeaders({ Accept: "application/vnd.github+json" }),
    });
    if (!response.ok) {
      throw new Error(`[drycms] GitHub API error: ${await readGithubError(response)}`);
    }
    const data = (await response.json()) as { tree: GithubTreeEntry[]; truncated: boolean };
    if (data.truncated) {
      throw new Error(
        `[drycms] GitHub repository tree for "${owner}/${repo}"@"${branch}" is too large for one recursive request (truncated) - move/copy/remove/listAll need a smaller repo or a narrower storage \`root\`.`,
      );
    }
    return data.tree;
  }

  /** Every blob at or beneath `prefix` (a single entry if `prefix` names a
   * file), fetched via one recursive tree call instead of N nested
   * `contents` listings. */
  async function blobsUnder(prefix: string): Promise<GithubTreeEntry[]> {
    const tree = await fetchRecursiveTree();
    return tree.filter(
      (entry) => entry.type === "blob" && (entry.path === prefix || entry.path.startsWith(`${prefix}/`)),
    );
  }

  async function listAll(): Promise<StorageStatEntry[]> {
    const tree = await fetchRecursiveTree();

    interface ScopedNode {
      relPath: string;
      type: "blob" | "tree";
      size: number;
      sha: string;
    }
    const scoped: ScopedNode[] = [];
    for (const entry of tree) {
      if (entry.type !== "blob" && entry.type !== "tree") continue;
      const relPath = stripRoot(root, entry.path);
      if (relPath === null || relPath === "") continue;
      if (storagePathName(relPath) === MARKER_FILE) continue;
      scoped.push({ relPath, type: entry.type, size: entry.size ?? 0, sha: entry.sha });
    }

    // Every folder's *recursive* size/fileCount is derived from this same
    // flat tree afterward (`applyRecursiveFolderTotals`) - no extra GitHub
    // calls needed for structure, only `modifiedAt` below actually requires
    // one request per entry. Folders start at size 0/fileCount 0, overwritten
    // by that pass.
    const entries = await mapWithConcurrency(scoped, LISTALL_DATE_CONCURRENCY, async (node): Promise<StorageStatEntry> => {
      const modifiedAt = await lastModified(fullPath(node.relPath));
      const name = storagePathName(node.relPath);
      if (node.type === "blob") {
        return { path: node.relPath, name, kind: "file", size: node.size, modifiedAt, contentHash: node.sha };
      }
      return { path: node.relPath, name, kind: "folder", size: 0, fileCount: 0, modifiedAt };
    });
    return applyRecursiveFolderTotals(entries);
  }

  async function fetchBlobBase64(sha: string): Promise<string> {
    const init: CloudflareRequestInit = {
      headers: authHeaders({ Accept: "application/vnd.github+json" }),
      cf: { cacheEverything: true, cacheTtl: IMMUTABLE_BLOB_CACHE_TTL_SECONDS },
    };
    const response = await fetch(`${apiBase}/git/blobs/${sha}`, init);
    if (!response.ok) {
      throw new Error(`[drycms] GitHub API error: ${await readGithubError(response)}`);
    }
    const data = (await response.json()) as { content: string };
    return data.content.replace(/\n/g, "");
  }

  async function move(fromRel: string, toRel: string): Promise<StorageStatEntry> {
    if (fromRel === "") throw new StorageError("invalid_path", "Cannot move the storage root.");
    const fromPrefix = fullPath(fromRel);
    const toPrefix = fullPath(toRel);
    // Destination check and source listing are independent - fetch concurrently.
    const [destExists, blobs] = await Promise.all([getContent(toPrefix), blobsUnder(fromPrefix)]);
    if (destExists !== null) throw new StorageError("already_exists", `"${toRel}" already exists.`);
    if (blobs.length === 0) throw new StorageError("not_found", `"${fromRel}" does not exist.`);

    const message = commitMessage("move", `${fromRel} -> ${toRel}`);
    // Blob content reads are independent and safe to parallelize. The
    // writes/deletes below stay sequential: each is its own commit built off
    // the branch's current HEAD, so firing them concurrently would race the
    // ref update and risk spurious 409s.
    const pairs = await Promise.all(
      blobs.map(async (blob) => ({ blob, content: await fetchBlobBase64(blob.sha) })),
    );
    for (const { blob, content } of pairs) {
      const destPath = toPrefix + blob.path.slice(fromPrefix.length);
      await putRaw(destPath, content, message);
      await deleteContent(blob.path, blob.sha, message);
    }
    return (await stat(toRel))!;
  }

  async function copy(fromRel: string, toRel: string): Promise<StorageStatEntry> {
    if (fromRel === "") throw new StorageError("invalid_path", "Cannot copy the storage root.");
    const fromPrefix = fullPath(fromRel);
    const toPrefix = fullPath(toRel);
    // Destination check and source listing are independent - fetch concurrently.
    const [destExists, blobs] = await Promise.all([getContent(toPrefix), blobsUnder(fromPrefix)]);
    if (destExists !== null) throw new StorageError("already_exists", `"${toRel}" already exists.`);
    if (blobs.length === 0) throw new StorageError("not_found", `"${fromRel}" does not exist.`);

    const message = commitMessage("copy", `${fromRel} -> ${toRel}`);
    // Same rationale as `move`: reads parallelize freely, writes stay
    // sequential to avoid racing the branch ref across concurrent commits.
    const pairs = await Promise.all(
      blobs.map(async (blob) => ({ blob, content: await fetchBlobBase64(blob.sha) })),
    );
    for (const { blob, content } of pairs) {
      const destPath = toPrefix + blob.path.slice(fromPrefix.length);
      await putRaw(destPath, content, message);
    }
    return (await stat(toRel))!;
  }

  async function remove(relPath: string): Promise<void> {
    if (relPath === "") throw new StorageError("invalid_path", "Cannot delete the storage root.");
    const prefix = fullPath(relPath);
    const blobs = await blobsUnder(prefix);
    if (blobs.length === 0) throw new StorageError("not_found", `"${relPath}" does not exist.`);

    const message = commitMessage("remove", relPath);
    for (const blob of blobs) {
      await deleteContent(blob.path, blob.sha, message);
    }
  }

  return { list, listAll, stat, read, mkdir, write, move, copy, remove };
}
