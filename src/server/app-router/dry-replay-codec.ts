import type { DryCallLogEntry } from "../../content-types/dry-context.js";

/** Marker shape for a `Date` that survived the JSON round-trip - the `date`
 * field type deserializes to a real `Date` INSTANCE (`field-registry.ts`'s
 * `dateFieldType.deserialize`), and `dry()` callers may rely on that (e.g.
 * calling `.toLocaleDateString()`) - a plain ISO string after `JSON.parse`
 * wouldn't have those methods, breaking client replay in a way that only
 * shows up once someone's `page.tsx` touches a date field. */
interface EncodedDate {
  __drycmsDate: string;
}

function isEncodedDate(value: unknown): value is EncodedDate {
  return typeof value === "object" && value !== null && "__drycmsDate" in value;
}

/**
 * `log` -> a JSON string safe to embed as the text content of a
 * `<script type="application/json">` tag. Escaping every `<` (not just
 * `</script`) is the standard defense here - collection data can contain
 * arbitrary user-authored text (rich text, any string field), and `<` is
 * the one character that can start `</script>`, `<!--`, or any other
 * HTML-parser-relevant sequence; escaping it as `<` (still valid JSON)
 * neutralizes all of them at once rather than pattern-matching for
 * `</script` specifically.
 */
export function encodeCallLog(log: DryCallLogEntry[]): string {
  const json = JSON.stringify(log, function replacer(key, value) {
    // `this[key]` (the holder's original property) still holds the real
    // `Date` instance here - `JSON.stringify` already called `.toJSON()`
    // on it before invoking this replacer, so `value` itself is already
    // the ISO string by this point and can't be checked directly.
    const original = (this as Record<string, unknown>)[key];
    if (original instanceof Date) return { __drycmsDate: original.toISOString() } satisfies EncodedDate;
    return value;
  });
  return json.replace(/</g, "\\u003c");
}

export function decodeCallLog(text: string): DryCallLogEntry[] {
  return JSON.parse(text, (_key, value) => (isEncodedDate(value) ? new Date(value.__drycmsDate) : value)) as DryCallLogEntry[];
}
