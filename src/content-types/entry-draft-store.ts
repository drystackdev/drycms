import { signal } from "@preact/signals";
import type { EntryValue } from "./engine/entry-codec.js";
import {
  deleteEntryDraftRecord,
  getAllEntryDraftRecords,
  getEntryDraftRecord,
  putEntryDraftRecord,
  subscribeEntryDraftChanges,
} from "./entry-draft-db.js";

/** `entryId: null` covers both a not-yet-created entry (`__new__`, one slot
 * per content type - see `status/entry-drafts.md`) and a singleton (which
 * has no id of its own in the editor). */
export function draftKey(typeSlug: string, entryId: string | null): string {
  return `${typeSlug}:${entryId ?? "__new__"}`;
}

interface DraftIndexEntry {
  typeSlug: string;
  entryId: string | null;
  updatedAt: number;
}

type DraftIndex = Record<string, DraftIndexEntry>;

/**
 * Every pending, unsaved entry edit currently sitting in IndexedDB, indexed
 * by `draftKey()` - but only the lightweight existence/count info, not the
 * full field values (those stay in IndexedDB and are loaded on demand by
 * `loadEntryDraft`). A `@preact/signals` value, same pattern as
 * `content-types/draft-store.ts`'s `drafts`, so `DryLayout.tsx`'s nav
 * dot/badge and `ContentEntryList.tsx`'s per-row dot both re-render on every
 * change without prop drilling.
 *
 * Starts empty and is populated async by `hydrateEntryDraftIndex()` (called
 * once from `DryLayout`'s mount effect) - nav/table indicators pop in
 * shortly after first paint rather than blocking on IndexedDB before
 * rendering, the same eventual-consistency tradeoff `lib/idb-cache.ts`
 * already accepts elsewhere.
 */
export const entryDraftIndex = signal<DraftIndex>({});

export async function hydrateEntryDraftIndex(): Promise<void> {
  const records = await getAllEntryDraftRecords();
  const next: DraftIndex = {};
  for (const record of records) {
    next[record.key] = { typeSlug: record.typeSlug, entryId: record.entryId, updatedAt: record.updatedAt };
  }
  entryDraftIndex.value = next;
}

/**
 * Keeps `entryDraftIndex` current when a DIFFERENT tab writes or discards a
 * draft - without this, the nav sidebar's dot/badge (and `ContentEntryList`'s
 * per-row dot) only ever reflect what happened in this tab, stale until the
 * next full reload. Called once from `DryLayout`'s mount effect, right next
 * to `hydrateEntryDraftIndex()` (the initial read this then keeps in sync).
 * Cheap, incremental updates rather than a full re-`hydrateEntryDraftIndex()`
 * per message - there's no bound on how many drafts might exist, but each
 * change event only ever touches one.
 */
export function watchEntryDraftIndex(): () => void {
  return subscribeEntryDraftChanges((message) => {
    if (message.type === "put") {
      const { key, typeSlug, entryId, updatedAt } = message.record;
      entryDraftIndex.value = { ...entryDraftIndex.value, [key]: { typeSlug, entryId, updatedAt } };
    } else {
      if (!(message.key in entryDraftIndex.value)) return;
      const next = { ...entryDraftIndex.value };
      delete next[message.key];
      entryDraftIndex.value = next;
    }
  });
}

export async function loadEntryDraft(typeSlug: string, entryId: string | null): Promise<EntryValue | undefined> {
  const record = await getEntryDraftRecord(draftKey(typeSlug, entryId));
  return record?.value;
}

const DEBOUNCE_MS = 300;
const pendingWrites = new Map<string, ReturnType<typeof setTimeout>>();

/** Debounced per draft key (a fast typist shouldn't hit IndexedDB once per
 * keystroke) - the in-memory index updates synchronously below, so nav/table
 * indicators react immediately even while the actual IndexedDB write is
 * still pending. */
export function saveEntryDraft(typeSlug: string, entryId: string | null, value: EntryValue): void {
  const key = draftKey(typeSlug, entryId);
  const updatedAt = Date.now();

  if (!entryDraftIndex.value[key]) {
    entryDraftIndex.value = { ...entryDraftIndex.value, [key]: { typeSlug, entryId, updatedAt } };
  }

  const pending = pendingWrites.get(key);
  if (pending !== undefined) clearTimeout(pending);
  pendingWrites.set(
    key,
    setTimeout(() => {
      pendingWrites.delete(key);
      void putEntryDraftRecord({ key, typeSlug, entryId, value, updatedAt: Date.now() });
    }, DEBOUNCE_MS),
  );
}

export async function discardEntryDraft(typeSlug: string, entryId: string | null): Promise<void> {
  const key = draftKey(typeSlug, entryId);

  const pending = pendingWrites.get(key);
  if (pending !== undefined) {
    clearTimeout(pending);
    pendingWrites.delete(key);
  }

  if (key in entryDraftIndex.value) {
    const next = { ...entryDraftIndex.value };
    delete next[key];
    entryDraftIndex.value = next;
  }

  await deleteEntryDraftRecord(key);
}

export function hasEntryDraft(typeSlug: string, entryId: string | null): boolean {
  return draftKey(typeSlug, entryId) in entryDraftIndex.value;
}

/** Count of distinct entries (including a pending `__new__` draft) with
 * unsaved edits for one collection - drives the nav sidebar's badge. */
export function countEntryDrafts(typeSlug: string): number {
  let count = 0;
  for (const entry of Object.values(entryDraftIndex.value)) {
    if (entry.typeSlug === typeSlug) count++;
  }
  return count;
}
