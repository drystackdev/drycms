import { SEO_DEFAULTS_TYPE_ID } from "./system-fields.js";
import type { ContentEntryEngineAdapter } from "./engine/entries-types.js";
import type { ContentTypeDefinition } from "./types.js";

/** Shape of the `seo` component's flattened fields (see `seed.ts`) as it
 * comes back nested on an entry via `features.seo` - `metaTitle`/
 * `description`/`image`/`noIndex` match `Seo` in the generated `.d.ts`
 * (`codegen.ts`). */
export interface DrySeoValue {
  metaTitle?: string;
  description?: string;
  image?: string;
  noIndex?: boolean;
}

/** 3 independent slots, one per cascade tier - each `dry()` call that reads
 * a `features.seo` type fills in ITS OWN slot as a side effect (see
 * `dry-reader.ts`), regardless of what order calls happen in during a
 * render. `mergeSeoLayers` is what actually applies the Default < Singleton
 * < Entry priority, once, at the end - not the write side. */
export interface DrySeoLayers {
  default?: DrySeoValue;
  singleton?: DrySeoValue;
  entry?: DrySeoValue;
  /** Set directly by `dry-title.ts`'s `setTitle()`, never by a `dry()` read -
   * the highest-priority layer, above even a collection entry's own
   * `features.seo` field. For a page whose title isn't driven by a content
   * entry at all (a static page, or one that wants to compose the title
   * from data already in hand rather than a dedicated `seo` component
   * field). */
  page?: DrySeoValue;
}

/** Which `DrySeoLayers` slot a `get()` result for `type` belongs in, or
 * `null` if `type` doesn't carry SEO at all (`features.seo` off). The
 * built-in `seoDefaults` singleton (recognized by its fixed
 * `SEO_DEFAULTS_TYPE_ID`, not by name - see `seed.ts`) is the one site-wide
 * fallback source (`default`); every other SEO-enabled `singleton` is a
 * page's own override (`singleton`); a `collection` entry's own SEO is the
 * highest priority (`entry`). */
export function seoTierFor(type: ContentTypeDefinition): keyof DrySeoLayers | null {
  if (!type.features?.seo) return null;
  if (type.kind === "collection") return "entry";
  if (type.kind === "singleton") return type.id === SEO_DEFAULTS_TYPE_ID ? "default" : "singleton";
  return null;
}

const SEO_KEYS = ["metaTitle", "description", "image"] as const;
const SEO_BOOLEAN_KEYS = ["noIndex"] as const;

/** An unset `seo` component field round-trips as an explicit `null` (see
 * `entry-codec.ts`'s `rowToValue`), not an absent key - a blind object
 * spread would let a layer's untouched `null` fields blank out a lower
 * layer's real values. Only a non-empty string counts as "this layer set
 * it". `noIndex` (a `boolean` field) uses the same "unset round-trips as
 * `null`" fact but a different test - `false` IS a meaningful, explicit
 * value for a boolean (unlike an empty string), so any layer whose value is
 * actually `typeof "boolean"` participates, letting a more specific layer's
 * explicit `false` correctly override a less specific layer's `true` (e.g.
 * a site-wide `seoDefaults.noIndex = true` on a staging deploy, opted back
 * into by one entry explicitly setting it `false`). */
function applyLayer(base: DrySeoValue, layer: DrySeoValue | undefined): DrySeoValue {
  if (!layer) return base;
  const result = { ...base };
  for (const key of SEO_KEYS) {
    const value = layer[key];
    if (typeof value === "string" && value.length > 0) result[key] = value;
  }
  for (const key of SEO_BOOLEAN_KEYS) {
    const value = layer[key];
    if (typeof value === "boolean") result[key] = value;
  }
  return result;
}

/** Applies the fixed Default < Singleton < Entry < Page priority, once, at
 * read time - each slot in `layers` was filled independently (see
 * `dry-reader.ts`/`dry-title.ts`) regardless of call order, so priority
 * only exists here. */
export function mergeSeoLayers(layers: DrySeoLayers | undefined): DrySeoValue {
  return applyLayer(applyLayer(applyLayer(applyLayer({}, layers?.default), layers?.singleton), layers?.entry), layers?.page);
}

/** Looks up the built-in `seoDefaults` singleton (by its fixed
 * `SEO_DEFAULTS_TYPE_ID`, same as `seoTierFor`) and returns its `seo`
 * component value, or `undefined` if the type is missing (shouldn't happen
 * for a real app, but this stays a lookup, not an assert) or has never been
 * saved. Shared by `page-handler.ts` (seeds `dryContext.seo.default` for a
 * normal page render) and `sitemap.ts` (needs the same site-wide value to
 * decide whether the whole sitemap should be empty) - written once here
 * rather than duplicated at both call sites. */
export async function loadSeoDefaults(
  entries: ContentEntryEngineAdapter,
  allTypes: ContentTypeDefinition[],
): Promise<DrySeoValue | undefined> {
  const seoDefaultsType = allTypes.find((t) => t.id === SEO_DEFAULTS_TYPE_ID);
  if (!seoDefaultsType) return undefined;
  const row = await entries.getSingletonEntry(seoDefaultsType, allTypes);
  const value = row?.value.seo;
  return value && typeof value === "object" ? (value as DrySeoValue) : undefined;
}
