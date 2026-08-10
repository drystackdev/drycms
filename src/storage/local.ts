import { createReadStream, createWriteStream } from "node:fs";
import * as fs from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { applyRecursiveFolderTotals } from "./aggregate.js";
import {
  joinStoragePath,
  resolveWithinRoot,
  storagePathName,
} from "./path.js";
import {
  StorageError,
  type StorageAdapter,
  type StorageReadResult,
  type StorageStatEntry,
} from "./types.js";

/** Empty-folder marker (0 bytes) - the convention this design intentionally
 * shares with future object-storage kinds (R2/S3 have no native "directory"
 * either), so it's used here even though real filesystems support empty dirs
 * natively. Always excluded from `list()` output. */
const MARKER_FILE = ".dir";

/** Also hides `.tmp.<collection>.<user>` entry-media staging folders
 * (`content-types/entry-media-paths.ts`) and `.avatar` (`AvatarField.tsx`'s
 * upload target, `field-registry.ts`'s `avatarFieldType`) from every listing
 * - both are implementation details never meant to be Media-browsable. A
 * file inside `.avatar` is still directly readable by id/URL - only the
 * folder itself is hidden from `list()`/`listAll()`. */
function isHiddenName(name: string): boolean {
  return name === MARKER_FILE || name === ".avatar" || name.startsWith(".tmp.");
}

function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

async function statOrNull(absPath: string): Promise<import("node:fs").Stats | null> {
  try {
    return await fs.stat(absPath);
  } catch (error) {
    if (isErrno(error, "ENOENT")) return null;
    throw error;
  }
}

export function createLocalStorageAdapter(root: string): StorageAdapter {
  let rootReady: Promise<void> | null = null;
  function ensureRoot(): Promise<void> {
    rootReady ??= fs.mkdir(root, { recursive: true }).then(() => undefined);
    return rootReady;
  }

  /** Folders report `size`/`fileCount` for their *immediate* children only -
   * cheap (one extra `readdir`+`stat` level, no recursion) and accurate,
   * unlike a fabricated deep aggregate. */
  async function statEntry(
    absPath: string,
    relPath: string,
    name: string,
    includeHidden = false,
  ): Promise<StorageStatEntry> {
    const stats = await fs.stat(absPath);
    if (!stats.isDirectory()) {
      return { path: relPath, name, kind: "file", size: stats.size, modifiedAt: stats.mtime.toISOString() };
    }

    const children = await fs.readdir(absPath, { withFileTypes: true });
    let size = 0;
    let fileCount = 0;
    for (const child of children) {
      if (isHiddenName(child.name) && !includeHidden) continue;
      fileCount += 1;
      const childStats = await statOrNull(join(absPath, child.name));
      if (childStats && !childStats.isDirectory()) size += childStats.size;
    }
    return {
      path: relPath,
      name,
      kind: "folder",
      size,
      fileCount,
      modifiedAt: stats.mtime.toISOString(),
    };
  }

  async function list(relPath: string, includeHidden = false): Promise<StorageStatEntry[]> {
    await ensureRoot();
    const dir = relPath === "" ? root : resolveWithinRoot(root, relPath);
    let dirents: import("node:fs").Dirent[];
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (isErrno(error, "ENOENT")) {
        throw new StorageError("not_found", `"${relPath}" does not exist.`);
      }
      if (isErrno(error, "ENOTDIR")) {
        throw new StorageError("invalid_path", `"${relPath}" is not a folder.`);
      }
      throw error;
    }

    const entries: StorageStatEntry[] = [];
    for (const dirent of dirents) {
      if (isHiddenName(dirent.name) && !includeHidden) continue;
      const childRelPath = joinStoragePath(relPath, dirent.name);
      entries.push(await statEntry(join(dir, dirent.name), childRelPath, dirent.name, includeHidden));
    }
    return entries;
  }

  /** `list()` without the per-entry `fs.stat` - names/kind only, straight off
   * the one `readdir`. Local disk reads are cheap either way, but this keeps
   * the interface honest and callers uniform across backends. */
  async function listNames(relPath: string): Promise<{ name: string; kind: "file" | "folder" }[]> {
    await ensureRoot();
    const dir = relPath === "" ? root : resolveWithinRoot(root, relPath);
    let dirents: import("node:fs").Dirent[];
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch (error) {
      if (isErrno(error, "ENOENT")) {
        throw new StorageError("not_found", `"${relPath}" does not exist.`);
      }
      if (isErrno(error, "ENOTDIR")) {
        throw new StorageError("invalid_path", `"${relPath}" is not a folder.`);
      }
      throw error;
    }
    return dirents
      .filter((dirent) => !isHiddenName(dirent.name))
      .map((dirent) => ({ name: dirent.name, kind: dirent.isDirectory() ? ("folder" as const) : ("file" as const) }));
  }

  /** Every file/folder under `root`, flattened - one recursive walk on the
   * same disk `list()`/`stat()` already hit; still one `readdir`+`stat`
   * per entry, same total work `list()` would do if called once per folder. */
  async function listAll(includeHidden = false): Promise<StorageStatEntry[]> {
    await ensureRoot();
    const results: StorageStatEntry[] = [];
    async function walk(absDir: string, relDir: string): Promise<void> {
      const dirents = await fs.readdir(absDir, { withFileTypes: true });
      for (const dirent of dirents) {
        if (isHiddenName(dirent.name) && !includeHidden) continue;
        const relPath = joinStoragePath(relDir, dirent.name);
        const absPath = join(absDir, dirent.name);
        results.push(await statEntry(absPath, relPath, dirent.name, includeHidden));
        if (dirent.isDirectory()) await walk(absPath, relPath);
      }
    }
    await walk(root, "");
    return applyRecursiveFolderTotals(results);
  }

  async function stat(relPath: string): Promise<StorageStatEntry | null> {
    await ensureRoot();
    const absPath = relPath === "" ? root : resolveWithinRoot(root, relPath);
    const exists = await statOrNull(absPath);
    if (!exists) return null;
    return statEntry(absPath, relPath, relPath === "" ? "" : storagePathName(relPath));
  }

  async function read(relPath: string): Promise<StorageReadResult> {
    await ensureRoot();
    const absPath = resolveWithinRoot(root, relPath);
    const stats = await statOrNull(absPath);
    if (!stats) throw new StorageError("not_found", `"${relPath}" does not exist.`);
    if (!stats.isFile()) throw new StorageError("invalid_path", `"${relPath}" is not a file.`);
    return { stream: createReadStream(absPath), size: stats.size, modifiedAt: stats.mtime.toISOString() };
  }

  async function mkdir(relPath: string): Promise<StorageStatEntry> {
    await ensureRoot();
    if (relPath === "") throw new StorageError("invalid_path", "Cannot create the storage root.");
    const absPath = resolveWithinRoot(root, relPath);
    if (await statOrNull(absPath)) {
      throw new StorageError("already_exists", `"${relPath}" already exists.`);
    }
    await fs.mkdir(absPath, { recursive: true });
    await fs.writeFile(join(absPath, MARKER_FILE), new Uint8Array(0));
    return statEntry(absPath, relPath, storagePathName(relPath));
  }

  async function write(
    relPath: string,
    data: Readable | Uint8Array,
  ): Promise<StorageStatEntry> {
    await ensureRoot();
    if (relPath === "") throw new StorageError("invalid_path", "Cannot write to the storage root.");
    const absPath = resolveWithinRoot(root, relPath);
    const existing = await statOrNull(absPath);
    if (existing?.isDirectory()) {
      throw new StorageError("invalid_path", `"${relPath}" is a folder.`);
    }
    await fs.mkdir(dirname(absPath), { recursive: true });
    if (data instanceof Uint8Array) {
      await fs.writeFile(absPath, data);
    } else {
      await pipeline(data, createWriteStream(absPath));
    }
    return statEntry(absPath, relPath, storagePathName(relPath));
  }

  async function move(fromRel: string, toRel: string): Promise<StorageStatEntry> {
    await ensureRoot();
    if (fromRel === "") throw new StorageError("invalid_path", "Cannot move the storage root.");
    const fromAbs = resolveWithinRoot(root, fromRel);
    const toAbs = resolveWithinRoot(root, toRel);
    if (!(await statOrNull(fromAbs))) {
      throw new StorageError("not_found", `"${fromRel}" does not exist.`);
    }
    if (await statOrNull(toAbs)) {
      throw new StorageError("already_exists", `"${toRel}" already exists.`);
    }
    await fs.mkdir(dirname(toAbs), { recursive: true });
    await fs.rename(fromAbs, toAbs);
    return statEntry(toAbs, toRel, storagePathName(toRel));
  }

  async function copy(fromRel: string, toRel: string): Promise<StorageStatEntry> {
    await ensureRoot();
    if (fromRel === "") throw new StorageError("invalid_path", "Cannot copy the storage root.");
    const fromAbs = resolveWithinRoot(root, fromRel);
    const toAbs = resolveWithinRoot(root, toRel);
    if (!(await statOrNull(fromAbs))) {
      throw new StorageError("not_found", `"${fromRel}" does not exist.`);
    }
    if (await statOrNull(toAbs)) {
      throw new StorageError("already_exists", `"${toRel}" already exists.`);
    }
    await fs.mkdir(dirname(toAbs), { recursive: true });
    await fs.cp(fromAbs, toAbs, { recursive: true });
    return statEntry(toAbs, toRel, storagePathName(toRel));
  }

  async function remove(relPath: string): Promise<void> {
    await ensureRoot();
    if (relPath === "") throw new StorageError("invalid_path", "Cannot delete the storage root.");
    const absPath = resolveWithinRoot(root, relPath);
    if (!(await statOrNull(absPath))) {
      throw new StorageError("not_found", `"${relPath}" does not exist.`);
    }
    await fs.rm(absPath, { recursive: true, force: true });
  }

  return { list, listNames, listAll, stat, read, mkdir, write, move, copy, remove };
}
