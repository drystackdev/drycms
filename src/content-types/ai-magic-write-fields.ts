import type { EntryColumnNode, EntryFieldNode } from "./engine/entry-tree.js";
import type { EntryValue } from "./engine/entry-codec.js";
import type { ImageFieldConfig, SelectFieldConfig } from "./field-registry.js";
import { sanitizeAiRichTextHtml } from "./ai-richtext-sanitize.js";
import type { MagicWriteRawFields, MagicWriteRawValue } from "./ai-magic-write-protocol.js";

/** The field types Magic Write is allowed to write into - see
 * `status/magic-write.md` decision #2. `relation`/`relation-mirror` are
 * read-only context (never a write target, filtered out before this module
 * ever sees them); `password`/`secretkey` are never exposed to the model at
 * all (excluded from `WRITABLE_COLUMN_TYPES`, same as they're excluded from
 * `ai-magic-write-prompt.ts`'s field description). */
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
 * value typed in by hand. */
function coerceNodeValue(node: EntryFieldNode, raw: MagicWriteRawValue, allowedImageSrcs: ReadonlySet<string>): unknown {
  if (node.kind === "column") {
    if (!WRITABLE_COLUMN_TYPES.has(node.fieldType)) return undefined;
    if (typeof raw !== "string") return undefined;
    return coerceScalar(node, raw, allowedImageSrcs);
  }
  if (node.kind === "flatten") {
    if (typeof raw !== "object" || Array.isArray(raw)) return undefined;
    const nested: EntryValue = {};
    let wroteAny = false;
    for (const child of node.children) {
      if (!(child.fieldName in raw)) continue;
      const value = coerceNodeValue(child, (raw as MagicWriteRawFields)[child.fieldName]!, allowedImageSrcs);
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
        const value = coerceNodeValue(child, (rawItem as MagicWriteRawFields)[child.fieldName]!, allowedImageSrcs);
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
 * server-only or DOM-only imports).
 */
export function applyMagicWriteFields(
  nodes: EntryFieldNode[],
  raw: MagicWriteRawFields,
  allowedImageSrcs: ReadonlySet<string> = new Set(),
): ApplyMagicWriteFieldsResult {
  const value: EntryValue = {};
  const writtenFieldNames: string[] = [];
  for (const node of nodes) {
    if (node.kind === "relation" || node.kind === "relation-mirror") continue;
    if (!(node.fieldName in raw)) continue;
    const coerced = coerceNodeValue(node, raw[node.fieldName]!, allowedImageSrcs);
    if (coerced === undefined) continue;
    value[node.fieldName] = coerced;
    writtenFieldNames.push(node.fieldName);
  }
  return { value, writtenFieldNames };
}
