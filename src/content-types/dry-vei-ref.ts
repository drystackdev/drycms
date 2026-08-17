/**
 * The Visual Editing Interface's wire format, and nothing else (see
 * `plans/vei.md`). Split out of `dry-vei.ts` deliberately: the browser
 * overlay (`pages/page-components/page-builder/` (Page Builder's preview)) ships on every public page and only needs
 * to READ markers, while `dry-vei.ts` reaches into `entry-tree.ts` ->
 * `field-registry.ts` to resolve field types. Keeping this module
 * import-free is what stops the whole field registry from landing in the
 * public site's bundle.
 */

export interface DryRef {
  kind: "collection" | "singleton";
  /** `ContentTypeDefinition.name`, not its id - what `dry().collection(x)`
   * and the admin's own `/content/:typeSlug` URL both key on. */
  type: string;
  /** Entry row id. Slug is deliberately NOT used even for a collection that
   * has one: a slug can be edited (including by this very feature), while
   * the write API keys on id. */
  id: number;
  /** Dotted path to the leaf, reaching through components and repeatable
   * items exactly like `field-path.ts`'s `setValueAtPath` expects -
   * `"title"`, `"hero.name"`, `"blocks.2.title"`. */
  path: string;
  fieldType: string;
}

/** Marks the element whose TEXT came from a field. An attribute-sourced
 * value is marked `data-dry-<attr>` instead (`data-dry-src`,
 * `data-dry-html`), so one element can carry both without collision. */
export const MARKER_ATTR = "data-dry";

const SEPARATOR = ":";

/**
 * `c:blog:12:hero.name:text`. Nothing here needs escaping and that is by
 * construction, not luck: `naming.ts` constrains type and field names to
 * `/^[a-z][a-z0-9]*$/i`, an id is a number, and a path adds only `.` and
 * digits - so `:` can never appear inside a component. Chosen over an
 * indirection table (`data-dry="7"` + a JSON registry) because numbering
 * would need per-request state inside a process-global Preact hook, which
 * breaks the moment two renders overlap.
 */
export function encodeRef(ref: DryRef): string {
  return [ref.kind === "collection" ? "c" : "s", ref.type, String(ref.id), ref.path, ref.fieldType].join(SEPARATOR);
}

export function decodeRef(text: string): DryRef | null {
  const parts = text.split(SEPARATOR);
  if (parts.length !== 5) return null;
  const [kind, type, id, path, fieldType] = parts as [string, string, string, string, string];
  if (kind !== "c" && kind !== "s") return null;
  if (!type || !path || !fieldType || !/^\d+$/.test(id)) return null;
  return { kind: kind === "c" ? "collection" : "singleton", type, id: Number(id), path, fieldType };
}

/** One element can source several fields (`<div>{a} - {b}</div>`), so the
 * attribute holds a space-separated list. A malformed entry is skipped
 * rather than failing the whole attribute - the overlay reading this is on
 * the other side of an HTTP round trip from whatever wrote it. */
export function decodeRefs(attribute: string | null | undefined): DryRef[] {
  if (!attribute) return [];
  const refs: DryRef[] = [];
  for (const part of attribute.trim().split(/\s+/)) {
    const ref = decodeRef(part);
    if (ref) refs.push(ref);
  }
  return refs;
}

export function encodeRefs(refs: readonly DryRef[]): string {
  return refs.map(encodeRef).join(" ");
}

/** `Symbol.for`, not a module-local `Symbol()`: the SSR bundle and the
 * client bundle each evaluate their own copy of this module, and a value
 * boxed by one must still be recognizable to the other. */
const REF = Symbol.for("drycms.vei.ref");

/**
 * A string that remembers which field it came from. `new String` rather
 * than a wrapper object so it stays usable everywhere a string was:
 * interpolation, `+`, `renderToString`'s text child handling. The cost is
 * real and bounded - see `plans/vei.md`'s decision #2 for why only strings
 * are ever boxed, and never an `id`.
 */
export function boxString(value: string, ref: DryRef): string {
  const boxed = new String(value);
  Object.defineProperty(boxed, REF, { value: ref, enumerable: false });
  return boxed as unknown as string;
}

export function refOf(value: unknown): DryRef | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" && typeof value !== "function") return null;
  const ref = (value as Record<symbol, unknown>)[REF];
  return ref ? (ref as DryRef) : null;
}

/** Unwraps a boxed string back to a real primitive; returns anything else
 * untouched. The safety net for values that leave the render and reach code
 * that does care about `typeof` - notably a SQL bind in `entry-where.ts`. */
export function unbox<T>(value: T): T {
  return value instanceof String ? (value.valueOf() as unknown as T) : value;
}

/** A `$` proxy resolves through this symbol too, so `refOf` works on both a
 * boxed value and a ref proxy - see `dry-vei.ts`'s `createRefProxy`. */
export const REF_SYMBOL = REF;
