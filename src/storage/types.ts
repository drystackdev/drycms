import type { Readable } from "node:stream";

export interface StorageStatEntry {
  /** Relative POSIX path from the storage root. `''` = root. */
  path: string;
  name: string;
  kind: "file" | "folder";
  /** Bytes. For folders, `list()`/`stat()` report the total of *immediate*
   * children only (cheap - already stat'd during that same call); `listAll()`
   * reports a true recursive aggregate instead (every descendant file at any
   * depth) - see `applyRecursiveFolderTotals`, free there since the whole
   * tree is already in memory. */
  /** Optional when a backend cannot determine it cheaply. */
  size?: number;
  /** Optional modification timestamp. */
  modifiedAt?: string;
  /** Folders only. Immediate children from `list()`/`stat()`; every
   * descendant file (recursive, not counting subfolders themselves) from
   * `listAll()` - same size/recursive split as above. */
  fileCount?: number;
  /** Files only: a stable content hash where the backend provides one. */
  contentHash?: string;
}

export interface StorageReadResult {
  stream: Readable;
  size: number;
  modifiedAt: string;
}

export type StorageErrorCode =
  | "invalid_path"
  | "not_found"
  | "already_exists"
  | "unsupported";

export class StorageError extends Error {
  code: StorageErrorCode;

  constructor(code: StorageErrorCode, message: string) {
    super(message);
    this.name = "StorageError";
    this.code = code;
  }
}

/**
 * Backend for `kind: 'local'` today; the interface is shaped so future kinds
 * (R2, S3, ...) can implement it without changing callers.
 * Adapters are permissive - they create missing parents on write/mkdir - the
 * route layer enforces product-level rules (e.g. "upload target must exist").
 */
export interface StorageAdapter {
  /** One level deep. `.dir` marker files are excluded. */
  list(path: string): Promise<StorageStatEntry[]>;
  /** Same directory `list()` reads, but names/kind only - no `modifiedAt`.
   * Optional: falls back to `list()` (dropping the extra fields) wherever a
   * backend doesn't override it. */
  listNames?(path: string): Promise<{ name: string; kind: "file" | "folder" }[]>;
  /** Every file/folder at every depth, flattened, in one round trip - lets a
   * client prefetch the whole tree instead of paying a `list()` per folder as
   * the user navigates. Optional: only implemented where a full tree is
   * actually cheap to produce (`local` - one recursive `readdir` walk on the
   * same disk). Deliberately absent
   * for object-storage kinds (R2/S3): those paginate by prefix/delimiter, and
   * a full-bucket listing there would be the exact cost that pagination
   * exists to avoid. Callers must fall back to per-folder `list()` when this
   * is `undefined`. Folders in the result carry a true recursive
   * size/fileCount (see `StorageStatEntry.size`), unlike `list()`/`stat()`. */
  listAll?(): Promise<StorageStatEntry[]>;
  stat(path: string): Promise<StorageStatEntry | null>;
  read(path: string): Promise<StorageReadResult>;
  /** Writes the `.dir` marker; creates missing parents. */
  mkdir(path: string): Promise<StorageStatEntry>;
  /** Create-or-overwrite; creates missing parents. */
  write(path: string, data: Readable | Uint8Array): Promise<StorageStatEntry>;
  /** Recursive for folders. */
  move(from: string, to: string): Promise<StorageStatEntry>;
  /** Recursive for folders; destination must not already exist. */
  copy(from: string, to: string): Promise<StorageStatEntry>;
  /** Recursive for folders. */
  remove(path: string): Promise<void>;
  /** Optional batch mutation hook; `data: null` means remove. */
  writeBatch?(ops: { path: string; data: Uint8Array | null }[], message: string): Promise<void>;
}
