import { decodeRefs, type DryRef } from "../content-types/dry-vei-ref.js";
import { encodeEntryId } from "../lib/id-hash.js";
import { resolveImageSrc } from "../storage/http-source.js";

/**
 * `PageBuilder.tsx`'s VEI mode live-preview patch - the "Preview = patch DOM
 * trực tiếp" half of `plans/new-ui-page-builder.md` mục 8, adapted from
 * `apps/vei/overlay.ts`'s own `applyPreview` to take an explicit `Document`
 * instead of always reading the global `document`: the public site's
 * overlay patches the page it's INJECTED INTO, while Page Builder patches a
 * SEPARATE preview iframe's `contentDocument` from its own parent document -
 * same marker-matching logic either way, just parameterized on which
 * document owns the marked elements.
 */

/** Walks `value` down the part of `ref.path` below `fromField` - the field
 * editor reports a change per TOP-LEVEL field, so a change to `hero.name`
 * arrives as the whole `hero` object and the rest of the path is resolved
 * here, same as `overlay.ts`'s own `valueAtPath`. */
function valueAtPath(value: unknown, path: string, fromField: string): unknown {
  const segments = path.split(".");
  if (segments[0] !== fromField) return undefined;
  let current = value;
  for (const segment of segments.slice(1)) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/** Same translation `overlay.ts`'s own `attributeValue` does - only `image`
 * needs it, since it stores a bare storage id the page resolved through
 * `resolveImageSrc` at render time. */
function attributeValue(ref: DryRef, value: unknown, basePath: string): string {
  const text = value === null ? "" : String(value);
  if (ref.fieldType !== "image" || text === "") return text;
  return resolveImageSrc(text, basePath);
}

export interface PreviewPatchDetail {
  name: string;
  value: unknown;
  typeSlug: string;
  entryId: string | null;
}

/** Applies one in-flight field edit straight to `doc`'s marked elements - no
 * rebuild. Cheap because the markers already say which node owns which
 * field; the cost (and the DOM/vnode divergence it causes) is accepted the
 * same way `overlay.ts`'s own doc comment accepts it for the public site. */
export function applyPreviewPatch(doc: Document, detail: PreviewPatchDetail, basePath: string): void {
  for (const node of doc.querySelectorAll("*")) {
    for (const attribute of node.getAttributeNames()) {
      if (attribute !== "data-dry" && !attribute.startsWith("data-dry-")) continue;
      for (const ref of decodeRefs(node.getAttribute(attribute))) {
        if (ref.type !== detail.typeSlug) continue;
        // `detail.entryId` is the admin's OBFUSCATED id (`encodeEntryId`,
        // what a `?_field=`/editor URL carries) - `ref.id` is the real
        // numeric row id embedded in the marker, so the two only compare
        // after encoding one to match the other, same as `overlay.ts`'s own
        // `applyPreview`.
        if (detail.entryId !== null && encodeEntryId(ref.id) !== detail.entryId) continue;
        const next = valueAtPath(detail.value, ref.path, detail.name);
        if (next === undefined) continue;
        const target = attribute.slice("data-dry-".length);
        if (attribute === "data-dry") node.textContent = String(next);
        else if (target === "html") node.innerHTML = String(next);
        else node.setAttribute(target, attributeValue(ref, next, basePath));
      }
    }
  }
}
