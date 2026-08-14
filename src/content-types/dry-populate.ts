import type { DryRequestContext } from "./dry-context.js";
import { attachRefs, boxRecordStrings, createInertRefProxy } from "./dry-vei.js";
import type { EntryRow } from "./engine/entries-types.js";
import { flipCardinality, type RelationFieldConfig, type RelationMirrorFieldConfig } from "./field-registry.js";
import { activeFields, relationMirrorFieldsFor } from "./system-fields.js";
import type { ContentTypeDefinition, FieldDefinition } from "./types.js";

/** `EntryRow` -> the plain object shape `dry()` hands callers - shared by
 * `dry-reader.ts`'s own `get()`/`list()` and this module's populated-target
 * lookups, so both produce identically-shaped rows. */
export function toRecord(row: EntryRow): Record<string, unknown> {
  return { id: row.id, ...row.value };
}

/**
 * Gives a record its `$` (see `dry-vei.ts`). Everything `dry()` returns
 * funnels through here, INCLUDING a populated relation target - a
 * `category.title` rendered on a blog page belongs to the category, and
 * marking it here is what lets it point at its own entry rather than the
 * page's.
 *
 * `$` is attached UNCONDITIONALLY, resolving to nothing outside an
 * edit-mode render or for a type the viewer can't write. A page that writes
 * `dryBind(post.$.title)` is ordinary page code that runs on every request
 * and during client hydration too - leaving `$` off would make it throw for
 * every anonymous visitor, which is exactly the failure this shape exists
 * to prevent. An inert `$` costs one non-enumerable property.
 *
 * `unboxedKeys` passes straight through to `boxRecordStrings` - see there
 * for why a `select` transform's derived value must not be boxed.
 */
export function markRecord(
  // Narrower than `DryRequestContext` on purpose - `dry-reader-http.ts`'s
  // client-side `HttpDryReaderConfig` carries `vei`/`allTypes` too but isn't
  // (and shouldn't become) a real `DryRequestContext`, so this only asks for
  // the 2 fields actually read below. Every server caller still passes the
  // full context; structurally compatible, no behavior change.
  context: Pick<DryRequestContext, "vei" | "allTypes">,
  type: ContentTypeDefinition,
  record: Record<string, unknown>,
  unboxedKeys?: ReadonlySet<string>,
): Record<string, unknown> {
  const id = record.id;
  if (!context.vei?.canUpdate(type) || typeof id !== "number") {
    Object.defineProperty(record, "$", { value: createInertRefProxy(), enumerable: false, configurable: true });
    return record;
  }
  const target = {
    kind: type.kind === "singleton" ? ("singleton" as const) : ("collection" as const),
    type,
    allTypes: context.allTypes,
    id,
  };
  return attachRefs(boxRecordStrings(record, target, unboxedKeys), target);
}

/** Same "an untouched draft/schedule counts as published" rule `dry-reader.ts`'s
 * `get()` numeric-id branch applies to the page's own entity - reused here so
 * a populated relation target is gated identically, never leaking an
 * unpublished row through a field that happens to be a relation. */
export function isPublished(value: Record<string, unknown>): boolean {
  if (value.draft === true) return false;
  const schedule = value.schedule;
  if (schedule instanceof Date && schedule.getTime() > Date.now()) return false;
  return true;
}

interface PopulateTarget {
  field: FieldDefinition;
  targetType: ContentTypeDefinition;
  /** `true` - this side holds a single, possibly-absent id (a `manyToOne`
   * relation, or a `relationmirror` reversing one) -> populated value is
   * `object | null`. `false` - an id array -> populated value is
   * `object[]`. Matches `codegen.ts`'s `relationsFieldLine` exactly, since
   * that's what typed the field this is resolving. */
  single: boolean;
}

/** Finds what `fieldName` on `type` actually points at - a real `relation`
 * field's own `target`, or a synthetic `relationmirror`'s source relation's
 * owner. Throws rather than returning `null` on a bad name: a typed caller
 * (going through the generated `<Type>Relations` interface) can never hit
 * this, so reaching it means either the untyped internal `dry()` fallback
 * was called directly with a bad string, or the schema changed out from
 * under a stale `populate` list - both are caller/dev bugs worth failing
 * loudly on, same as `dry-reader.ts`'s `mustFindType`. */
function resolvePopulateTarget(type: ContentTypeDefinition, allTypes: ContentTypeDefinition[], fieldName: string): PopulateTarget {
  const relationField = activeFields(type).find((f) => f.name === fieldName && f.type === "relation");
  if (relationField) {
    const config = relationField.config as RelationFieldConfig;
    const targetType = allTypes.find((t) => t.id === config.target);
    if (!targetType) {
      throw new Error(`[drycms] populate("${fieldName}") on "${type.name}" - its relation target collection no longer exists.`);
    }
    return { field: relationField, targetType, single: config.cardinality === "manyToOne" };
  }

  const mirrorField = relationMirrorFieldsFor(type, allTypes).find((f) => f.name === fieldName && f.type === "relationmirror");
  if (mirrorField) {
    const config = mirrorField.config as RelationMirrorFieldConfig;
    const sourceType = allTypes.find((t) => t.id === config.sourceTypeId);
    const sourceField = sourceType?.fields.find((f) => f.id === config.sourceFieldId);
    if (!sourceType || !sourceField || sourceField.type !== "relation") {
      throw new Error(`[drycms] populate("${fieldName}") on "${type.name}" - the relation it mirrors no longer exists.`);
    }
    const reverseCardinality = flipCardinality((sourceField.config as RelationFieldConfig).cardinality);
    return { field: mirrorField, targetType: sourceType, single: reverseCardinality === "manyToOne" };
  }

  throw new Error(`[drycms] populate("${fieldName}") - "${type.name}" has no relation/relationmirror field named "${fieldName}".`);
}

async function fetchPublished(
  context: DryRequestContext,
  targetType: ContentTypeDefinition,
  allTypes: ContentTypeDefinition[],
  id: number,
): Promise<Record<string, unknown> | null> {
  const row = await context.entries.getEntry(targetType, allTypes, id);
  return row && isPublished(row.value) ? markRecord(context, targetType, toRecord(row)) : null;
}

/**
 * Resolves every requested `populate` field on an already-fetched `result`
 * (mutated in place) from a raw id/id array into the target collection's
 * full published row - `dry-reader.ts`'s `get()` calls this after its own
 * lookup, before recording `result` into `callLog`/the SEO cascade, so both
 * see the already-populated shape. One extra `getEntry` per populated id
 * (N+1, run in parallel via `Promise.all` - both across fields and across a
 * single multi-valued field's own ids), never a real SQL join - this is
 * `plans/reader.md`'s deferred `populate` option, implemented at exactly
 * the cost that plan called out.
 */
export async function populateRelations(
  context: DryRequestContext,
  type: ContentTypeDefinition,
  allTypes: ContentTypeDefinition[],
  result: Record<string, unknown>,
  fields: readonly string[],
): Promise<void> {
  await Promise.all(
    fields.map(async (fieldName) => {
      const target = resolvePopulateTarget(type, allTypes, fieldName);
      context.touchedTypes?.add(target.targetType.name);
      if (target.single) {
        const id = result[target.field.name] as number | null | undefined;
        result[target.field.name] = id == null ? null : await fetchPublished(context, target.targetType, allTypes, id);
      } else {
        const ids = (result[target.field.name] as number[] | undefined) ?? [];
        const rows = await Promise.all(ids.map((id) => fetchPublished(context, target.targetType, allTypes, id)));
        result[target.field.name] = rows.filter((r): r is Record<string, unknown> => r !== null);
      }
    }),
  );
}
