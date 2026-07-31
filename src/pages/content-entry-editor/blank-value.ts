import type { EntryValue, MaskedValue } from "../../content-types/engine/entry-codec.js";
import type { EntryFieldNode } from "../../content-types/engine/entry-tree.js";

const MASKED_FIELD_TYPES = new Set(["password", "secretkey"]);

/** A brand-new entry's (or a brand-new repeatable-component item's) starting
 * value - one sensible empty per field kind, so every `FieldRenderer` always
 * gets a defined value to render rather than needing its own per-type
 * `undefined` fallback. */
export function blankEntryValue(nodes: EntryFieldNode[]): EntryValue {
  const value: EntryValue = {};
  for (const node of nodes) {
    if (node.kind === "column") {
      if (MASKED_FIELD_TYPES.has(node.fieldType)) {
        value[node.fieldName] = { hasExisting: false } satisfies MaskedValue;
      } else if (node.default !== undefined) {
        value[node.fieldName] = node.default;
      } else if (node.fieldType === "boolean") {
        value[node.fieldName] = false;
      } else if (node.fieldType === "select") {
        value[node.fieldName] = (node.fieldConfig as { multiple?: boolean } | undefined)?.multiple ? [] : "";
      } else {
        value[node.fieldName] = null;
      }
    } else if (node.kind === "flatten") {
      value[node.fieldName] = blankEntryValue(node.children);
    } else if (node.kind === "component-repeat") {
      value[node.fieldName] = [];
    } else if (node.kind === "relation") {
      value[node.fieldName] = node.cardinality === "manyToOne" ? null : [];
    } else if (node.kind === "relation-mirror") {
      value[node.fieldName] = node.resolved && node.reverseCardinality === "manyToOne" ? null : [];
    }
  }
  return value;
}
