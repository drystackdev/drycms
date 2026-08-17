import { signal } from "@preact/signals";
import type { EntryValue } from "./engine/entry-codec.js";
import { discardEntryDraft } from "./entry-draft-store.js";
import { createContentEntriesApi } from "./entries-http-api.js";
import { commitContentChanges, type ContentChangeItem, type ContentChangeOp } from "./content-history-http-api.js";

/** 3 retries, short backoff - `plans/history-content.md` decision #1: the
 * caller's D1 write already succeeded and its response already returned, so
 * a slow/failing git push only delays clearing the "unsynced" indicator, it
 * never blocks or re-risks the save itself. */
const RETRY_DELAYS_MS = [500, 1500, 3000];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `"synced"` - committed (or nothing to do, see below). `"failed"` - every
 * retry was exhausted; the caller should offer a reset. The FIRST response
 * indicating no `githubSync` repo/token is configured at all short-circuits
 * as `"synced"` with no retry - the common case for a tenant that's never
 * turned git on must behave exactly like it did before this feature
 * existed (draft just discards), not retry 3 times and then prompt a reset
 * dialog for a "failure" that was never really one. */
async function commitWithRetry(adminPath: string, items: ContentChangeItem[]): Promise<"synced" | "failed"> {
  for (let attempt = 0; ; attempt += 1) {
    const result = await commitContentChanges(adminPath, items);
    if (result.committed || result.notConfigured) return "synced";
    const wait = RETRY_DELAYS_MS[attempt];
    if (wait === undefined) return "failed";
    await delay(wait);
  }
}

export type ContentGitRollback =
  /** The save was a create - undoing it means removing the row entirely. */
  | { kind: "remove" }
  /** The save was an update/singleton-save - undoing it means writing this
   * pre-save value back. */
  | { kind: "restore"; value: EntryValue }
  /** The save was a delete - undoing it means creating the row again. It
   * gets a NEW id (the original is gone for good the moment D1 deletes it),
   * a best-effort rollback rather than a true undo. */
  | { kind: "recreate"; value: EntryValue };

export interface PendingContentSync {
  id: string;
  typeSlug: string;
  typeLabel: string;
  /** Hashed id, `null` for a singleton. */
  entryId: string | null;
  rollback: ContentGitRollback;
}

/**
 * Entry saves whose git commit failed after every retry, queued for
 * `DryLayout.tsx` to offer a reset on - global (not component-local) state
 * on purpose: the editor that triggered the sync has very likely already
 * navigated away (`ContentEntryEditor.tsx`'s own Save handler routes back to
 * the list right after the D1 write resolves, well before a background sync
 * this slow would ever finish), so nothing tied to that component's
 * lifecycle could show the confirm dialog reliably.
 */
export const pendingContentSyncs = signal<PendingContentSync[]>([]);

function pushPending(entry: PendingContentSync): void {
  pendingContentSyncs.value = [...pendingContentSyncs.value, entry];
}

export function dismissPendingContentSync(id: string): void {
  pendingContentSyncs.value = pendingContentSyncs.value.filter((pending) => pending.id !== id);
}

/**
 * Fire-and-forget: kicks off the git mirror for one entry save. Never
 * awaited by its caller - the D1 write and its response already happened,
 * so this just needs to eventually either discard the now-synced draft
 * (success) or park a rollback offer for `DryLayout.tsx` (final failure).
 * Skips the network call entirely for a type `isGitMirrorEligible` already
 * excludes - the caller checks that before calling this at all, since a
 * `git-mirror.ts`-excluded type (`role`/`user`/...) has nothing to sync and
 * should just discard its draft immediately, same as before this feature.
 */
export function syncEntryDraftToGit(options: {
  adminPath: string;
  typeSlug: string;
  typeLabel: string;
  /** `entry-draft-store.ts`'s own key - `null` for a singleton or a
   * not-yet-created entry (the `__new__` slot), independent of `entryId`
   * below (a freshly-created row's real id, which the draft was never keyed
   * under). */
  draftEntryId: string | null;
  entryId: string | null;
  op: ContentChangeOp;
  rollback: ContentGitRollback;
}): void {
  const { adminPath, typeSlug, typeLabel, draftEntryId, entryId, op, rollback } = options;
  void commitWithRetry(adminPath, [{ kind: "entry", typeName: typeSlug, entryId, op }]).then((outcome) => {
    if (outcome === "synced") {
      void discardEntryDraft(typeSlug, draftEntryId);
      return;
    }
    pushPending({ id: `${typeSlug}:${draftEntryId ?? "singleton"}:${Date.now()}`, typeSlug, typeLabel, entryId, rollback });
  });
}

/**
 * Mirrors one or more content-type schema changes as a SINGLE commit -
 * `ApplyBuildDialog.tsx`'s "Apply and build" already applies its whole batch
 * as one user action, so its git mirror follows the same "one action, one
 * commit" shape `commitPagesSourceChanges` uses for a multi-file page-source
 * save. Unlike `syncEntryDraftToGit`, this has no automatic "reset" on
 * failure - the caller (`ApplyBuildDialog.tsx`/`ContentTypeEditor.tsx`) just
 * leaves the draft pending and surfaces a toast, since re-running a schema
 * migration to roll one back carries its own destructive-change risk
 * (decision #4, `plans/history-content.md`, already treats schema history as
 * view-only for the same reason).
 */
export function syncSchemaChangesToGit(adminPath: string, items: { schemaId: string; op: ContentChangeOp }[]): Promise<"synced" | "failed"> {
  return commitWithRetry(adminPath, items.map((item) => ({ kind: "schema", schemaId: item.schemaId, op: item.op })));
}

/**
 * Resolves one queued failure - `"reset"` writes `pending.rollback` back
 * through the ordinary entries API (the ADMIN'S OWN existing create/
 * update/delete permission grant covers this, no special-cased endpoint)
 * and leaves the draft in place (the admin's edit isn't lost - it still
 * shows as pending, and a later manual Save retries the sync); `"dismiss"`
 * just clears the notification, D1 keeps the un-synced value as-is.
 */
export async function resolvePendingContentSync(pending: PendingContentSync, adminPath: string, action: "reset" | "dismiss"): Promise<void> {
  dismissPendingContentSync(pending.id);
  if (action === "dismiss") return;
  const api = createContentEntriesApi(`${adminPath}/api/content`, pending.typeSlug);
  if (pending.rollback.kind === "remove") {
    if (pending.entryId) await api.remove(pending.entryId);
  } else if (pending.rollback.kind === "recreate") {
    await api.create(pending.rollback.value);
  } else if (pending.entryId) {
    await api.update(pending.entryId, pending.rollback.value);
  } else {
    await api.saveSingleton(pending.rollback.value);
  }
}
