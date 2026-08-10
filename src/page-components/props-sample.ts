import type { PropsField, PropsSchema, PropsTypeNode } from "../components/Editer/worker-protocol.js";

/**
 * Turns a `PropsSchema` (the real TS types of a component's default export,
 * described in `ts-worker.ts`) into the SOURCE of a props object literal -
 * what the Page Editor's component preview passes to a component that
 * doesn't export its own `_preview` (`plans/component.md` mục 5).
 *
 * Source text, not a JSON value, for two reasons: a prop can legitimately be
 * a function (`onClick`), which has no JSON form; and the result is spliced
 * straight into the synthetic preview module (`component-preview.ts`), which
 * is compiled, not `JSON.parse`d. Everything here is pure and deterministic -
 * no `Date.now()`, no randomness - so a preview doesn't churn between
 * rebuilds and the samples can be asserted in tests.
 */

/** Fixed, NOT "today" - see this module's doc comment on determinism. */
const SAMPLE_DATE = "2026-01-01";
const SAMPLE_YEAR = 2026;
const SAMPLE_SENTENCE = "Lorem ipsum dolor sit amet, consectetur adipiscing elit.";
const SAMPLE_NODE_TEXT = "Sample content";

/** Inline SVG (no network request, works offline and inside the preview
 * iframe's own origin-less `srcdoc` document). `#` is percent-encoded - an
 * unescaped one would truncate the URI at the fragment. */
const PLACEHOLDER_IMAGE =
  "data:image/svg+xml;utf8," +
  "<svg xmlns='http://www.w3.org/2000/svg' width='640' height='360'>" +
  "<rect width='100%25' height='100%25' fill='%23e2e8f0'/>" +
  "<text x='50%25' y='50%25' fill='%2364748b' font-family='sans-serif' font-size='24' " +
  "text-anchor='middle' dominant-baseline='middle'>640 x 360</text></svg>";

const LINK_RE = /^(href|url|link|to)$|(href|url|link)$/i;
const IMAGE_RE = /(^|[a-z])(src|image|img|avatar|photo|icon|logo|thumbnail|banner|cover)($|[A-Z])/i;
const PROSE_RE = /(description|subtitle|excerpt|summary|content|text|body|caption|message)/i;
const DATE_RE = /(date|time|published|created|updated)/i;
const COUNT_RE = /(count|total|quantity|qty|index|size|length|items|columns|rows)/i;
const MONEY_RE = /(price|amount|cost|fee|salary|budget)/i;
const YEAR_RE = /year/i;
/** Names where `true` is the interesting sample - a `show`/`isFeatured` prop
 * left `false` commonly renders nothing at all, which reads as a broken
 * preview rather than a deliberate default. */
const TRUTHY_RE = /^(is|has|show|with|can|should|enable|allow)|^(visible|active|open|selected|checked|featured|primary)$/i;

/** `"heroTitle"` -> `"Hero Title"` - the fallback sample for any string prop
 * with no more specific heuristic, so a preview labels itself with the prop
 * it came from instead of repeating one generic phrase everywhere. */
export function humanizeFieldName(name: string): string {
  return name
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/(^|\s)\w/g, (match) => match.toUpperCase());
}

function sampleString(name: string): string {
  if (LINK_RE.test(name)) return "#";
  if (IMAGE_RE.test(name)) return PLACEHOLDER_IMAGE;
  if (DATE_RE.test(name)) return SAMPLE_DATE;
  if (PROSE_RE.test(name)) return SAMPLE_SENTENCE;
  return humanizeFieldName(name);
}

function sampleNumber(name: string): number {
  if (YEAR_RE.test(name)) return SAMPLE_YEAR;
  if (COUNT_RE.test(name)) return 3;
  if (MONEY_RE.test(name)) return 99;
  return 42;
}

/** Singular-ish name for an array's elements, so `items: { label }[]` samples
 * its `label` from "Item" rather than from "Items". */
function elementName(name: string): string {
  return /s$/i.test(name) && !/ss$/i.test(name) ? name.slice(0, -1) : name;
}

const ARRAY_SAMPLE_LENGTH = 3;

/** `null` = no sensible sample (the walker couldn't reduce this type) - the
 * caller omits the prop entirely rather than passing `undefined`, which would
 * override a component's own default parameter value. */
export function sampleValueSource(type: PropsTypeNode, name: string): string | null {
  switch (type.kind) {
    case "string":
      return JSON.stringify(sampleString(name));
    case "number":
      return String(sampleNumber(name));
    case "boolean":
      return TRUTHY_RE.test(name) ? "true" : "false";
    case "literal":
      return JSON.stringify(type.value);
    case "node":
      return JSON.stringify(SAMPLE_NODE_TEXT);
    case "function":
      return "() => {}";
    case "union": {
      for (const option of type.options) {
        const sample = sampleValueSource(option, name);
        if (sample !== null) return sample;
      }
      return null;
    }
    case "array": {
      const element = sampleValueSource(type.element, elementName(name));
      if (element === null) return "[]";
      return `[${Array.from({ length: ARRAY_SAMPLE_LENGTH }, () => element).join(", ")}]`;
    }
    case "object":
      return objectSource(type.fields);
    case "unknown":
      return null;
  }
}

function objectSource(fields: PropsField[]): string {
  const entries: string[] = [];
  for (const field of fields) {
    const value = sampleValueSource(field.type, field.name);
    if (value === null) continue;
    entries.push(`${isSafeIdentifier(field.name) ? field.name : JSON.stringify(field.name)}: ${value}`);
  }
  return entries.length === 0 ? "{}" : `{ ${entries.join(", ")} }`;
}

function isSafeIdentifier(name: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name);
}

/**
 * The whole props object's source. Optional props are sampled too (a
 * component whose props are ALL optional would otherwise preview with
 * nothing set, which is exactly the case where seeing sample content helps
 * most); a component that genuinely wants its own defaults shown can export
 * `_preview` instead, which always wins (`component-preview.ts`).
 */
export function samplePropsSource(schema: PropsSchema | null | undefined): string {
  if (!schema) return "{}";
  return objectSource(schema.fields);
}
