import type { EntryColumnNode, EntryFieldNode } from "./engine/entry-tree.js";
import type { EntryValue } from "./engine/entry-codec.js";
import type { ImageFieldConfig, SelectFieldConfig } from "./field-registry.js";
import { sanitizeAiRichTextHtml } from "./ai-richtext-sanitize.js";
import type { MagicWriteRawFields, MagicWriteRawValue } from "./ai-magic-write-protocol.js";
import { encodeEntryId } from "../lib/id-hash.js";

/** The field types Magic Write is allowed to write into - see
 * `status/magic-write.md` decision #2. `relation-mirror` stays read-only
 * context (never a write target - a mirror's "claim/unclaim" write semantics
 * belong to the field it mirrors, not this one); `password`/`secretkey` are
 * never exposed to the model at all (excluded from `WRITABLE_COLUMN_TYPES`,
 * same as they're excluded from `ai-magic-write-prompt.ts`'s field
 * description). Plain `relation` fields ("ref"/"refs") became writable in
 * `status/magic-chat.md`'s Phase B, gated by `allowedRelationIds` below -
 * see `coerceNodeValue`'s relation branch for why a `WRITABLE_COLUMN_TYPES`
 * check alone can't cover it (a relation isn't a `column` node at all). */
export const WRITABLE_COLUMN_TYPES = new Set(["text", "richtext", "number", "boolean", "date", "select", "image"]);

export function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function coerceScalar(node: EntryColumnNode, text: string, allowedImageSrcs: ReadonlySet<string>): unknown {
  switch (node.fieldType) {
    case "text":
      return text;
    case "richtext":
      return sanitizeAiRichTextHtml(text, allowedImageSrcs);
    case "number": {
      const num = Number(text.trim());
      return Number.isFinite(num) ? num : undefined;
    }
    case "boolean":
      return text.trim().toLowerCase() === "true";
    case "date": {
      const date = new Date(text.trim());
      return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
    }
    case "select": {
      const options = (node.fieldConfig as SelectFieldConfig | undefined)?.options ?? [];
      const trimmed = text.trim();
      return options.includes(trimmed) ? trimmed : undefined;
    }
    case "image": {
      // Only a path from the CLOSED set the request actually offered the
      // model as context is trusted (see status/magic-write.md decision #3)
      // - never an arbitrary model-authored string, verified server-side via
      // `storage.stat()` before it ever reaches `allowedImageSrcs`.
      const trimmed = text.trim();
      if (!allowedImageSrcs.has(trimmed)) return undefined;
      return (node.fieldConfig as ImageFieldConfig | undefined)?.multiple ? [trimmed] : trimmed;
    }
    default:
      return undefined;
  }
}

/** Per-target-type sets of entry ids Magic is actually allowed to link a
 * relation field to - the relation counterpart to `allowedImageSrcs`, same
 * "never trust a model-claimed value outright" rationale
 * (`status/magic-write.md` decision #3). Populated ONLY from this turn's own
 * `kind: fetch` results (`ai-magic-write.ts`), never accumulated across the
 * session the way `allowedImageSrcs` is - re-running a cheap internal lookup
 * is nowhere near the cost of re-sending an image, so there's no need to
 * remember an id past the turn that fetched it. Keyed by `targetTypeId`
 * (`EntryRelationNode.targetTypeId`), since a bare numeric id alone is
 * ambiguous across different content types' tables. */
export type AllowedRelationIds = ReadonlyMap<string, ReadonlySet<number>>;

/** A `manyToOne` field writes a single scalar id (`author: 12`); `oneToMany`/
 * `manyToMany` write a comma-separated list (`tags: 12,45,88`) - deliberately
 * NOT a block sequence like `component-repeat` uses, so this needed zero
 * changes to the shared YAML-subset parser (ids are still just one plain
 * scalar line, same grammar rule number/boolean/date/select/image already
 * use). Every id must appear in `allowed` (this turn's own `kind: fetch`
 * results for this exact `targetTypeId`) or it's dropped - a relation write
 * the model never actually looked up via `fetch` is treated the same as one
 * that doesn't exist, per `status/magic-chat.md`'s "the model can only link
 * what it's already seen" design (mirrors `allowedImageSrcs` exactly).
 *
 * The model's OWN wire format stays a raw engine id throughout (what
 * `kind: fetch` showed it is exactly what it writes back - no translation
 * for the model to get wrong) - but the FINAL `EntryValue` this returns
 * encodes it (`lib/id-hash.ts`'s `encodeEntryId`) before handing it back.
 * That's not optional: EVERY relation value already flowing through this
 * app is the hashed-string form the moment it leaves the DB layer
 * (`content-entries.ts`'s `encodeRelationIds`, run on every GET) - a raw
 * number here would reach `updateFieldValue` and silently fail to render
 * (`RelationFieldAdapter`'s `typeof value === "string"` check just falls
 * through to "no selection") the instant the admin looks at the field,
 * caught by an actual browser check, not by reading the code. */
function coerceRelation(node: Extract<EntryFieldNode, { kind: "relation" }>, raw: MagicWriteRawValue, allowedRelationIds: AllowedRelationIds): unknown {
  if (typeof raw !== "string") return undefined;
  const allowed = allowedRelationIds.get(node.targetTypeId);
  if (!allowed || allowed.size === 0) return undefined;
  if (node.cardinality === "manyToOne") {
    const id = Number(raw.trim());
    return Number.isFinite(id) && allowed.has(id) ? encodeEntryId(id) : undefined;
  }
  const ids = raw
    .split(",")
    .map((piece) => Number(piece.trim()))
    .filter((id) => Number.isFinite(id) && allowed.has(id));
  return ids.length > 0 ? ids.map(encodeEntryId) : undefined;
}

/** Schema-driven, per-node coercion of one field's raw wire value into a
 * real `EntryValue` value - `undefined` means "drop this field" (wrong
 * shape from the model, an out-of-range select option, an unparseable
 * number/date, or a field type this pass doesn't support yet). Recurses for
 * `flatten` and `component-repeat` (Phase 3, `status/magic-write.md`) - a
 * model-provided `component-repeat` array always REPLACES the field's
 * current items wholesale (the wire dialect has no per-item id to merge
 * against), same "whole value replaced" semantics every other field already
 * has; item-count `min`/`max` isn't enforced here - the normal Save-time
 * `entry-validate.ts` pass still catches that, same as it would for a
 * value typed in by hand (also true for a relation field's `min`/`max`). */
function coerceNodeValue(node: EntryFieldNode, raw: MagicWriteRawValue, allowedImageSrcs: ReadonlySet<string>, allowedRelationIds: AllowedRelationIds): unknown {
  if (node.kind === "column") {
    if (!WRITABLE_COLUMN_TYPES.has(node.fieldType)) return undefined;
    if (typeof raw !== "string") return undefined;
    return coerceScalar(node, raw, allowedImageSrcs);
  }
  if (node.kind === "relation") return coerceRelation(node, raw, allowedRelationIds);
  if (node.kind === "flatten") {
    if (typeof raw !== "object" || Array.isArray(raw)) return undefined;
    const nested: EntryValue = {};
    let wroteAny = false;
    for (const child of node.children) {
      if (!(child.fieldName in raw)) continue;
      const value = coerceNodeValue(child, (raw as MagicWriteRawFields)[child.fieldName]!, allowedImageSrcs, allowedRelationIds);
      if (value === undefined) continue;
      nested[child.fieldName] = value;
      wroteAny = true;
    }
    return wroteAny ? nested : undefined;
  }
  if (node.kind === "component-repeat") {
    if (!Array.isArray(raw)) return undefined;
    const items: EntryValue[] = [];
    for (const rawItem of raw) {
      if (typeof rawItem !== "object" || Array.isArray(rawItem)) continue;
      const item: EntryValue = {};
      let wroteAny = false;
      for (const child of node.itemFields) {
        if (!(child.fieldName in rawItem)) continue;
        const value = coerceNodeValue(child, (rawItem as MagicWriteRawFields)[child.fieldName]!, allowedImageSrcs, allowedRelationIds);
        if (value === undefined) continue;
        item[child.fieldName] = value;
        wroteAny = true;
      }
      if (wroteAny) items.push(item);
    }
    return items.length > 0 ? items : undefined;
  }
  return undefined;
}

export interface ApplyMagicWriteFieldsResult {
  /** Only the top-level fields actually written, ready to spread into the
   * entry's `EntryValue`. */
  value: EntryValue;
  /** Same fields' names, in the order the model wrote them. */
  writtenFieldNames: string[];
}

/**
 * The schema-driven validation step (`status/magic-write.md`'s "Validate
 * schema-driven") - walks `nodes` (the entry's TOP-LEVEL `EntryFieldNode[]`,
 * from `buildEntryFieldTree`) against the model's raw parsed `fields`
 * mapping and coerces every field the model chose to write to match its
 * real type. No scope/mode restriction: the admin's prompt is the only
 * input the model gets on WHICH fields to touch (see
 * `ai-magic-write-prompt.ts`'s own instructions) - it sees every field's
 * current value and decides for itself what needs (or doesn't need)
 * changing, rather than the admin pre-selecting a fixed set through the UI.
 * Shared between the server route (`ai-magic-write.ts`'s authoritative
 * terminal validation) and the client (`MagicChat.tsx`'s live
 * per-field commit as each one closes while streaming) - both need the
 * exact same rules, so this stays framework/runtime-agnostic (no
 * server-only or DOM-only imports). `allowedRelationIds` defaults to empty
 * (nothing allowed) - the client's live per-field commit call never passes
 * one, so a relation field simply never live-previews mid-stream, same as an
 * `image` field already doesn't; both only actually land once the server's
 * authoritative terminal call (which DOES have real ids from this turn's
 * `fetch` results) applies them.
 */
export function applyMagicWriteFields(
  nodes: EntryFieldNode[],
  raw: MagicWriteRawFields,
  allowedImageSrcs: ReadonlySet<string> = new Set(),
  allowedRelationIds: AllowedRelationIds = new Map(),
): ApplyMagicWriteFieldsResult {
  const value: EntryValue = {};
  const writtenFieldNames: string[] = [];
  for (const node of nodes) {
    if (node.kind === "relation-mirror") continue;
    if (!(node.fieldName in raw)) continue;
    const coerced = coerceNodeValue(node, raw[node.fieldName]!, allowedImageSrcs, allowedRelationIds);
    if (coerced === undefined) continue;
    value[node.fieldName] = coerced;
    writtenFieldNames.push(node.fieldName);
  }
  return { value, writtenFieldNames };
}
