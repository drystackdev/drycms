/**
 * Thin hand-rolled IndexedDB wrapper backing `useFetch()`'s cache layer (see
 * `status/build-cache.md`) - one object store, keyed by an already-normalized
 * cache key string (e.g. `entries:role:list:0::asc::`). Every call degrades to
 * a no-op/`undefined` on failure (IndexedDB unavailable, blocked, quota, a
 * private-browsing tab that throws on `open`) rather than rejecting - a cache
 * miss/write failure should never block rendering real data from the network.
 */

const DB_NAME = "drycms-cache";
const DB_VERSION = 1;
const STORE_NAME = "cache";

export interface CacheEntry<T> {
  key: string;
  data: T;
  version: number;
  cachedAt: number;
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
        db.createObjectStore(STORE_NAME, { keyPath: "key" });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    // Fires instead of onsuccess/onerror when another tab holds a connection
    // blocking this upgrade - without this the promise would hang forever.
    request.onblocked = () => reject(new Error("[drycms] IndexedDB open blocked by another tab."));
  });
  return dbPromise;
}

/** `undefined` on a cache miss OR any IndexedDB failure - callers can't tell
 * the two apart, which is fine: both mean "fetch fresh instead". */
export async function getCacheEntry<T>(key: string): Promise<CacheEntry<T> | undefined> {
  try {
    const db = await openDb();
    return await new Promise<CacheEntry<T> | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result as CacheEntry<T> | undefined);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

export async function setCacheEntry<T>(key: string, data: T, version: number): Promise<void> {
  try {
    const db = await openDb();
    const entry: CacheEntry<T> = { key, data, version, cachedAt: Date.now() };
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(entry);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Best-effort - a write failure just means the next load starts cold.
  }
}

/** Maintenance-only (see `status/build-cache.md` - mutations never call this,
 * they rely on the resource's own data-version bump for the next GET to
 * self-detect the change). */
export async function deleteCacheEntry(key: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // no-op
  }
}

/** Drops every entry whose key starts with `prefix` - for a cache namespace
 * that has to be invalidated as a whole rather than per key, because its
 * keys aren't enumerable from the caller's side (`dry-http-cache.ts`'s
 * "Refresh data": the keys are whatever queries the last build happened to
 * make). Uses a key range rather than a cursor over the whole store so an
 * unrelated namespace's entries are never even read. */
export async function deleteCacheEntriesByPrefix(prefix: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      // `￿` is above every character a real key can contain, so the
      // range covers exactly the keys starting with `prefix`.
      tx.objectStore(STORE_NAME).delete(IDBKeyRange.bound(prefix, `${prefix}￿`));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // no-op
  }
}

/** Reset/debug/migration only - see `deleteCacheEntry`'s doc. */
export async function clearCache(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // no-op
  }
}
