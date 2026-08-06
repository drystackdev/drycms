/**
 * Executes a `kind: fetch` turn (`status/magic-chat.md` decision #5, Phase
 * B) - the model actively looking up data OUTSIDE the entry it's editing,
 * INSIDE drycms itself (never the internet - see `ai-magic-write-prompt.ts`'s
 * `CAPABILITY_INSTRUCTION`). Called from `ai-magic-write.ts`'s
 * `streamMagicWrite` loop, never from the client directly - a `kind: fetch`
 * reply is never a terminal SSE `turn` event, just a `resultText` folded back
 * into the conversation as a synthetic message before the model gets another
 * turn.
 *
 * Security shape, same as every other route in this codebase:
 * - Every "entries"/"entry" query re-runs `checkAccess` for the EXACT type
 *   being asked about, with "view" (the read action) - never inherits the
 *   currently-open entry's own "update" access, so Magic can't be used to
 *   read a type the admin has no view permission on.
 * - `password`/`secretkey` never appear: `entryAdapter.getEntry`/
 *   `listEntries` already mask them to a `{hasExisting}` marker at the
 *   engine layer (`entry-codec.ts`'s `rowToValue`, shared by every caller,
 *   not just the HTTP route) - `formatRow` below additionally only ever
 *   prints a plain string/number/boolean, so a masked marker object is
 *   silently skipped rather than printed as if it were real data.
 * - This module never calls `getRawEntry` (the one adapter method that
 *   deliberately bypasses masking) and never should.
 */
import type { ContentTypeDefinition } from "../../content-types/types.js";
import type { ContentEntryEngineAdapter, EntryRow } from "../../content-types/engine/entries-types.js";
import { buildEntryFieldTree, type EntryFieldNode } from "../../content-types/engine/entry-tree.js";
import type { EntryValue } from "../../content-types/engine/entry-codec.js";
import type { MagicWriteFetchTurn } from "../../content-types/ai-magic-write-protocol.js";
import type { DryRouteContext } from "../context.js";
import type { ResolvedStorageOption } from "../options.js";
import { getStorageAdapter } from "../storage-adapters.js";
import { checkAccess } from "./content-entries.js";

export interface MagicFetchResult {
  /** Short status shown to the admin while this hop runs (`{fetching}` SSE
   * event) - never the raw query or its full result. */
  label: string;
  /** Folded into the conversation as a synthetic `user` message so the next
   * model call can read it. */
  resultText: string;
  /** Set only when this hop actually resolved real entry rows ("entries"/
   * "entry") - folded into `streamMagicWrite`'s `allowedRelationIds` so a
   * `kind: fields` reply may reference one of these ids for a relation field
   * with a matching `targetTypeId`. Never set for "media"/"types", or for an
   * "entries"/"entry" query that matched nothing or was denied. */
  seenEntryIds?: { targetTypeId: string; ids: number[] };
}

const FETCH_PAGE_SIZE = 5;
const MAX_PREVIEW_FIELDS_PER_ROW = 6;
const MAX_PREVIEW_VALUE_CHARS = 150;
const MAX_MEDIA_ITEMS = 30;

/** A lightweight one-line summary of a row, id first (the part a relation
 * write actually needs) - only top-level SCALAR columns (string/number/
 * boolean), same "context, not a second copy of the data" spirit as
 * `entry-relation-context.ts`'s `previewRow`, deliberately not reused from
 * there since that one is private to its own file and tuned for a different
 * (tighter) budget. Relations/flatten groups/component-repeat items/nulls/
 * masked password-secretkey markers are all silently skipped, not expanded -
 * this is a lookup aid, not a full export. */
function formatRow(nodes: EntryFieldNode[], id: number, value: EntryValue): string {
  const parts: string[] = [];
  for (const node of nodes) {
    if (parts.length >= MAX_PREVIEW_FIELDS_PER_ROW) break;
    if (node.kind !== "column") continue;
    const raw = value[node.fieldName];
    if (typeof raw === "string") {
      if (!raw.trim()) continue;
      const trimmed = raw.length > MAX_PREVIEW_VALUE_CHARS ? `${raw.slice(0, MAX_PREVIEW_VALUE_CHARS)}…` : raw;
      parts.push(`${node.fieldName}: ${JSON.stringify(trimmed)}`);
    } else if (typeof raw === "number" || typeof raw === "boolean") {
      parts.push(`${node.fieldName}: ${raw}`);
    }
  }
  return `#${id}: ${parts.length > 0 ? parts.join(", ") : "(no preview fields)"}`;
}

/** `source: "entries"`/`"entry"` share everything past "resolve the rows" -
 * a singleton has at most one implicit row (no real list, no real id), so
 * both sources degrade to the same `getSingletonEntry` call for one. */
async function resolveRows(
  entries: ContentEntryEngineAdapter,
  allTypes: ContentTypeDefinition[],
  type: ContentTypeDefinition,
  turn: MagicWriteFetchTurn,
): Promise<{ rows: EntryRow[]; total: number }> {
  if (type.kind === "singleton") {
    const row = await entries.getSingletonEntry(type, allTypes);
    return { rows: row ? [row] : [], total: row ? 1 : 0 };
  }
  if (turn.source === "entry") {
    const id = Number(turn.id);
    if (!Number.isFinite(id)) return { rows: [], total: 0 };
    const row = await entries.getEntry(type, allTypes, id);
    return { rows: row ? [row] : [], total: row ? 1 : 0 };
  }
  const nodes = buildEntryFieldTree(type, allTypes);
  const searchableFields = nodes.filter((node): node is Extract<EntryFieldNode, { kind: "column" }> => node.kind === "column" && node.fieldType === "text").map((node) => node.fieldName);
  return entries.listEntries(type, allTypes, {
    page: 0,
    pageSize: FETCH_PAGE_SIZE,
    search: turn.search,
    searchableFields: turn.search ? searchableFields : undefined,
    sortDir: "desc",
  });
}

async function executeEntriesFetch(
  context: DryRouteContext,
  entries: ContentEntryEngineAdapter,
  allTypes: ContentTypeDefinition[],
  turn: MagicWriteFetchTurn,
): Promise<MagicFetchResult> {
  const type = allTypes.find((candidate) => candidate.name === turn.typeSlug && candidate.kind !== "component");
  if (!type) {
    const available = allTypes.filter((candidate) => candidate.kind !== "component").map((candidate) => candidate.name).join(", ") || "(none)";
    return { label: `Looking up "${turn.typeSlug}"…`, resultText: `No content type named "${turn.typeSlug}" exists. Available: ${available}.` };
  }

  // Re-checked for THIS type every call, deliberately never reusing the
  // currently-open entry's own access check - "view" is the read action
  // (`permissions.ts`'s `PERMISSION_ACTIONS`), distinct from the "update"/
  // "setting" this same entry's own writes are gated on.
  const denied = await checkAccess(context, entries, allTypes, type, type.kind === "singleton" ? "setting" : "view");
  if (denied) {
    return { label: `Looking up "${type.label}"…`, resultText: `You don't have permission to view "${type.name}".` };
  }

  const nodes = buildEntryFieldTree(type, allTypes);
  const { rows, total } = await resolveRows(entries, allTypes, type, turn);

  if (turn.source === "entry") {
    const row = rows[0];
    if (!row) return { label: `Looking up ${type.label}…`, resultText: `No "${type.name}" entry with id ${turn.id}.` };
    return {
      label: `Looking up ${type.label} #${row.id}…`,
      resultText: `${type.label} (${type.name}) entry:\n${formatRow(nodes, row.id, row.value)}`,
      seenEntryIds: { targetTypeId: type.id, ids: [row.id] },
    };
  }

  const lines = rows.map((row) => formatRow(nodes, row.id, row.value));
  const searchNote = turn.search ? ` matching "${turn.search}"` : "";
  return {
    label: `Looking up ${rows.length} "${type.label}" ${rows.length === 1 ? "entry" : "entries"}…`,
    resultText:
      lines.length > 0
        ? `${type.label} (${type.name}) entries (${rows.length} of ${total}${searchNote}):\n${lines.join("\n")}`
        : `No "${type.name}" entries found${searchNote}.`,
    seenEntryIds: rows.length > 0 ? { targetTypeId: type.id, ids: rows.map((row) => row.id) } : undefined,
  };
}

async function executeMediaFetch(context: DryRouteContext, storageOption: ResolvedStorageOption, turn: MagicWriteFetchTurn): Promise<MagicFetchResult> {
  const path = turn.path ?? "";
  const label = `Looking up media${path ? ` in "${path}"` : ""}…`;
  try {
    // `list()` (not the optional `listNames()`) - always present on every
    // backend (`storage/types.ts`), and the extra size/modifiedAt fields it
    // carries are simply unused here rather than worth guarding against a
    // backend that doesn't implement the leaner variant.
    const items = await getStorageAdapter(storageOption, context).list(path);
    const lines = items.slice(0, MAX_MEDIA_ITEMS).map((item) => `- ${path ? `${path}/` : ""}${item.name}${item.kind === "folder" ? "/" : ""}`);
    if (lines.length === 0) return { label, resultText: `"${path || "(root)"}" is empty.` };
    const truncatedNote = items.length > MAX_MEDIA_ITEMS ? `\n(${items.length - MAX_MEDIA_ITEMS} more not shown - narrow with a more specific "path")` : "";
    return { label, resultText: `Files/folders in "${path || "(root)"}":\n${lines.join("\n")}${truncatedNote}` };
  } catch (error) {
    return { label, resultText: `Could not list "${path || "(root)"}": ${error instanceof Error ? error.message : "unknown error"}.` };
  }
}

function executeTypesFetch(allTypes: ContentTypeDefinition[]): MagicFetchResult {
  const lines = allTypes.filter((type) => type.kind !== "component").map((type) => `- ${type.name} (label: "${type.label}", ${type.kind})`);
  return {
    label: "Looking up content types…",
    resultText: lines.length > 0 ? `Content types:\n${lines.join("\n")}` : "No content types exist.",
  };
}

export async function executeMagicFetch(
  context: DryRouteContext,
  entries: ContentEntryEngineAdapter,
  allTypes: ContentTypeDefinition[],
  storageOption: ResolvedStorageOption,
  turn: MagicWriteFetchTurn,
): Promise<MagicFetchResult> {
  if (turn.source === "types") return executeTypesFetch(allTypes);
  if (turn.source === "media") return executeMediaFetch(context, storageOption, turn);
  return executeEntriesFetch(context, entries, allTypes, turn);
}
