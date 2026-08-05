import type { ContentTypeDefinition } from "./types.js";

/** Shape of the `seo` component's flattened fields (see `seed.ts`) as it
 * comes back nested on an entry via `features.seo` - `metaTitle`/
 * `description`/`image` match `Seo` in the generated `.d.ts` (`codegen.ts`). */
export interface DrySeoValue {
  metaTitle?: string;
  description?: string;
  image?: string;
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
}

/** Which `DrySeoLayers` slot a `get()` result for `type` belongs in, or
 * `null` if `type` doesn't carry SEO at all (`features.seo` off). A
 * `singleton` with `features.seoDefault` is the one site-wide fallback
 * source (`default`); every other SEO-enabled `singleton` is a page's own
 * override (`singleton`); a `collection` entry's own SEO is the highest
 * priority (`entry`). */
export function seoTierFor(type: ContentTypeDefinition): keyof DrySeoLayers | null {
  if (!type.features?.seo) return null;
  if (type.kind === "collection") return "entry";
  if (type.kind === "singleton") return type.features.seoDefault ? "default" : "singleton";
  return null;
}

const SEO_KEYS = ["metaTitle", "description", "image"] as const;

/** An unset `seo` component field round-trips as an explicit `null` (see
 * `entry-codec.ts`'s `rowToValue`), not an absent key - a blind object
 * spread would let a layer's untouched `null` fields blank out a lower
 * layer's real values. Only a non-empty string counts as "this layer set
 * it". */
function applyLayer(base: DrySeoValue, layer: DrySeoValue | undefined): DrySeoValue {
  if (!layer) return base;
  const result = { ...base };
  for (const key of SEO_KEYS) {
    const value = layer[key];
    if (typeof value === "string" && value.length > 0) result[key] = value;
  }
  return result;
}

/** Applies the fixed Default < Singleton < Entry priority, once, at read
 * time - each slot in `layers` was filled independently (see
 * `dry-reader.ts`) regardless of call order, so priority only exists here. */
export function mergeSeoLayers(layers: DrySeoLayers | undefined): DrySeoValue {
  return applyLayer(applyLayer(applyLayer({}, layers?.default), layers?.singleton), layers?.entry);
}
