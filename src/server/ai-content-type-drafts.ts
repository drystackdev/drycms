/**
 * Server-side staging area for AI-proposed content-type schema changes
 * (`mcp.ts`'s `propose_content_type` tool) - the same "index + per-draft
 * record" KV split `auth-security.ts` already uses for Personal Access
 * Tokens (`MCP_TOKEN_NAMESPACE`/`MCP_TOKEN_INDEX_NAMESPACE`), reused here
 * instead of `mcp-activity`'s single-array-of-blobs shape: a full
 * `ContentTypeDefinition` can be large, so each draft gets its OWN KV value
 * (own 1MB budget, `kv/codec.ts`'s `DEFAULT_MAX_VALUE_BYTES`) and can be
 * deleted individually on apply/discard, while the per-user index stays
 * small and cheap to read for a badge/count.
 *
 * An MCP write NEVER touches the live schema directly - it lands here, and
 * only becomes real once the admin reviews and applies it through the exact
 * same "Apply and build" flow (`ApplyBuildDialog.tsx`,
 * `routes/content-types.ts`'s `handleBatch`) a human-authored draft already
 * goes through - `routes/ai-content-type-drafts.ts` is what the browser
 * polls/deletes from, `content-types/draft-store.ts` (client) is what
 * merges a pulled draft into that same review UI.
 */
import { getAuthSecurityStore } from "./auth-security.js";
import type { ContentTypeDefinition } from "../content-types/types.js";

const AI_DRAFT_NAMESPACE = "ai-content-type-drafts";
const AI_DRAFT_INDEX_NAMESPACE = "ai-content-type-draft-index";

/** Safety net if a proposal is never reviewed - the same "long-lived, no
 * refresh cycle" default `MCP_TOKEN_NAMESPACE` uses for a real PAT would be
 * wrong here (a stale, forgotten AI proposal shouldn't linger forever), but
 * something well past any realistic review delay. */
const DRAFT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Cap on pending AI proposals per user - same "evict, don't grow unbounded"
 * shape `mcp.ts`'s `MAX_ACTIVITY_ENTRIES` uses, just smaller: unlike an
 * activity log, an uncleared proposal is actual pending work for the admin,
 * not just a record of the past. */
const MAX_PENDING_DRAFTS = 20;

export interface AiContentTypeDraft {
  id: string;
  definition: ContentTypeDefinition;
  isNew: boolean;
  createdAt: string;
}

type AiContentTypeDraftIndexEntry = Pick<AiContentTypeDraft, "id" | "isNew" | "createdAt"> & {
  name: string;
  label: string;
  kind: ContentTypeDefinition["kind"];
};

function indexKey(userId: number): string {
  return `user-${userId}`;
}

export async function listAiContentTypeDrafts(userId: number, env: Record<string, unknown> = {}): Promise<AiContentTypeDraft[]> {
  const store = getAuthSecurityStore(env);
  const index = (await store.get<AiContentTypeDraftIndexEntry[]>(AI_DRAFT_INDEX_NAMESPACE, indexKey(userId))) ?? [];
  const drafts = await Promise.all(index.map((entry) => store.get<AiContentTypeDraft>(AI_DRAFT_NAMESPACE, entry.id)));
  return drafts.filter((draft): draft is AiContentTypeDraft => draft !== null);
}

/** Evicts the oldest pending draft once `MAX_PENDING_DRAFTS` is reached -
 * same "cap, don't reject" tradeoff `mcp.ts`'s activity log makes, chosen so
 * a chatty/misbehaving MCP client degrades gracefully rather than starts
 * erroring on every further proposal. */
export async function saveAiContentTypeDraft(userId: number, draft: AiContentTypeDraft, env: Record<string, unknown> = {}): Promise<void> {
  const store = getAuthSecurityStore(env);
  await store.set(AI_DRAFT_NAMESPACE, draft.id, draft, { durability: "sync", ttlMs: DRAFT_TTL_MS });

  const current = (await store.get<AiContentTypeDraftIndexEntry[]>(AI_DRAFT_INDEX_NAMESPACE, indexKey(userId))) ?? [];
  const withoutThisId = current.filter((entry) => entry.id !== draft.id);
  const indexEntry: AiContentTypeDraftIndexEntry = {
    id: draft.id,
    name: draft.definition.name,
    label: draft.definition.label,
    kind: draft.definition.kind,
    isNew: draft.isNew,
    createdAt: draft.createdAt,
  };
  const next = [indexEntry, ...withoutThisId].slice(0, MAX_PENDING_DRAFTS);
  const evicted = withoutThisId.slice(MAX_PENDING_DRAFTS - 1);
  await Promise.all(evicted.map((entry) => store.delete(AI_DRAFT_NAMESPACE, entry.id)));
  await store.set(AI_DRAFT_INDEX_NAMESPACE, indexKey(userId), next, { durability: "sync" });
}

export async function deleteAiContentTypeDraft(userId: number, id: string, env: Record<string, unknown> = {}): Promise<void> {
  const store = getAuthSecurityStore(env);
  await store.delete(AI_DRAFT_NAMESPACE, id);
  const current = (await store.get<AiContentTypeDraftIndexEntry[]>(AI_DRAFT_INDEX_NAMESPACE, indexKey(userId))) ?? [];
  const next = current.filter((entry) => entry.id !== id);
  if (next.length === current.length) return;
  await store.set(AI_DRAFT_INDEX_NAMESPACE, indexKey(userId), next, { durability: "sync" });
}
