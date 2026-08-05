import type { EntryValue } from "./engine/entry-codec.js";
import type { EntryFieldNode } from "./engine/entry-tree.js";

export interface EntryFieldDiff {
  fieldName: string;
  label: string;
  before: unknown;
  after: unknown;
}

/** Formats a raw entry field value for the Preview dialog's before/after
 * columns - plain scalars print as themselves, everything else (image,
 * relation, richtext JSON, component-repeat arrays) falls back to a compact
 * one-line JSON dump. Deliberately generic across field types rather than a
 * per-field-type renderer: the Preview dialog is a changed-fields diff list,
 * not a fully rendered preview (see `status/entry-drafts.md`). */
export function formatDiffValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Every top-level field whose value differs between `original` (the
 * server-loaded snapshot) and `draft` (the current in-progress value) -
 * drives `EntryPreviewDialog.tsx`. Compares by `JSON.stringify`, same
 * technique `ContentEntryEditor.tsx`'s whole-object `isDirty` already uses,
 * just applied per field instead of to the whole value. Only walks top-level
 * `nodes` (the same list `renderFieldNodes` iterates) - a change nested
 * inside a `component-repeat` item surfaces as that item's own top-level
 * field having changed, not expanded further.
 */
export function diffEntryValue(
  original: EntryValue,
  draft: EntryValue,
  nodes: EntryFieldNode[],
): EntryFieldDiff[] {
  const diffs: EntryFieldDiff[] = [];
  for (const node of nodes) {
    const before = original[node.fieldName];
    const after = draft[node.fieldName];
    if (JSON.stringify(before) === JSON.stringify(after)) continue;
    diffs.push({ fieldName: node.fieldName, label: node.label, before, after });
  }
  return diffs;
}
