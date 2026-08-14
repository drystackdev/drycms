import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { bufferOf } from "./util.js";
import { StorageError, type StorageAdapter, type StorageReadResult, type StorageStatEntry } from "./types.js";

/** Empty-folder marker, same convention `local.ts` uses (R2 has no native
 * "directory" either - see that file's own comment). */
const MARKER_FILE = ".dir";

/** Also hides `.tmp.<collection>.<user>` entry-media staging folders
 * (`content-types/entry-media-paths.ts`), `.avatar`
 * (`AvatarField.tsx`'s upload target), and `.seeded`
 * (`pages-source-seed.ts`'s auto-seed marker) from every listing - see
 * `local.ts`'s identical helper for why. */
function isHiddenName(name: string): boolean {
  return name === MARKER_FILE || name === ".avatar" || name === ".seeded" || name.startsWith(".tmp.");
}

export interface R2ObjectLike {
  key: string;
  size: number;
  uploaded: Date;
  httpEtag?: string;
}

export interface R2ObjectBodyLike extends R2ObjectLike {
  body: ReadableStream;
}

export interface R2ListResultLike {
  objects: R2ObjectLike[];
  truncated: boolean;
  cursor?: string;
  delimitedPrefixes: string[];
}

/**
 * The slice of Cloudflare's real `R2Bucket` binding this adapter needs -
 * hand-rolled instead of depending on `@cloudflare/workers-types` (see
 * `feedback_prefer_api_over_library`), same approach `kv/cloudflare-kv.ts`'s
 * `CloudflareKvNamespace` already takes for KV.
 */
export interface R2BucketLike {
  get(key: string): Promise<R2ObjectBodyLike | null>;
  head(key: string): Promise<R2ObjectLike | null>;
  put(key: string, value: Uint8Array): Promise<R2ObjectLike>;
  delete(keys: string | string[]): Promise<void>;
  list(options?: { prefix?: string; delimiter?: string; cursor?: string; limit?: number }): Promise<R2ListResultLike>;
}

export function createR2StorageAdapter(bucket: R2BucketLike, prefix: string): StorageAdapter {
  const base = prefix ? `${prefix}/` : "";

  function fileKey(relPath: string): string {
    return `${base}${relPath}`;
  }
  function folderListPrefix(relPath: string): string {
    return relPath ? `${base}${relPath}/` : base;
  }
  function markerKey(relPath: string): string {
    return `${folderListPrefix(relPath)}${MARKER_FILE}`;
  }
  function entryName(key: string, parentPrefix: string): string {
    return key.slice(parentPrefix.length);
  }

  /** One directory listing (immediate children only), same shape `local.ts`'s
   * `list()` produces - folders get no `size`/`fileCount` here (a cheap
   * count needs a second pass, done by `stat()`/`list()` themselves via
   * `aggregateFolder` below), files get real `size`/`modifiedAt`. */
  async function listRaw(relPath: string, includeHidden = false): Promise<{ files: StorageStatEntry[]; folders: string[] }> {
    const listPrefix = folderListPrefix(relPath);
    const files: StorageStatEntry[] = [];
    const folders: string[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await bucket.list({ prefix: listPrefix, delimiter: "/", cursor, limit: 1000 });
      for (const object of page.objects) {
        const name = entryName(object.key, listPrefix);
        if (isHiddenName(name) && !includeHidden) continue;
        files.push({
          path: relPath ? `${relPath}/${name}` : name,
          name,
          kind: "file",
          size: object.size,
          modifiedAt: object.uploaded.toISOString(),
          ...(object.httpEtag ? { contentHash: object.httpEtag } : {}),
        });
      }
      for (const delimited of page.delimitedPrefixes) {
        const name = entryName(delimited, listPrefix).replace(/\/$/, "");
        if (name && (includeHidden || !isHiddenName(name))) folders.push(name);
      }
      if (!page.truncated || !page.cursor) break;
      cursor = page.cursor;
    }
    return { files, folders };
  }

  /** Every key under `relPath`'s prefix, flat (no delimiter) - used by
   * `move`/`copy`/`remove` on a folder, where the real recursive contents
   * (not just one level) are needed. Deliberately not exposed as the
   * adapter's `listAll` - see `StorageAdapter.listAll`'s own doc comment on
   * why object-storage kinds skip that method for directory browsing. */
  async function listAllKeysRaw(relPath: string): Promise<R2ObjectLike[]> {
    const listPrefix = folderListPrefix(relPath);
    const objects: R2ObjectLike[] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await bucket.list({ prefix: listPrefix, cursor, limit: 1000 });
      objects.push(...page.objects);
      if (!page.truncated || !page.cursor) break;
      cursor = page.cursor;
    }
    return objects;
  }

  async function aggregateFolder(relPath: string, includeHidden = false): Promise<{ size: number; fileCount: number }> {
    const { files, folders } = await listRaw(relPath, includeHidden);
    return { size: files.reduce((sum, file) => sum + (file.size ?? 0), 0), fileCount: files.length + folders.length };
  }

  async function folderEntry(relPath: string, includeHidden = false): Promise<StorageStatEntry> {
    const { size, fileCount } = await aggregateFolder(relPath, includeHidden);
    return {
      path: relPath,
      name: relPath === "" ? "" : relPath.slice(relPath.lastIndexOf("/") + 1),
      kind: "folder",
      size,
      fileCount,
    };
  }

  async function list(relPath: string, includeHidden = false): Promise<StorageStatEntry[]> {
    if (relPath !== "" && !(await stat(relPath))) {
      throw new StorageError("not_found", `"${relPath}" does not exist.`);
    }
    const { files, folders } = await listRaw(relPath, includeHidden);
    const folderEntries = await Promise.all(
      folders.map((name) => folderEntry(relPath ? `${relPath}/${name}` : name, includeHidden)),
    );
    return [...folderEntries, ...files];
  }

  async function stat(relPath: string): Promise<StorageStatEntry | null> {
    if (relPath === "") return folderEntry("");
    const head = await bucket.head(fileKey(relPath));
    if (head) {
      return {
        path: relPath,
        name: relPath.slice(relPath.lastIndexOf("/") + 1),
        kind: "file",
        size: head.size,
        modifiedAt: head.uploaded.toISOString(),
        ...(head.httpEtag ? { contentHash: head.httpEtag } : {}),
      };
    }
    const marker = await bucket.head(markerKey(relPath));
    if (marker) return folderEntry(relPath);
    // No explicit marker (a folder implied only by nested writes, same as a
    // real filesystem directory local.ts never has to mark explicitly).
    const implicit = await bucket.list({ prefix: folderListPrefix(relPath), limit: 1 });
    if (implicit.objects.length > 0 || implicit.delimitedPrefixes.length > 0) return folderEntry(relPath);
    return null;
  }

  async function read(relPath: string): Promise<StorageReadResult> {
    const object = await bucket.get(fileKey(relPath));
    if (!object) throw new StorageError("not_found", `"${relPath}" does not exist.`);
    // Both shapes of the SAME body (see `StorageReadResult.webStream`), and
    // `stream` is a getter on purpose: `Readable.fromWeb` locks the web
    // stream the moment it runs, which would leave `webStream` unusable for
    // the response. Converting only happens if a caller actually asks for
    // the Node shape.
    const body = object.body as unknown as ReadableStream;
    let nodeStream: Readable | undefined;
    return {
      get stream(): Readable {
        return (nodeStream ??= Readable.fromWeb(body as unknown as NodeWebReadableStream));
      },
      webStream: body,
      size: object.size,
      modifiedAt: object.uploaded.toISOString(),
    };
  }

  async function mkdir(relPath: string): Promise<StorageStatEntry> {
    if (relPath === "") throw new StorageError("invalid_path", "Cannot create the storage root.");
    if (await stat(relPath)) throw new StorageError("already_exists", `"${relPath}" already exists.`);
    await bucket.put(markerKey(relPath), new Uint8Array(0));
    return { path: relPath, name: relPath.slice(relPath.lastIndexOf("/") + 1), kind: "folder", size: 0, fileCount: 0 };
  }

  async function write(relPath: string, data: Readable | Uint8Array): Promise<StorageStatEntry> {
    if (relPath === "") throw new StorageError("invalid_path", "Cannot write to the storage root.");
    const existing = await stat(relPath);
    if (existing?.kind === "folder") throw new StorageError("invalid_path", `"${relPath}" is a folder.`);
    const bytes = await bufferOf(data);
    await bucket.put(fileKey(relPath), bytes);
    return {
      path: relPath,
      name: relPath.slice(relPath.lastIndexOf("/") + 1),
      kind: "file",
      size: bytes.length,
      modifiedAt: new Date().toISOString(),
    };
  }

  /** Shared by `move`/`copy`: recreates every key under `fromRel`'s prefix
   * under `toRel`'s prefix (R2 has no native rename). `deleteSource` tells
   * `move` to remove the originals once every copy has succeeded. */
  async function copyKeys(fromRel: string, toRel: string, deleteSource: boolean): Promise<void> {
    const fromPrefix = folderListPrefix(fromRel);
    const toPrefix = folderListPrefix(toRel);
    const objects = await listAllKeysRaw(fromRel);
    const sourceKeys: string[] = [];
    for (const object of objects) {
      const object_ = await bucket.get(object.key);
      if (!object_) continue;
      const bytes = await bufferOf(Readable.fromWeb(object_.body as unknown as NodeWebReadableStream));
      const newKey = `${toPrefix}${object.key.slice(fromPrefix.length)}`;
      await bucket.put(newKey, bytes);
      sourceKeys.push(object.key);
    }
    if (deleteSource && sourceKeys.length > 0) await bucket.delete(sourceKeys);
  }

  async function move(fromRel: string, toRel: string): Promise<StorageStatEntry> {
    if (fromRel === "") throw new StorageError("invalid_path", "Cannot move the storage root.");
    const source = await stat(fromRel);
    if (!source) throw new StorageError("not_found", `"${fromRel}" does not exist.`);
    if (await stat(toRel)) throw new StorageError("already_exists", `"${toRel}" already exists.`);

    if (source.kind === "file") {
      const object = await bucket.get(fileKey(fromRel));
      if (!object) throw new StorageError("not_found", `"${fromRel}" does not exist.`);
      const bytes = await bufferOf(Readable.fromWeb(object.body as unknown as NodeWebReadableStream));
      await bucket.put(fileKey(toRel), bytes);
      await bucket.delete(fileKey(fromRel));
    } else {
      await copyKeys(fromRel, toRel, true);
    }
    const result = await stat(toRel);
    if (!result) throw new StorageError("not_found", `"${toRel}" does not exist.`);
    return result;
  }

  async function copy(fromRel: string, toRel: string): Promise<StorageStatEntry> {
    if (fromRel === "") throw new StorageError("invalid_path", "Cannot copy the storage root.");
    const source = await stat(fromRel);
    if (!source) throw new StorageError("not_found", `"${fromRel}" does not exist.`);
    if (await stat(toRel)) throw new StorageError("already_exists", `"${toRel}" already exists.`);

    if (source.kind === "file") {
      const object = await bucket.get(fileKey(fromRel));
      if (!object) throw new StorageError("not_found", `"${fromRel}" does not exist.`);
      const bytes = await bufferOf(Readable.fromWeb(object.body as unknown as NodeWebReadableStream));
      await bucket.put(fileKey(toRel), bytes);
    } else {
      await copyKeys(fromRel, toRel, false);
    }
    const result = await stat(toRel);
    if (!result) throw new StorageError("not_found", `"${toRel}" does not exist.`);
    return result;
  }

  async function remove(relPath: string): Promise<void> {
    if (relPath === "") throw new StorageError("invalid_path", "Cannot delete the storage root.");
    const existing = await stat(relPath);
    if (!existing) throw new StorageError("not_found", `"${relPath}" does not exist.`);
    if (existing.kind === "file") {
      await bucket.delete(fileKey(relPath));
      return;
    }
    const objects = await listAllKeysRaw(relPath);
    const keys = objects.map((object) => object.key);
    const marker = markerKey(relPath);
    if (!keys.includes(marker)) keys.push(marker);
    if (keys.length > 0) await bucket.delete(keys);
  }

  return { list, stat, read, mkdir, write, move, copy, remove };
}
