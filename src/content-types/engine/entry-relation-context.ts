import type { ContentEntryEngineAdapter } from "./entries-types.js";
import type { ContentTypeDefinition } from "../types.js";
import type { EntryFieldNode } from "./entry-tree.js";
import type { EntryValue } from "./entry-codec.js";

const MAX_RELATION_CONTEXT_LINES = 20;
const MAX_LINKED_ROWS_PER_FIELD = 5;
const MAX_PREVIEW_FIELDS_PER_ROW = 3;
const MAX_PREVIEW_VALUE_CHARS = 80;

/** The other side's type + this entry's own linked id(s) for a `relation` or
 * a resolved `relation-mirror` field - `null` for an unresolved mirror
 * (dangling source, same as everywhere else that field degrades). */
function relationTargetInfo(node: EntryFieldNode): { targetTypeId: string; multi: boolean } | null {
  if (node.kind === "relation") return { targetTypeId: node.targetTypeId, multi: node.cardinality !== "manyToOne" };
  if (node.kind === "relation-mirror" && node.resolved) {
    return { targetTypeId: node.sourceTypeId, multi: node.reverseCardinality !== "manyToOne" };
  }
  return null;
}

/** Every `relation`/`relation-mirror` field, recursing into `flatten` groups
 * (same depth `ai-magic-write-prompt.ts`'s own field description walks) -
 * never into `component-repeat` items, to keep this a bounded, cheap walk. */
function collectRelationNodes(nodes: EntryFieldNode[], pathLabel = ""): { node: EntryFieldNode; pathLabel: string }[] {
  const out: { node: EntryFieldNode; pathLabel: string }[] = [];
  for (const node of nodes) {
    const label = pathLabel ? `${pathLabel} / ${node.label}` : node.label;
    if (node.kind === "relation" || node.kind === "relation-mirror") {
      out.push({ node, pathLabel: label });
    } else if (node.kind === "flatten") {
      out.push(...collectRelationNodes(node.children, label));
    }
  }
  return out;
}

/** A lightweight one-line summary of a linked row - its first few PRIMITIVE
 * (string/number/boolean) fields only, in whatever order the row itself
 * has them; nested/array values (its own relations, components, masked
 * password/secretkey) are skipped rather than expanded - this is context
 * for what the entry is, not a second copy of its full data. */
function previewRow(value: EntryValue): string {
  const parts: string[] = [];
  for (const [key, raw] of Object.entries(value)) {
    if (parts.length >= MAX_PREVIEW_FIELDS_PER_ROW) break;
    if (typeof raw === "string") {
      if (!raw.trim()) continue;
      const trimmed = raw.length > MAX_PREVIEW_VALUE_CHARS ? `${raw.slice(0, MAX_PREVIEW_VALUE_CHARS)}…` : raw;
      parts.push(`${key}: ${JSON.stringify(trimmed)}`);
    } else if (typeof raw === "number" || typeof raw === "boolean") {
      parts.push(`${key}: ${raw}`);
    }
  }
  return parts.length > 0 ? parts.join(", ") : "(no preview fields)";
}

/**
 * Read-only preview of what's CURRENTLY linked, for every `relation`/
 * `relation-mirror` field on the entry (`status/magic-write.md` decision #2)
 * - one level deep only (a linked row's OWN relations are never followed), a
 * handful of each linked row's own simple fields, and an overall line cap so
 * a heavily-linked entry can't blow up the prompt. Returns `""` when there's
 * nothing to show (no relation fields, or none currently have a value). This
 * function itself never changes: `status/magic-chat.md`'s Phase B made plain
 * `relation` fields writable, but through `kind: fetch` +
 * `ai-magic-write-fields.ts`'s `allowedRelationIds`, not through this preview
 * - `relation-mirror` stays read-only-only, as it always was.
 */
export async function loadRelationContext(
  entryAdapter: ContentEntryEngineAdapter,
  allTypes: ContentTypeDefinition[],
  nodes: EntryFieldNode[],
  currentValue: EntryValue,
): Promise<string> {
  const lines: string[] = [];
  for (const { node, pathLabel } of collectRelationNodes(nodes)) {
    if (lines.length >= MAX_RELATION_CONTEXT_LINES) break;
    const info = relationTargetInfo(node);
    if (!info) continue;
    const targetType = allTypes.find((candidate) => candidate.id === info.targetTypeId);
    if (!targetType) continue;

    const raw = currentValue[node.fieldName];
    const ids = info.multi
      ? (Array.isArray(raw) ? raw.filter((id): id is number => typeof id === "number") : [])
      : (typeof raw === "number" ? [raw] : []);
    if (ids.length === 0) continue;

    for (const id of ids.slice(0, MAX_LINKED_ROWS_PER_FIELD)) {
      if (lines.length >= MAX_RELATION_CONTEXT_LINES) break;
      const row = await entryAdapter.getEntry(targetType, allTypes, id);
      if (!row) continue;
      lines.push(`- "${pathLabel}" -> ${targetType.label} #${row.id}: ${previewRow(row.value)}`);
    }
  }
  return lines.join("\n");
}
