/**
 * Executes a `kind: create` turn (`status/relation-quick-create.md`) - the
 * model creating a brand-new entry in a collection DIRECTLY related to the
 * one it's editing, via a `relation` field on that entry's own type. Called
 * from `ai-magic-write.ts`'s `streamMagicWrite` loop, never from the client
 * directly - like `kind: fetch`, this is never a terminal SSE `turn` event,
 * just a `resultText` folded back into the conversation as a synthetic
 * message before the model gets another turn.
 *
 * Security shape, same as `ai-magic-write-fetch.ts`'s `executeMagicFetch`,
 * plus one extra check that write access needs and read access doesn't:
 * - `typeSlug` must be in `creatableTypeSlugs` - a scope narrower than
 *   `kind: fetch`'s (which can read ANY content type): only a collection
 *   the entry currently open actually links to via one of its own
 *   `relation` fields, computed by the caller from that entry's own
 *   `EntryFieldNode[]`, never an arbitrary type Magic merely has read access
 *   to elsewhere.
 * - Both `checkAccess(..., "magic")` AND `checkAccess(..., "create")` are
 *   re-run for the EXACT target type - never inherited from the currently-
 *   open entry's own grants. The `magic` check matters even though the
 *   admin is already inside a Magic conversation: without it, an entry
 *   whose OWN type has Magic enabled could be used as a back door to create
 *   rows in a related collection that has Magic turned OFF.
 * - Fields on the new row are coerced by the same `applyMagicWriteFields`
 *   every `kind: fields` write already uses, called with NO
 *   `allowedImageSrcs`/`allowedRelationIds` of its own - a brand-new related
 *   row can't set an `image` or `relation` field of its own in this same
 *   hop (both allow-lists default to empty, so those values are silently
 *   dropped), only plain scalars and nested groups. Keeps one create hop's
 *   blast radius small; a relation/image on the new row can still be set
 *   afterward, as its own entry, the normal way.
 */
import type { ContentTypeDefinition } from "../../content-types/types.js";
import type { ContentEntryEngineAdapter } from "../../content-types/engine/entries-types.js";
import { buildEntryFieldTree } from "../../content-types/engine/entry-tree.js";
import type { MagicWriteCreateTurn } from "../../content-types/ai-magic-write-protocol.js";
import { applyMagicWriteFields } from "../../content-types/ai-magic-write-fields.js";
import { supportsMagic } from "../../content-types/permissions.js";
import type { DryRouteContext } from "../context.js";
import { checkAccess } from "./content-entries.js";

export interface MagicCreateResult {
  /** Short status shown to the admin while this hop runs (`{creating}` SSE
   * event) - never the raw fields the model sent. */
  label: string;
  /** Folded into the conversation as a synthetic `user` message so the next
   * model call can read it. */
  resultText: string;
  /** Set only on success - folded into `streamMagicWrite`'s
   * `allowedRelationIds`, the exact same map a `kind: fetch` hop's
   * `seenEntryIds` populates, so an immediately following `kind: fields`
   * reply may reference this new row for a relation field with a matching
   * `targetTypeId`. */
  createdEntryId?: { targetTypeId: string; id: number };
}

export async function executeMagicCreate(
  context: DryRouteContext,
  entries: ContentEntryEngineAdapter,
  allTypes: ContentTypeDefinition[],
  creatableTypeSlugs: ReadonlySet<string>,
  turn: MagicWriteCreateTurn,
): Promise<MagicCreateResult> {
  const type = allTypes.find((candidate) => candidate.name === turn.typeSlug && candidate.kind !== "component");
  if (!type) {
    const available = [...creatableTypeSlugs].join(", ") || "(none)";
    return { label: `Creating a new "${turn.typeSlug}" entry…`, resultText: `No content type named "${turn.typeSlug}" exists. Available for kind: create: ${available}.` };
  }

  if (!creatableTypeSlugs.has(type.name)) {
    const available = [...creatableTypeSlugs].join(", ") || "(none)";
    return {
      label: `Creating a new "${type.label}" entry…`,
      resultText: `Magic can only create entries in a collection directly related to this entry via a relation field. "${type.name}" isn't one of those here. Available for kind: create: ${available}.`,
    };
  }
  if (type.kind === "singleton") {
    return { label: `Creating a new "${type.label}" entry…`, resultText: `"${type.name}" is a singleton - it always has exactly one entry, there's nothing to create.` };
  }
  if (!supportsMagic(type)) {
    return { label: `Creating a new "${type.label}" entry…`, resultText: `Magic isn't available for "${type.label}".` };
  }

  // Re-checked for THIS type, deliberately never reusing the currently-open
  // entry's own access - see this file's own doc comment.
  const deniedMagic = await checkAccess(context, entries, allTypes, type, "magic");
  if (deniedMagic) {
    return { label: `Creating a new "${type.label}" entry…`, resultText: `You don't have permission to use Magic on "${type.name}".` };
  }
  const deniedCreate = await checkAccess(context, entries, allTypes, type, "create");
  if (deniedCreate) {
    return { label: `Creating a new "${type.label}" entry…`, resultText: `You don't have permission to create "${type.name}" entries.` };
  }

  const nodes = buildEntryFieldTree(type, allTypes);
  const applied = applyMagicWriteFields(nodes, turn.fields);
  if (Object.keys(applied.value).length === 0) {
    return { label: `Creating a new "${type.label}" entry…`, resultText: `No usable fields were given for the new "${type.name}" entry - nothing was created. Relation/image fields can't be set on a brand-new row this way; set those afterward.` };
  }

  try {
    const created = await entries.createEntry(type, allTypes, applied.value);
    const summary = applied.writtenFieldNames.map((name) => `${name}: ${JSON.stringify(String(applied.value[name] ?? ""))}`).join(", ");
    return {
      label: `Created a new "${type.label}" entry…`,
      resultText: `Created ${type.label} (${type.name}) #${created.id}${summary ? ` - ${summary}` : ""}. You may now reference id ${created.id} for a "${type.name}" relation field on this entry.`,
      createdEntryId: { targetTypeId: type.id, id: created.id },
    };
  } catch (error) {
    return { label: `Creating a new "${type.label}" entry…`, resultText: `Could not create the "${type.name}" entry: ${error instanceof Error ? error.message : "unknown error"}.` };
  }
}
