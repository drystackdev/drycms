/**
 * Thin hand-rolled IndexedDB wrapper for `PageEditor.tsx`'s SAVED (server-
 * synced) content cache - same shape and same degrade-safely-on-any-failure
 * style as `page-source-draft-db.ts` (unsaved edits), own DB so a version
 * bump here can never collide with that one's. Two stores: `files` (per-path
 * content, mirrors the server once fetched) and `tree` (a single snapshot of
 * the last-known file list), so a reload can paint the sidebar and the
 * currently-open file instantly from cache before any network request
 * resolves.
 */

import type { FileEntry } from "../storage/entry-types.js";

const DB_NAME = "drycms-page-source-cache";
const DB_VERSION = 1;
const FILES_STORE = "files";
const TREE_STORE = "tree";
const TREE_KEY = "tree";

export interface PageSourceCacheRecord {
  path: string;
  source: string;
  updatedAt: number;
}

interface PagesTreeCacheRecord {
  key: string;
  entries: FileEntry[];
  updatedAt: number;
}

let dbPromise: Promise<IDBDatabase> | undefined;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("[drycms] IndexedDB is not available in this environment."));
  }
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FILES_STORE)) {
        db.createObjectStore(FILES_STORE, { keyPath: "path" });
      }
      if (!db.objectStoreNames.contains(TREE_STORE)) {
        db.createObjectStore(TREE_STORE, { keyPath: "key" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

export async function putPageSourceCache(path: string, source: string): Promise<void> {
  try {
    const db = await openDb();
    const record: PageSourceCacheRecord = { path, source, updatedAt: Date.now() };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(FILES_STORE, "readwrite");
      tx.objectStore(FILES_STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Best-effort - a write failure just means the next load re-fetches
    // this file from the server instead of finding it cached.
  }
}

export async function deletePageSourceCache(path: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(FILES_STORE, "readwrite");
      tx.objectStore(FILES_STORE).delete(path);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // no-op
  }
}

/** Startup hydration only - `PageEditor.tsx` reads every record once to
 * paint the sidebar/editor from cache before the server tree resolves. */
export async function getAllPageSourceCache(): Promise<PageSourceCacheRecord[]> {
  try {
    const db = await openDb();
    return await new Promise<PageSourceCacheRecord[]>((resolve, reject) => {
      const tx = db.transaction(FILES_STORE, "readonly");
      const req = tx.objectStore(FILES_STORE).getAll();
      req.onsuccess = () => resolve(req.result as PageSourceCacheRecord[]);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

export async function putPagesTreeCache(entries: FileEntry[]): Promise<void> {
  try {
    const db = await openDb();
    const record: PagesTreeCacheRecord = { key: TREE_KEY, entries, updatedAt: Date.now() };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(TREE_STORE, "readwrite");
      tx.objectStore(TREE_STORE).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // no-op
  }
}

export async function getPagesTreeCache(): Promise<FileEntry[] | null> {
  try {
    const db = await openDb();
    const record = await new Promise<PagesTreeCacheRecord | undefined>((resolve, reject) => {
      const tx = db.transaction(TREE_STORE, "readonly");
      const req = tx.objectStore(TREE_STORE).get(TREE_KEY);
      req.onsuccess = () => resolve(req.result as PagesTreeCacheRecord | undefined);
      req.onerror = () => reject(req.error);
    });
    return record?.entries ?? null;
  } catch {
    return null;
  }
}

/** Atomically replaces both saved-source stores after a whole-tree reset.
 * Folder rows are derived from file paths so the next Page Editor mount can
 * paint its complete sidebar without waiting for the storage API. */
export async function replacePageSourceCache(sourceByPath: Record<string, string>): Promise<void> {
  try {
    const db = await openDb();
    const now = Date.now();
    const folders = new Set<string>();
    for (const path of Object.keys(sourceByPath)) {
      const segments = path.split("/");
      for (let index = 1; index < segments.length; index += 1) folders.add(segments.slice(0, index).join("/"));
    }
    const folderEntries: FileEntry[] = [...folders].map((id) => ({
      id,
      name: id.split("/").at(-1)!,
      parentId: id.includes("/") ? id.slice(0, id.lastIndexOf("/")) : null,
      kind: "folder",
    }));
    const fileEntries: FileEntry[] = Object.entries(sourceByPath).map(([id, source]) => ({
      id,
      name: id.split("/").at(-1)!,
      parentId: id.includes("/") ? id.slice(0, id.lastIndexOf("/")) : null,
      kind: "file",
      ext: id.includes(".") ? id.slice(id.lastIndexOf(".") + 1).toLowerCase() : undefined,
      size: new TextEncoder().encode(source).byteLength,
    }));

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction([FILES_STORE, TREE_STORE], "readwrite");
      const files = tx.objectStore(FILES_STORE);
      files.clear();
      for (const [path, source] of Object.entries(sourceByPath)) files.put({ path, source, updatedAt: now } satisfies PageSourceCacheRecord);
      const tree = tx.objectStore(TREE_STORE);
      tree.clear();
      tree.put({ key: TREE_KEY, entries: [...folderEntries, ...fileEntries], updatedAt: now } satisfies PagesTreeCacheRecord);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Best-effort. Storage/GitHub are already authoritative; Page Editor can
    // repopulate this cache from the network on its next mount.
  }
}
