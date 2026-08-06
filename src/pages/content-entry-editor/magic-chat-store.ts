/**
 * Thin hand-rolled IndexedDB wrapper for Magic chat history - same
 * degrade-safely-on-any-failure style as `content-types/entry-draft-db.ts`,
 * but its own DB so a version bump here can never collide with that one's.
 * One object store, keyed by `magicChatKey()`. Unlike entry drafts, no
 * cross-tab `BroadcastChannel` sync - nothing outside this one `MagicChat`
 * instance needs to react to a session changing.
 *
 * Also the home for the chat's shared types (`ChatBubble`,
 * `MagicChatHistoryMessage`, `MagicChatEncodedImage`) - `MagicChat.tsx`
 * imports them from here rather than declaring its own, since this module is
 * what defines what a persisted session actually contains.
 */
import type { MagicWriteChoice } from "../../content-types/ai-magic-write-protocol.js";

export interface MagicChatEncodedImage {
  path: string;
  mimeType: string;
  base64: string;
}

export interface MagicChatHistoryMessage {
  role: "user" | "assistant";
  text: string;
}

export type ChatBubble =
  | { id: string; role: "user"; text: string; imagePaths: string[] }
  | { id: string; role: "assistant"; text: string; streaming: boolean }
  | { id: string; role: "question"; question: string; choices: MagicWriteChoice[]; multi: boolean; allowOther?: boolean; answer?: string }
  | { id: string; role: "status"; text: string }
  | { id: string; role: "error"; text: string; retryText: string; retryImages: MagicChatEncodedImage[] };

export interface MagicChatSession {
  messages: ChatBubble[];
  history: MagicChatHistoryMessage[];
  sessionImagePaths: string[];
  /** High-water mark for `MagicChat.tsx`'s `newId()` counter - persisted so a
   * restored session's next bubble id can't collide with a restored one
   * (both are `magic-${n}`, and `key`-based reconciliation breaks on a
   * collision). */
  nextId: number;
}

interface MagicChatRecord extends MagicChatSession {
  key: string;
  updatedAt: number;
}

const DB_NAME = "drycms-magic-chat";
const DB_VERSION = 1;
const STORE_NAME = "sessions";

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
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

/** `entryId: null` covers both a not-yet-created entry (one slot per content
 * type, same `__new__` convention `entry-draft-store.ts`'s `draftKey` uses)
 * and a singleton. */
export function magicChatKey(typeSlug: string, entryId: string | null): string {
  return `${typeSlug}:${entryId ?? "__new__"}`;
}

/** `undefined` on a miss OR any IndexedDB failure - callers can't tell the
 * two apart, which is fine: both just mean "start a fresh conversation". */
export async function loadMagicChatSession(typeSlug: string, entryId: string | null): Promise<MagicChatSession | undefined> {
  try {
    const db = await openDb();
    const record = await new Promise<MagicChatRecord | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(magicChatKey(typeSlug, entryId));
      req.onsuccess = () => resolve(req.result as MagicChatRecord | undefined);
      req.onerror = () => reject(req.error);
    });
    if (!record) return undefined;
    return { messages: record.messages, history: record.history, sessionImagePaths: record.sessionImagePaths, nextId: record.nextId };
  } catch {
    return undefined;
  }
}

async function putMagicChatRecord(record: MagicChatRecord): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Best-effort, same degrade-safely style as `entry-draft-db.ts` - a
    // write failure just means this turn isn't recoverable after a reload,
    // not that the conversation itself breaks right now.
  }
}

const DEBOUNCE_MS = 300;
const pendingWrites = new Map<string, ReturnType<typeof setTimeout>>();

/** Debounced per session key - a fast-streaming reply shouldn't hit
 * IndexedDB on every delta tick, same reasoning as
 * `entry-draft-store.ts`'s `saveEntryDraft`. Fire-and-forget. */
export function saveMagicChatSession(typeSlug: string, entryId: string | null, session: MagicChatSession): void {
  const key = magicChatKey(typeSlug, entryId);
  const pending = pendingWrites.get(key);
  if (pending !== undefined) clearTimeout(pending);
  pendingWrites.set(
    key,
    setTimeout(() => {
      pendingWrites.delete(key);
      void putMagicChatRecord({ key, ...session, updatedAt: Date.now() });
    }, DEBOUNCE_MS),
  );
}

export async function discardMagicChatSession(typeSlug: string, entryId: string | null): Promise<void> {
  const key = magicChatKey(typeSlug, entryId);
  const pending = pendingWrites.get(key);
  if (pending !== undefined) {
    clearTimeout(pending);
    pendingWrites.delete(key);
  }
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
