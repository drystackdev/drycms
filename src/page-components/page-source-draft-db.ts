/**
 * Thin hand-rolled IndexedDB wrapper for `PageEditor.tsx`'s in-progress,
 * unsaved code edits - same shape and same degrade-safely-on-any-failure
 * style as `content-types/entry-draft-db.ts` (drafts for the CONTENT entry
 * editor), own DB so a version bump here can never collide with that one's.
 * No `BroadcastChannel` here (unlike that module) - two tabs editing the
 * same page source isn't a case this needs to handle live, only "did THIS
 * tab lose unsaved work to a reload/crash".
 */

const DB_NAME = "drycms-page-source-drafts";
const DB_VERSION = 1;
const STORE_NAME = "drafts";

export interface PageSourceDraftRecord {
  path: string;
  source: string;
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
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "path" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

export async function putPageSourceDraft(path: string, source: string): Promise<void> {
  try {
    const db = await openDb();
    const record: PageSourceDraftRecord = { path, source, updatedAt: Date.now() };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Best-effort - a write failure just means this edit isn't recoverable
    // after a reload, not that the edit itself is lost right now.
  }
}

export async function deletePageSourceDraft(path: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(path);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // no-op
  }
}

/** Startup hydration only - `PageEditor.tsx` reads every record once on
 * load to overlay onto the freshly-fetched saved content. */
export async function getAllPageSourceDrafts(): Promise<PageSourceDraftRecord[]> {
  try {
    const db = await openDb();
    return await new Promise<PageSourceDraftRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result as PageSourceDraftRecord[]);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}
