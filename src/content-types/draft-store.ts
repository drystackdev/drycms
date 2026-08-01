import { signal } from "@preact/signals";
import type { ContentTypeDefinition } from "./types.js";

const STORAGE_KEY = "drycms:content-type-drafts";

export interface DraftEntry {
  definition: ContentTypeDefinition;
  /** Whether this id exists on the server yet - `true` for a content type
   * that was drafted but never applied, so `ContentTypes.tsx`/
   * `ContentTypeEditor.tsx` know there's no live row to diff against or
   * delete. */
  isNew: boolean;
}

type DraftMap = Record<string, DraftEntry>;

function readFromStorage(): DraftMap {
  if (typeof localStorage === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as DraftMap) : {};
  } catch {
    return {};
  }
}

function writeToStorage(value: DraftMap): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
}

/**
 * Every pending, unapplied edit to a content type, keyed by id - the client-
 * only "staged changes" store behind the Content Types builder's "Apply and
 * build" flow (see `status/content-type-staged-apply.md`). Deliberately
 * localStorage-only, not server-persisted: a draft never syncs across
 * browsers/devices, and is gone if local storage is cleared - an accepted
 * tradeoff for not needing a DB schema change to ship this.
 *
 * A `@preact/signals` value (same pattern as `store/content-types.ts`'s
 * `contentTypesVersion`) so `ContentTypes.tsx`'s list/badges and
 * `ContentTypeEditor.tsx`'s Save button both re-render on every change
 * without prop drilling or manual event wiring.
 */
export const drafts = signal<DraftMap>(readFromStorage());

export function getDraft(id: string): DraftEntry | undefined {
  return drafts.value[id];
}

export function saveDraft(definition: ContentTypeDefinition, isNew: boolean): void {
  const next = { ...drafts.value, [definition.id]: { definition, isNew } };
  drafts.value = next;
  writeToStorage(next);
}

export function discardDraft(id: string): void {
  if (!(id in drafts.value)) return;
  const next = { ...drafts.value };
  delete next[id];
  drafts.value = next;
  writeToStorage(next);
}

export function discardDrafts(ids: string[]): void {
  let changed = false;
  const next = { ...drafts.value };
  for (const id of ids) {
    if (id in next) {
      delete next[id];
      changed = true;
    }
  }
  if (!changed) return;
  drafts.value = next;
  writeToStorage(next);
}
