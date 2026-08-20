import { signal } from "@preact/signals";
import type { ContentTypeDefinition } from "./types.js";
import type { SchemaDraft } from "./schema-document.js";

const { path } = window.__DRY_CONFIG__;

export type DraftSource = "local" | "ai";

export interface DraftEntry {
  definition: ContentTypeDefinition;
  /** Whether this id exists on the server yet - `true` for a content type
   * that was drafted but never applied, so `BuilderContentType.tsx`/
   * `ContentTypeEditor.tsx` know there's no live row to diff against or
   * delete. */
  isNew: boolean;
  /** `"ai"` for a draft pulled from the server's `ai-content-type-drafts`
   * staging area (an MCP `propose_content_type` proposal) - `"local"` for
   * one the admin (or the in-app AI Schema Wizard) staged themselves. Only
   * an `"ai"` draft has a matching server-side row to clean up once
   * resolved - see `deleteAiContentTypeDraftOnServer` below. */
  source: DraftSource;
}

type DraftMap = Record<string, DraftEntry>;

/**
 * Every pending, unapplied edit to a content type, keyed by id - the
 * "staged changes" store behind the Content Types builder's "Apply and
 * build" flow (see `status/content-type-staged-apply.md`). Backed by the
 * `drafts` half of `content/types.json` (`schema-document.ts`) through
 * `GET`/`PUT {path}/api/content-type-drafts` - the SAME file the applied
 * schema lives in, so a staged change travels with the project (and is
 * committed to git by "Apply and build") instead of living in one browser
 * profile's IndexedDB, which is where this store used to keep it.
 *
 * A `@preact/signals` value (same pattern as `store/content-types.ts`'s
 * `contentTypesVersion`) so `BuilderContentType.tsx`'s list/badges and
 * `ContentTypeEditor.tsx`'s Save button both re-render on every change
 * without prop drilling or manual event wiring. Starts EMPTY and is
 * populated asynchronously by `hydrateContentTypeDraftIndex()` (called once
 * from `DryLayout`'s mount effect, same "pop in shortly after first paint"
 * tradeoff `entryDraftIndex` already accepts) - a `getDraft()` call right
 * after page load can transiently miss a real draft until hydration
 * finishes.
 */
export const drafts = signal<DraftMap>({});

export async function hydrateContentTypeDraftIndex(): Promise<void> {
  try {
    const response = await fetch(`${path}/api/content-type-drafts`, { credentials: "same-origin" });
    if (!response.ok) return;
    const body = (await response.json()) as { drafts?: SchemaDraft[] };
    const next: DraftMap = {};
    for (const draft of body.drafts ?? []) {
      next[draft.definition.id] = { definition: draft.definition, isNew: draft.isNew, source: draft.source };
    }
    drafts.value = next;
  } catch {
    // Same degrade-safely contract the IndexedDB version had: a failed
    // hydrate leaves the store empty rather than breaking the page, and the
    // next write re-publishes whatever this tab does have.
  }
}

/**
 * Every draft write goes through ONE queued `PUT` of the whole staging area
 * (the client always renders the complete set, so there is nothing to
 * reconcile per-item) - chained rather than fired in parallel so two quick
 * edits can't land out of order and resurrect a discarded draft. Always
 * sends `drafts.value` as read at send time, never a captured copy, so a
 * write queued behind another automatically carries the newest state.
 */
let pendingPersist: Promise<void> = Promise.resolve();

function persistDrafts(): void {
  pendingPersist = pendingPersist.then(async () => {
    const payload: SchemaDraft[] = Object.values(drafts.value).map((entry) => ({
      definition: entry.definition,
      isNew: entry.isNew,
      source: entry.source,
      updatedAt: Date.now(),
    }));
    try {
      await fetch(`${path}/api/content-type-drafts`, {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ drafts: payload }),
      });
    } catch {
      // Best-effort: the signal (what the UI reads) already reflects the
      // change, and the next write retries the whole set anyway.
    }
  });
}

const CHANNEL_NAME = "drycms-content-type-drafts";

let channel: BroadcastChannel | undefined;

function getChannel(): BroadcastChannel | undefined {
  if (typeof BroadcastChannel === "undefined") return undefined;
  channel ??= new BroadcastChannel(CHANNEL_NAME);
  return channel;
}

/** Publishes the whole map, not a per-draft delta: the server-side staging
 * area is replaced wholesale on every write, so the other tabs' copy should
 * be too - and it saves them a round trip to see what this tab just did. */
function broadcastDrafts(): void {
  try {
    getChannel()?.postMessage(drafts.value);
  } catch {
    // Best-effort - a tab that can't broadcast still has its own write.
  }
}

/** Keeps `drafts` current when a DIFFERENT tab writes or discards a draft -
 * same purpose `entry-draft-store.ts`'s `watchEntryDraftIndex` has. Called
 * once from `DryLayout`'s mount effect, right next to
 * `hydrateContentTypeDraftIndex()`. */
export function watchContentTypeDraftIndex(): () => void {
  const ch = getChannel();
  if (!ch) return () => {};
  const handler = (event: MessageEvent) => {
    drafts.value = event.data as DraftMap;
  };
  ch.addEventListener("message", handler);
  return () => ch.removeEventListener("message", handler);
}

export function getDraft(id: string): DraftEntry | undefined {
  return drafts.value[id];
}

/** Updates `drafts` synchronously (so a caller like `AiSchemaWizardPanel.tsx`
 * can read `getDraft()`/`drafts.value` right after calling this and see its
 * own write, exactly like the old synchronous-localStorage version behaved)
 * - the `PUT` itself is fire-and-forget underneath. No debounce
 * (unlike `entry-draft-store.ts`'s `saveEntryDraft`): a content-type draft
 * is written on discrete actions (clicking Save, a wizard staging a
 * proposal, a sync pulling one from the server), never on every keystroke,
 * so there's no rapid-fire call rate to coalesce. */
export function saveDraft(definition: ContentTypeDefinition, isNew: boolean, source: DraftSource = "local"): void {
  drafts.value = { ...drafts.value, [definition.id]: { definition, isNew, source } };
  broadcastDrafts();
  persistDrafts();
}

export function discardDraft(id: string): void {
  if (!(id in drafts.value)) return;
  const next = { ...drafts.value };
  delete next[id];
  drafts.value = next;
  broadcastDrafts();
  persistDrafts();
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
  broadcastDrafts();
  persistDrafts();
}

interface AiContentTypeDraftPayload {
  id: string;
  definition: ContentTypeDefinition;
  isNew: boolean;
  createdAt: string;
}

/** A pending AI proposal (`ai-content-type-drafts.ts` server-side) that
 * conflicts with a draft already staged for the
 * SAME content type id - `syncAiContentTypeDrafts()` surfaces these instead
 * of silently overwriting, so `BuilderContentType.tsx` can ask the admin
 * "overwrite with the AI's version, or keep what's already here?" before
 * touching anything. */
export interface AiDraftConflict {
  server: AiContentTypeDraftPayload;
  local: DraftEntry;
}

/** Last version this tab saw from `GET /api/ai-content-type-drafts` (see
 * `status/build-cache.md`'s data-version protocol, same shape
 * `http-api.ts`'s `listVersioned` uses for `content-types:list`) - sent back
 * as `X-Data-Version` on the NEXT poll so the common "nothing new since last
 * time" case (this runs on a plain interval, `AI_DRAFT_POLL_MS`, almost
 * always with nothing pending) answers with a tiny `{changed:false}` instead
 * of re-sending every pending draft's full `ContentTypeDefinition`. Module-
 * level, not persisted: resets to `undefined` on a full page reload, which
 * just means that first poll fetches fully again - the same cold-start cost
 * `listVersioned` accepts elsewhere. */
let lastKnownAiDraftsVersion: number | undefined;

/** Pulls every pending AI-proposed draft this account has on the server
 * (`GET /api/ai-content-type-drafts`) and merges each one into the SAME
 * staging area `drafts` above holds - so it shows up in the
 * exact same "Apply and build" review UI a human-typed draft already gets,
 * no separate screen. A server draft whose id has no local counterpart yet
 * (or whose content already matches what's stored locally) is merged in
 * immediately; one that CONFLICTS with a different, already-present local
 * draft for the same id is left untouched and returned instead, for the
 * caller to resolve via `resolveAiDraftConflict`. Best-effort: a network
 * failure here just means the admin doesn't see new proposals until the
 * next sync, never a hard error. */
export async function syncAiContentTypeDrafts(): Promise<AiDraftConflict[]> {
  let serverDrafts: AiContentTypeDraftPayload[];
  try {
    const headers =
      lastKnownAiDraftsVersion === undefined ? undefined : { "X-Data-Version": String(lastKnownAiDraftsVersion) };
    const response = await fetch(`${path}/api/ai-content-type-drafts`, { credentials: "same-origin", headers });
    if (!response.ok) return [];
    const body = (await response.json()) as { changed: boolean; version: number; drafts?: AiContentTypeDraftPayload[] };
    lastKnownAiDraftsVersion = body.version;
    if (!body.changed) return [];
    serverDrafts = Array.isArray(body.drafts) ? body.drafts : [];
  } catch {
    return [];
  }

  // A full changed payload is authoritative for server-staged AI drafts.
  // Remove local AI mirrors that were applied/discarded elsewhere or whose
  // 30-day server TTL expired; human/local drafts are never touched here.
  const serverIds = new Set(serverDrafts.map((draft) => draft.id));
  for (const [id, local] of Object.entries(drafts.value)) {
    if (local.source === "ai" && !serverIds.has(id)) discardDraft(id);
  }

  const conflicts: AiDraftConflict[] = [];
  for (const server of serverDrafts) {
    const local = getDraft(server.id);
    if (local && JSON.stringify(local.definition) !== JSON.stringify(server.definition)) {
      conflicts.push({ server, local });
      continue;
    }
    saveDraft(server.definition, server.isNew, "ai");
  }
  return conflicts;
}

/** Resolves one `AiDraftConflict`: `"overwrite"` accepts the AI's version
 * into the local draft store (still just pending review, same as any other
 * draft - the server-side copy is cleared later, when the admin actually
 * applies or discards it via `ApplyBuildDialog.tsx`); `"keep"` leaves the
 * local draft untouched and rejects the AI's proposal by clearing its
 * server-side copy right away, so it doesn't keep reappearing on every
 * future sync. */
export async function resolveAiDraftConflict(conflict: AiDraftConflict, action: "overwrite" | "keep"): Promise<void> {
  if (action === "overwrite") {
    saveDraft(conflict.server.definition, conflict.server.isNew, "ai");
  } else {
    await deleteAiContentTypeDraftOnServer(conflict.server.id);
  }
}

/** Clears one pending AI proposal server-side (`DELETE
 * /api/ai-content-type-drafts/:id`) - called once the admin has resolved it
 * one way or another (applied it, rejected it via `resolveAiDraftConflict`,
 * or discarded it from `ApplyBuildDialog.tsx`/`ContentTypeEditor.tsx`).
 * Fire-and-forget from every call site's perspective is fine to await here
 * since none of them are on a hot path, but a failure must never block the
 * admin's own action - the 30-day TTL on the server row
 * (`ai-content-type-drafts.ts`) is the backstop if this never lands. */
export async function deleteAiContentTypeDraftOnServer(id: string): Promise<void> {
  try {
    await fetch(`${path}/api/ai-content-type-drafts/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "same-origin" });
  } catch {
    // Best-effort - see doc comment above.
  }
}
