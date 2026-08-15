import { boxString, encodeRef, MARKER_ATTR, refOf, REF_SYMBOL, type DryRef } from "./dry-vei-ref.js";
import { buildEntryFieldTree, type EntryFieldNode } from "./engine/entry-tree.js";
import type { ContentTypeDefinition } from "./types.js";

/**
 * Visual Editing Interface core (see `plans/vei.md`) - the isomorphic half:
 * what a rendered value's provenance IS, how it travels with the value, and
 * how it serializes into an HTML attribute. Deliberately free of `preact`
 * (the vnode hook that reads these lives in `server/app-router/`) and of
 * anything Node-only, so the same module serves SSR, the browser overlay,
 * and unit tests.
 */

export { MARKER_ATTR, boxString, decodeRef, decodeRefs, encodeRef, encodeRefs, refOf, unbox } from "./dry-vei-ref.js";
export type { DryRef } from "./dry-vei-ref.js";

interface FieldTypeIndex {
  /** Path -> field type, with every repeatable index normalized to `*`
   * (`blocks.*.title`) so one entry covers every item. */
  byPath: Map<string, string>;
}

const fieldTypeCache = new Map<string, FieldTypeIndex>();

function indexNodes(nodes: EntryFieldNode[], prefix: string, out: Map<string, string>): void {
  for (const node of nodes) {
    const path = prefix + node.fieldName;
    if (node.kind === "column") {
      out.set(path, node.fieldType);
    } else if (node.kind === "flatten") {
      indexNodes(node.children, `${path}.`, out);
    } else if (node.kind === "component-repeat") {
      out.set(path, "component");
      indexNodes(node.itemFields, `${path}.*.`, out);
    } else {
      out.set(path, node.kind === "relation" ? "relation" : "relationmirror");
    }
  }
}

/** Keyed by id+version so a schema edit invalidates it without anyone
 * having to remember to clear this - `version` already increments on every
 * successful schema save (see `docs/CODING-PRINCIPLES.md`). */
export function fieldTypeIndex(type: ContentTypeDefinition, allTypes: ContentTypeDefinition[]): FieldTypeIndex {
  const key = `${type.id}@${type.version}`;
  const cached = fieldTypeCache.get(key);
  if (cached) return cached;
  const byPath = new Map<string, string>();
  indexNodes(buildEntryFieldTree(type, allTypes), "", byPath);
  const index = { byPath };
  fieldTypeCache.set(key, index);
  return index;
}

export function normalizePath(path: string): string {
  return path
    .split(".")
    .map((segment) => (/^\d+$/.test(segment) ? "*" : segment))
    .join(".");
}

export function fieldTypeAt(type: ContentTypeDefinition, allTypes: ContentTypeDefinition[], path: string): string | null {
  return fieldTypeIndex(type, allTypes).byPath.get(normalizePath(path)) ?? null;
}

export interface DryRefTarget {
  kind: DryRef["kind"];
  type: ContentTypeDefinition;
  allTypes: ContentTypeDefinition[];
  id: number;
}

/**
 * The `$` on every record `dry()` returns - `post.$.title`,
 * `post.$.hero.name`, `post.$.blocks[2].title` all produce a `DryRef`
 * without the value itself needing to be boxed, which is what makes the
 * explicit layer work where the automatic one can't: an empty field (there
 * is no `null` to box), a value that went through a formatter, or a
 * non-string field type. Property access just accumulates path segments;
 * the ref is materialized lazily when `refOf` reads it.
 */
export function createRefProxy(target: DryRefTarget, segments: string[] = []): Record<string, unknown> {
  const resolve = (): DryRef | null => {
    if (segments.length === 0) return null;
    const path = segments.join(".");
    const fieldType = fieldTypeAt(target.type, target.allTypes, path);
    if (!fieldType) {
      console.warn(`[drycms] $ ref "${path}" - "${target.type.name}" has no such field.`);
      return null;
    }
    return { kind: target.kind, type: target.type.name, id: target.id, path, fieldType };
  };
  return new Proxy(Object.create(null) as Record<string, unknown>, {
    get(_object, property) {
      if (property === REF_SYMBOL) return resolve();
      if (typeof property === "symbol") return undefined;
      return createRefProxy(target, [...segments, property]);
    },
  });
}

/**
 * The shape of a record's `$`: every field reachable as a `DryRef`, nesting
 * into components and indexing into repeatable ones, mirroring the record's
 * own type so `post.$.hero.name` type-checks exactly when `post.hero.name`
 * does. `Date` is a leaf despite being an object; an array of objects is
 * indexable, an array of primitives (a multi-select, a relation's raw ids)
 * is a leaf.
 */
export type DryRefs<T> = {
  [K in keyof T]-?: NonNullable<T[K]> extends readonly (infer Item)[]
    ? Item extends object
      ? Record<number, DryRefs<Item>>
      : DryRef
    : NonNullable<T[K]> extends Date
      ? DryRef
      : NonNullable<T[K]> extends object
        ? DryRefs<NonNullable<T[K]>>
        : DryRef;
};

/** What `dry()` hands back once the Visual Editing Interface exists: the
 * row, plus a `$` that names where each of its fields came from. `$` is
 * non-enumerable, so it never reaches `JSON.stringify` (and therefore never
 * the replay log or the page's HTML). */
export type DryEntry<T> = T & { $: DryRefs<T> };

/** Attaches `$` in place. Non-enumerable both to keep it out of JSON and so
 * spreading a record (`{...post}`) doesn't carry a `$` whose refs point at
 * the ORIGINAL row. */
export function attachRefs<T extends object>(record: T, target: DryRefTarget): DryEntry<T> {
  Object.defineProperty(record, "$", { value: createRefProxy(target), enumerable: false, configurable: true });
  return record as DryEntry<T>;
}

/**
 * A `$` that resolves to nothing, for the browser: hydration replays
 * already-fetched JSON (`dry-reader-client.ts`) with no schema to resolve
 * paths against, but page code still evaluates `post.$.hero.name` on its
 * way to `dryBind`. Returning a proxy that swallows any property access and
 * yields a null ref keeps that code from throwing, and `dryBind` then emits
 * no attribute - which is correct: the server already put the real one in
 * the HTML, and Preact's hydration doesn't rewrite attributes on existing
 * DOM.
 */
export function createInertRefProxy(): Record<string, unknown> {
  const proxy: Record<string, unknown> = new Proxy(Object.create(null) as Record<string, unknown>, {
    get(_object, property) {
      if (property === REF_SYMBOL) return null;
      if (typeof property === "symbol") return undefined;
      return proxy;
    },
  });
  return proxy;
}

/** Field types whose value is a string a page renders as-is, and that the
 * entry editor can edit as one. `number`/`boolean`/`date` are deliberately
 * absent: boxing them would change what the page's own JavaScript sees
 * (`new Boolean(false)` and `new Number(0)` are both truthy, flipping every
 * `{post.featured && ...}` on the site), and they're reachable through `$`
 * instead. `password`/`secretkey` are absent because they must never be
 * offered for inline editing at all. */
const BOXABLE_FIELD_TYPES = new Set(["text", "richtext", "select", "image"]);

function boxDeep(value: unknown, path: string, target: DryRefTarget): unknown {
  // Route changes can send a record through VEI marking more than once.
  // A boxed value is a `String` object with read-only character indices;
  // recursing into it as a generic object would try to assign index 0.
  // Re-box from the primitive so the ref is also correct for this path.
  if (typeof value === "string" || value instanceof String) {
    const text = value instanceof String ? value.valueOf() : value;
    const fieldType = fieldTypeAt(target.type, target.allTypes, path);
    if (!fieldType || !BOXABLE_FIELD_TYPES.has(fieldType)) return text;
    return boxString(text, { kind: target.kind, type: target.type.name, id: target.id, path, fieldType });
  }
  if (Array.isArray(value)) return value.map((item, index) => boxDeep(item, `${path}.${index}`, target));
  if (value !== null && typeof value === "object" && !(value instanceof Date)) {
    for (const [key, nested] of Object.entries(value)) {
      (value as Record<string, unknown>)[key] = boxDeep(nested, `${path}.${key}`, target);
    }
  }
  return value;
}

/**
 * Replaces every editable string in `record` with one that remembers where
 * it came from, walking into components and repeatable items so
 * `{blog.hero.name}` and `{blog.blocks[2].title}` mark themselves exactly
 * like a top-level field does.
 *
 * `id` is skipped unconditionally: it's the one field page code routinely
 * puts back into a query (`where: [{ field: "category", value: category.id }]`),
 * where a `String`/`Number` object reaches a SQL bind and throws. It's a
 * number today, so the type check below already excludes it - the explicit
 * skip is there so that stays true if an id ever becomes a string.
 *
 * `skipKeys` names top-level fields that must NOT be boxed even though their
 * type says they're editable - `dry-reader.ts`'s `select` transforms
 * (`{ excerpt: (v) => v.slice(0, 120) }`) put a DERIVED value under a real
 * field's name, and boxing that would offer the truncated text for inline
 * editing while the entry editor holds the full one. `$` still resolves for
 * those fields (path-based, unaffected), so a page that genuinely wants the
 * marker can still `dryBind(post.$.excerpt)` deliberately.
 */
export function boxRecordStrings(
  record: Record<string, unknown>,
  target: DryRefTarget,
  skipKeys?: ReadonlySet<string>,
): Record<string, unknown> {
  for (const [key, value] of Object.entries(record)) {
    if (key === "id" || skipKeys?.has(key)) continue;
    record[key] = boxDeep(value, key, target);
  }
  return record;
}

/**
 * Spread onto any element to mark it by hand:
 * `<h1 {...dryBind(post.$.title)}>{formatDate(post.date)}</h1>`, or
 * `<img {...dryBind(post.$.hero, "src")} src={imageUrl(post.hero)} />`.
 * Accepts either a `$` ref or an already-boxed value, so it works the same
 * whether the automatic layer reached the value or not. An unresolvable ref
 * yields no attribute at all rather than a broken one.
 */
export function dryBind(value: unknown, attribute?: string): Record<string, string> {
  const ref = refOf(value);
  if (!ref) return {};
  return { [attribute ? `${MARKER_ATTR}-${attribute}` : MARKER_ATTR]: encodeRef(ref) };
}
