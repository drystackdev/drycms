/**
 * Thin hand-rolled IndexedDB wrapper for content-type schema drafts - same
 * shape and same degrade-safely-on-any-failure style as `entry-draft-db.ts`
 * (drafts for the CONTENT entry editor), own DB so a version bump here can
 * never collide with that one's. One object store, keyed by `id` (the
 * content type's own `ContentTypeDefinition.id`).
 */
import type { ContentTypeDefinition } from "./types.js";

const DB_NAME = "drycms-content-type-drafts";
const DB_VERSION = 1;
const STORE_NAME = "drafts";
// Same name as `DB_NAME` for readability at the call sites below, but this
// is a separate namespace - `BroadcastChannel` and `indexedDB.open` don't
// share one, so there's no risk of the two colliding.
const CHANNEL_NAME = "drycms-content-type-drafts";

export interface ContentTypeDraftRecord {
  id: string;
  definition: ContentTypeDefinition;
  /** Whether this id exists on the server yet - `true` for a content type
   * that was drafted but never applied, so `BuilderContentType.tsx`/
   * `ContentTypeEditor.tsx` know there's no live row to diff against or
   * delete. Same meaning `draft-store.ts`'s old `DraftEntry.isNew` had. */
  isNew: boolean;
  /** `"ai"` for a draft pulled from `ai-content-type-drafts.ts`'s server-side
   * KV staging area (an MCP `propose_content_type` proposal) - `"local"` for
   * one the admin (or the in-app AI Schema Wizard) typed/staged themselves.
   * Only an `"ai"` draft has a matching server-side row that needs clearing
   * once resolved (`draft-store.ts`'s `discardDraft`/`discardDrafts`). */
  source: "local" | "ai";
  updatedAt: number;
}

export type ContentTypeDraftChangeMessage =
  | { type: "put"; record: ContentTypeDraftRecord }
  | { type: "delete"; id: string };

let dbPromise: Promise<IDBDatabase> | undefined;

let channel: BroadcastChannel | undefined;

function getChannel(): BroadcastChannel | undefined {
  if (typeof BroadcastChannel === "undefined") return undefined;
  channel ??= new BroadcastChannel(CHANNEL_NAME);
  return channel;
}

function broadcast(message: ContentTypeDraftChangeMessage): void {
  try {
    getChannel()?.postMessage(message);
  } catch {
    // Best-effort, same degrade-safely style as every other function here -
    // a tab that can't broadcast still has its own write, just not synced.
  }
}

/** Cross-tab draft sync: fires with every OTHER tab's `putContentTypeDraftRecord`/
 * `deleteContentTypeDraftRecord` call (never this tab's own - a
 * `BroadcastChannel` never delivers a message back to the object that sent
 * it) - same purpose `entry-draft-db.ts`'s `subscribeEntryDraftChanges` has. */
export function subscribeContentTypeDraftChanges(
  onChange: (message: ContentTypeDraftChangeMessage) => void,
): () => void {
  const ch = getChannel();
  if (!ch) return () => {};
  const handler = (event: MessageEvent) => onChange(event.data as ContentTypeDraftChangeMessage);
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
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
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

export async function getContentTypeDraftRecord(id: string): Promise<ContentTypeDraftRecord | undefined> {
  try {
    const db = await openDb();
    return await new Promise<ContentTypeDraftRecord | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(id);
      req.onsuccess = () => resolve(req.result as ContentTypeDraftRecord | undefined);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

export async function putContentTypeDraftRecord(record: ContentTypeDraftRecord): Promise<void> {
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
    // Best-effort - a write failure just means this draft isn't recoverable
    // after a reload, not that the edit itself is lost right now.
  }
}

export async function deleteContentTypeDraftRecord(id: string): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    broadcast({ type: "delete", id });
  } catch {
    // no-op
  }
}

/** Startup hydration only - `draft-store.ts` reads every record once on app
 * mount to rebuild its in-memory signal. */
export async function getAllContentTypeDraftRecords(): Promise<ContentTypeDraftRecord[]> {
  try {
    const db = await openDb();
    return await new Promise<ContentTypeDraftRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result as ContentTypeDraftRecord[]);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}
