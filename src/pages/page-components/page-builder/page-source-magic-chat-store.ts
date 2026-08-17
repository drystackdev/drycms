/**
 * Thin hand-rolled IndexedDB wrapper for Page Builder's Magic Chat
 * history - a sibling of `content-entry-editor/magic-chat-store.ts` (same
 * degrade-safely-on-any-failure style, same one-object-store-keyed-by-a-
 * string shape), own DB so a version bump here can never collide with that
 * one's. Keyed by file path directly (unlike a content entry's
 * `typeSlug:entryId` pair, a page-source path is already a unique key on its
 * own - no separate "new vs. existing" distinction either, a file always
 * exists once it's open in the editor).
 */
export interface PageSourceMagicChatHistoryMessage {
  role: "user" | "assistant";
  text: string;
}

export type PageSourceChatBubble =
  | { id: string; role: "user"; text: string }
  | { id: string; role: "assistant"; text: string; streaming: boolean }
  | { id: string; role: "status"; text: string }
  | { id: string; role: "error"; text: string; retryText: string };

export interface PageSourceMagicChatSession {
  messages: PageSourceChatBubble[];
  history: PageSourceMagicChatHistoryMessage[];
  /** High-water mark for `PageSourceMagicChat.tsx`'s `newId()` counter -
   * persisted for the same reason `magic-chat-store.ts`'s `nextId` is. */
  nextId: number;
  lang: "vi" | "en";
}

interface PageSourceMagicChatRecord extends PageSourceMagicChatSession {
  key: string;
  updatedAt: number;
}

const DB_NAME = "drycms-page-source-magic-chat";
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

export function pageSourceMagicChatKey(path: string): string {
  return path;
}

/** `undefined` on a miss OR any IndexedDB failure - same "both just mean
 * start fresh" treatment `magic-chat-store.ts`'s own loader documents. */
export async function loadPageSourceMagicChatSession(path: string): Promise<PageSourceMagicChatSession | undefined> {
  try {
    const db = await openDb();
    const record = await new Promise<PageSourceMagicChatRecord | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).get(pageSourceMagicChatKey(path));
      req.onsuccess = () => resolve(req.result as PageSourceMagicChatRecord | undefined);
      req.onerror = () => reject(req.error);
    });
    if (!record) return undefined;
    return { messages: record.messages, history: record.history, nextId: record.nextId, lang: record.lang ?? "vi" };
  } catch {
    return undefined;
  }
}

async function putPageSourceMagicChatRecord(record: PageSourceMagicChatRecord): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Best-effort, same as `magic-chat-store.ts`'s own writer.
  }
}

const DEBOUNCE_MS = 300;
const pendingWrites = new Map<string, ReturnType<typeof setTimeout>>();

/** Debounced per session key, fire-and-forget - same reasoning
 * `magic-chat-store.ts`'s own `saveMagicChatSession` documents. */
export function savePageSourceMagicChatSession(path: string, session: PageSourceMagicChatSession): void {
  const key = pageSourceMagicChatKey(path);
  const pending = pendingWrites.get(key);
  if (pending !== undefined) clearTimeout(pending);
  pendingWrites.set(
    key,
    setTimeout(() => {
      pendingWrites.delete(key);
      void putPageSourceMagicChatRecord({ key, ...session, updatedAt: Date.now() });
    }, DEBOUNCE_MS),
  );
}

export async function discardPageSourceMagicChatSession(path: string): Promise<void> {
  const key = pageSourceMagicChatKey(path);
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
