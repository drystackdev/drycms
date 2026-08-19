const DB_NAME = "drycms-file-blob-cache";
const STORE_NAME = "blobs";
const DB_VERSION = 1;

/** Sliding TTL: refreshed on every cache hit (see `getCachedBlob`), so a
 * file in active use never expires - only one nobody's opened in 7 days
 * does. Only ever relevant for future content-addressed object storage,
 * keyed by its real content hash/ETag - `local` has no natural
 * content hash and isn't worth caching (same-origin disk reads have no
 * network latency to save), so it never calls into this module at all. */
const TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** At most one sweep per this interval - `readCachedFile` triggers one after
 * every successful fetch, and a folder full of thumbnails can call that in a
 * tight burst; without a throttle every one of those would kick off its own
 * full IndexedDB scan for no benefit. */
const SWEEP_THROTTLE_MS = 15 * 60 * 1000;

interface CachedBlobRecord {
  sha: string;
  blob: Blob;
  lastAccessedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE_NAME, { keyPath: "sha" });
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error as unknown);
    // Fires instead of onsuccess/onerror when another tab holds a connection
    // blocking this upgrade - without this the promise would hang forever.
    request.onblocked = () => reject(new Error("[drycms] IndexedDB open blocked by another tab."));
  });
  return dbPromise;
}

function runRequest<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const store = db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
    const request = run(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error as unknown);
  });
}

/** Exported for testing in isolation - IndexedDB itself isn't available
 * under Node/vitest, but the expiry rule is a plain, deterministic function
 * of two timestamps. */
export function isCacheEntryExpired(lastAccessedAt: number, now: number = Date.now()): boolean {
  return now - lastAccessedAt > TTL_MS;
}

/** Cached bytes for `sha`, or `null` on a miss - refreshes `lastAccessedAt`
 * on a hit (fire-and-forget: the read doesn't need to wait on it). Never
 * throws: IndexedDB being unavailable (private browsing, disabled storage,
 * an older browser) degrades to "always a miss", never a broken preview. */
export async function getCachedBlob(sha: string): Promise<Blob | null> {
  try {
    const db = await openDb();
    const record = await runRequest<CachedBlobRecord | undefined>(db, "readonly", (store) => store.get(sha));
    if (!record) return null;
    void runRequest(db, "readwrite", (store) => store.put({ ...record, lastAccessedAt: Date.now() })).catch(() => {});
    return record.blob;
  } catch {
    return null;
  }
}

/** Stores `blob` under `sha`, overwriting whatever was there. Swallows
 * failure (quota exceeded, storage disabled, ...) - the cache is a pure
 * optimization; the caller already has the blob it just fetched regardless. */
export async function putCachedBlob(sha: string, blob: Blob): Promise<void> {
  try {
    const db = await openDb();
    const record: CachedBlobRecord = { sha, blob, lastAccessedAt: Date.now() };
    await runRequest(db, "readwrite", (store) => store.put(record));
  } catch {
    // See doc comment above.
  }
}

async function sweepExpiredCache(now: number): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      if (isCacheEntryExpired((cursor.value as CachedBlobRecord).lastAccessedAt, now)) cursor.delete();
      cursor.continue();
    };
    request.onerror = () => reject(request.error as unknown);
  });
}

let lastSweepAt = 0;

/** Fire-and-forget, throttled cleanup of entries nobody's touched in 7 days -
 * called after every successful `readCachedFile` fetch. Never awaited by
 * callers and never lets a failure surface: this is background
 * housekeeping, not something that should ever block or break a file load. */
export function sweepExpiredCacheInBackground(now: number = Date.now()): void {
  if (now - lastSweepAt < SWEEP_THROTTLE_MS) return;
  lastSweepAt = now;
  sweepExpiredCache(now).catch(() => {});
}

/** Fetches `url`'s bytes as a `Blob`, through the sha-keyed cache when `sha`
 * is known. `sha` is only ever populated for content-addressed backends
 * (see `StorageStatEntry.contentHash` - an R2/S3 ETag once those exist);
 * callers pass `undefined` for anything else
 * (`local`) and this degrades to a plain `fetch`, no cache involved. */
export async function readCachedFile(url: string, sha: string | undefined): Promise<Blob> {
  if (sha) {
    const cached = await getCachedBlob(sha);
    if (cached) return cached;
  }
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  const blob = await response.blob();
  if (sha) {
    await putCachedBlob(sha, blob);
    sweepExpiredCacheInBackground();
  }
  return blob;
}
