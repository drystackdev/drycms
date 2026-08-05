/**
 * Thin hand-rolled IndexedDB wrapper for entry drafts - same
 * degrade-safely-on-any-failure style as `src/lib/idb-cache.ts`, but its own
 * DB so a version bump here can never collide with that cache's own
 * versioning. One object store, keyed by `draftKey()` (`entry-draft-store.ts`).
 */
import type { EntryValue } from "./engine/entry-codec.js";

const DB_NAME = "drycms-entry-drafts";
const DB_VERSION = 1;
const STORE_NAME = "drafts";
// Same name as `DB_NAME` for readability at the call sites below, but this
// is a separate namespace - `BroadcastChannel` and `indexedDB.open` don't
// share one, so there's no risk of the two colliding.
const CHANNEL_NAME = "drycms-entry-drafts";

export interface EntryDraftRecord {
  key: string;
  typeSlug: string;
  entryId: string | null;
  value: EntryValue;
  updatedAt: number;
}

export type EntryDraftChangeMessage =
  | { type: "put"; record: EntryDraftRecord }
  | { type: "delete"; key: string };

let dbPromise: Promise<IDBDatabase> | undefined;

// Lazily constructed (not every context that imports this module - e.g. a
// unit test's jsdom environment - necessarily has `BroadcastChannel`), and
// shared by every caller in this tab rather than one per put/delete so
// `subscribeEntryDraftChanges` below can listen on the exact same object.
let channel: BroadcastChannel | undefined;

function getChannel(): BroadcastChannel | undefined {
  if (typeof BroadcastChannel === "undefined") return undefined;
  channel ??= new BroadcastChannel(CHANNEL_NAME);
  return channel;
}

function broadcast(message: EntryDraftChangeMessage): void {
  try {
    getChannel()?.postMessage(message);
  } catch {
    // Best-effort, same degrade-safely style as every other function here -
    // a tab that can't broadcast still has its own write, just not synced.
  }
}

/**
 * Cross-tab draft sync: fires with every OTHER tab's `putEntryDraftRecord`/
 * `deleteEntryDraftRecord` call (never this tab's own - a `BroadcastChannel`
 * never delivers a message back to the object that sent it), so a page open
 * elsewhere - the public site's VEI overlay live-previewing a marked field,
 * `DryLayout`'s nav draft badges - can react immediately instead of only
 * catching up on its own next reload/poll. Both callers of this (
 * `entry-draft-store.ts` for the admin bundle, `apps/vei/overlay.ts` for the
 * public site) read straight from here rather than through
 * `entry-draft-store.ts`, which pulls in `@preact/signals` that the public
 * site's bundle has no other reason to carry.
 */
export function subscribeEntryDraftChanges(
  onChange: (message: EntryDraftChangeMessage) => void,
): () => void {
  const ch = getChannel();
  if (!ch) return () => {};
  const handler = (event: MessageEvent) => onChange(event.data as EntryDraftChangeMessage);
  ch.addEventListener("message", handler);
  return () => ch.removeEventListener("message", handler);
}

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
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

/** `undefined` on a miss OR any IndexedDB failure - callers can't tell the
 * two apart, which is fine: both mean "no draft, fall back to the server
 * value". */
export async function getEntryDraftRecord(key: string): Promise<EntryDraftRecord | undefined> {
  try {
    const db = await openDb();
    return await new Promise<EntryDraftRecord | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(key);
      req.onsuccess = () => resolve(req.result as EntryDraftRecord | undefined);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

export async function putEntryDraftRecord(record: EntryDraftRecord): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    broadcast({ type: "put", record });
  } catch {
    // Best-effort - a write failure just means this edit isn't recoverable
    // after a reload, not that the edit itself is lost right now.
  }
}

export async function deleteEntryDraftRecord(key: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    broadcast({ type: "delete", key });
  } catch {
    // no-op
  }
}

/** Startup hydration only - `entry-draft-store.ts` reads every record once
 * on app mount to rebuild its in-memory index. */
export async function getAllEntryDraftRecords(): Promise<EntryDraftRecord[]> {
  try {
    const db = await openDb();
    return await new Promise<EntryDraftRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result as EntryDraftRecord[]);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}
