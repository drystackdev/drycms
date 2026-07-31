import type { EntryValue } from "../../content-types/engine/entry-codec.js";

/** True for a segment that's an array index (`"0"`, `"12"`) - field names are
 * always `/^[a-z][a-z0-9]*$/i` (`content-types/naming.ts`), so they can never
 * start with a digit, making this unambiguous against a real field-name
 * segment without needing to know the schema at all. */
function isArrayIndex(segment: string): boolean {
  return /^\d+$/.test(segment) && Number.isInteger(Number(segment));
}

/**
 * Immutably writes `newValue` at a dotted/indexed path into an entry's
 * `EntryValue` - `"title"` behaves exactly like the plain top-level
 * `{ ...value, title: newValue }` spread `ContentEntryEditor.tsx` used to do
 * inline, `"data.0.name.label"` reaches through a `component-repeat` field
 * (`data`, an array), into its first item, into a nested `flatten` field
 * (`name`), down to a leaf (`label`) - see `entry-tree.ts`'s
 * `EntryComponentRepeatNode`/`EntryFlattenNode` for the shapes this walks.
 *
 * Every object/array actually touched along the way is copied rather than
 * mutated (same "always a new container at every changed level" convention
 * `FieldRenderer.tsx`'s own `flatten`/`ComponentField`'s `onReorder` already
 * follow), so a caller diffing `value` by reference still sees a change only
 * where one actually happened.
 *
 * An invalid path (an out-of-bounds array index, indexing into something
 * that isn't an object/array, an empty segment) warns and returns `value`
 * unchanged rather than throwing - same "external caller's own
 * responsibility, degrade safely" spirit `field-events.ts`'s own
 * `listenForFieldSet` doc comment already sets for a bad `dry:field-set`. */
export function setValueAtPath(value: EntryValue, path: string, newValue: unknown): EntryValue {
  const segments = path.split(".");
  if (segments.some((segment) => segment.length === 0)) {
    console.warn(`[drycms] Invalid field-set path "${path}" - empty segment.`);
    return value;
  }
  const result = setAtSegments(value, segments, newValue, path);
  return result === INVALID ? value : (result as EntryValue);
}

const INVALID = Symbol("invalid field-set path");

function setAtSegments(
  container: unknown,
  segments: string[],
  newValue: unknown,
  fullPath: string,
): unknown {
  const [segment, ...rest] = segments;
  if (segment === undefined) return newValue;

  if (isArrayIndex(segment)) {
    if (!Array.isArray(container)) {
      console.warn(`[drycms] Invalid field-set path "${fullPath}" - "${segment}" indexes into a non-array.`);
      return INVALID;
    }
    const index = Number(segment);
    if (index < 0 || index >= container.length) {
      console.warn(`[drycms] Invalid field-set path "${fullPath}" - index ${index} out of bounds (length ${container.length}).`);
      return INVALID;
    }
    const child = setAtSegments(container[index], rest, newValue, fullPath);
    if (child === INVALID) return INVALID;
    const next = container.slice();
    next[index] = child;
    return next;
  }

  if (container === null || typeof container !== "object" || Array.isArray(container)) {
    console.warn(`[drycms] Invalid field-set path "${fullPath}" - "${segment}" indexes into a non-object.`);
    return INVALID;
  }
  const record = container as Record<string, unknown>;
  const child = setAtSegments(record[segment], rest, newValue, fullPath);
  if (child === INVALID) return INVALID;
  return { ...record, [segment]: child };
}
