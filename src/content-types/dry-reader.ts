import { getDryContext, type DryRequestContext } from "./dry-context.js";
import { markRecord, populateRelations, toRecord, isPublished } from "./dry-populate.js";
import type { DryEntry } from "./dry-vei.js";
import { seoTierFor, type DrySeoValue } from "./dry-seo.js";
import type { EntryWhere } from "./engine/entry-where.js";
import type { ContentTypeDefinition, ContentTypeKind } from "./types.js";

export interface DryListOptions<T> {
  where?: EntryWhere;
  sort?: { field: keyof T & string; dir?: "asc" | "desc" };
  page?: number;
  pageSize?: number;
  /** @default false - matches every other read here: safe-by-default for a
   * public page, never showing a draft/future-scheduled row unless asked.
   * `get()` has no equivalent override - see its own doc comment. */
  includeDraft?: boolean;
  /** Force-include a field `list()` would otherwise leave out of its SELECT
   * (currently only non-inline `richtext` fields - see `entry-tree.ts`'s
   * `listSelectColumnNames`). A listing page rarely needs a post's full
   * authored HTML body, only `get()`'s single row does, so `list()` skips
   * that column by default to avoid pulling it across every row; a row
   * without it comes back with that field `null`, not the real HTML. Pass
   * the field name here on the rare page that genuinely renders full content
   * from a `list()` call. `get()` never needs this - it always fetches every
   * column. */
  include?: (keyof T & string)[];
}

/** Which relation/relationmirror fields to resolve from a raw id/id array
 * into the target collection's full published row, instead of leaving them
 * as-is - see `dry-populate.ts`. `R` is the type's generated `<Type>Relations`
 * interface (`codegen.ts`), so only a field that's actually a relation on
 * this type type-checks here. Each entry costs one extra query (N+1, run in
 * parallel across fields and across a single multi-valued field's own ids),
 * never a real SQL join - `plans/reader.md`'s deferred `populate` option. */
export interface DryGetOptions<K> {
  populate: K[];
}

export interface DryCollectionReader<T, R extends Record<string, unknown> = Record<string, unknown>> {
  /** `number` looks up by id; `string` by `features.slug` (throws if the
   * collection has no `slug` feature - there's nothing to look up by).
   * Always published-only (no override) - a page that genuinely needs to
   * preview a draft is a future, session-gated feature (`plans/reader.md`'s
   * deferred Phase 4), not something a build-time reader should make easy to
   * reach for by accident. */
  get(idOrSlug: number | string): Promise<DryEntry<T> | null>;
  get<K extends keyof R & string>(idOrSlug: number | string, options: DryGetOptions<K>): Promise<DryEntry<Omit<T, K> & Pick<R, K>> | null>;
  list(options?: DryListOptions<T>): Promise<{ rows: DryEntry<T>[]; total: number }>;
}

export interface DrySingletonReader<T, R extends Record<string, unknown> = Record<string, unknown>> {
  get(): Promise<DryEntry<T> | null>;
  get<K extends keyof R & string>(options: DryGetOptions<K>): Promise<DryEntry<Omit<T, K> & Pick<R, K>> | null>;
}

/** Generic over the project's OWN generated name->interface maps
 * (`DryCollectionMap`/`DrySingletonMap`, and their `populate`-typing
 * counterparts `DryCollectionRelationsMap`/`DrySingletonRelationsMap`, all
 * in the codegen'd `.d.ts` - see `codegen.ts`) so this module carries zero
 * project-specific knowledge; the generated file just re-exports these
 * shapes applied to its own maps. */
export interface DryReader<
  CMap extends Record<string, unknown> = Record<string, unknown>,
  SMap extends Record<string, unknown> = Record<string, unknown>,
  CRMap extends { [K in keyof CMap]: Record<string, unknown> } = { [K in keyof CMap]: Record<string, unknown> },
  SRMap extends { [K in keyof SMap]: Record<string, unknown> } = { [K in keyof SMap]: Record<string, unknown> },
> {
  collection<K extends keyof CMap & string>(name: K): DryCollectionReader<CMap[K], CRMap[K]>;
  singleton<K extends keyof SMap & string>(name: K): DrySingletonReader<SMap[K], SRMap[K]>;
}

function mustFindType(allTypes: ContentTypeDefinition[], name: string, kind: ContentTypeKind): ContentTypeDefinition {
  const type = allTypes.find((t) => t.name === name);
  if (!type) {
    throw new Error(`[drycms] dry().${kind}("${name}") - no content type named "${name}" exists.`);
  }
  if (type.kind !== kind) {
    throw new Error(`[drycms] dry().${kind}("${name}") - "${name}" is a ${type.kind}, not a ${kind}.`);
  }
  return type;
}

/** Records `result`'s `seo` field (if it has one) into `context.seo`'s
 * matching tier - a side effect of `get()`, not something callers ask for
 * explicitly, so a page's own `dry().singleton(x).get()`/
 * `dry().collection(x).get()` call for its own data automatically feeds the
 * SEO cascade (`plans/reader.md`'s "tự động đọc" requirement) with no extra
 * code in `page.tsx`. Not called from `list()` - a listing row isn't "the
 * page's own" entity. */
function recordSeoLayer(context: DryRequestContext, type: ContentTypeDefinition, result: Record<string, unknown> | null): void {
  const tier = seoTierFor(type);
  if (!tier || !context.seo || !result) return;
  const seo = result.seo;
  if (seo && typeof seo === "object") context.seo[tier] = seo as DrySeoValue;
  // JSON-LD `Article.datePublished`/`dateModified` (`render.ts`'s
  // `buildStructuredData`) - only ever off the highest-priority `entry`
  // tier's own real timestamp columns, never fabricated for a type that
  // doesn't have `features.timestamps` on. `createdAt`/`updatedAt` come back
  // as real `Date` instances (`field-registry.ts`'s `dateFieldType.
  // deserialize`), not strings - converted to ISO here since that's the only
  // shape `seoEntryDates` needs to carry.
  if (tier === "entry" && type.features?.timestamps) {
    context.seoEntryDates = {
      createdAt: result.createdAt instanceof Date ? result.createdAt.toISOString() : undefined,
      updatedAt: result.updatedAt instanceof Date ? result.updatedAt.toISOString() : undefined,
    };
  }
}

async function getCollectionEntry(
  context: DryRequestContext,
  type: ContentTypeDefinition,
  idOrSlug: number | string,
  populate: readonly string[] | undefined,
): Promise<Record<string, unknown> | null> {
  const { entries, allTypes } = context;
  let result: Record<string, unknown> | null;
  if (typeof idOrSlug === "number") {
    const row = await entries.getEntry(type, allTypes, idOrSlug);
    result = row && isPublished(row.value) ? markRecord(context, type, toRecord(row)) : null;
  } else {
    const row = await entries.findEntry(type, allTypes, [{ field: "slug", op: "eq", value: idOrSlug }], { publishedOnly: true });
    result = row ? markRecord(context, type, toRecord(row)) : null;
  }
  if (result && populate && populate.length > 0) {
    await populateRelations(context, type, allTypes, result, populate);
  }
  return result;
}

function createCollectionReader(name: string): DryCollectionReader<Record<string, unknown>> {
  return {
    async get(idOrSlug: number | string, options?: DryGetOptions<string>) {
      const context = getDryContext();
      const type = mustFindType(context.allTypes, name, "collection");
      context.touchedTypes?.add(type.name);
      const result = await getCollectionEntry(context, type, idOrSlug, options?.populate);
      recordSeoLayer(context, type, result);
      context.callLog?.push({ kind: "collection", name, method: "get", result });
      return result;
    },
    async list(options = {}) {
      const context = getDryContext();
      const { entries, allTypes } = context;
      const type = mustFindType(allTypes, name, "collection");
      context.touchedTypes?.add(type.name);
      const page = await entries.listEntries(type, allTypes, {
        page: options.page ?? 0,
        pageSize: options.pageSize ?? 100,
        sortField: options.sort?.field,
        sortDir: options.sort?.dir,
        where: options.where,
        publishedOnly: !options.includeDraft,
        include: options.include,
      });
      const result = { rows: page.rows.map((row) => markRecord(context, type, toRecord(row))), total: page.total };
      context.callLog?.push({ kind: "collection", name, method: "list", result });
      return result;
    },
  } as DryCollectionReader<Record<string, unknown>>;
}

function createSingletonReader(name: string): DrySingletonReader<Record<string, unknown>> {
  return {
    async get(options?: DryGetOptions<string>) {
      const context = getDryContext();
      const { entries, allTypes } = context;
      const type = mustFindType(allTypes, name, "singleton");
      context.touchedTypes?.add(type.name);
      const row = await entries.getSingletonEntry(type, allTypes);
      const result = row ? markRecord(context, type, toRecord(row)) : null;
      if (result && options?.populate && options.populate.length > 0) {
        await populateRelations(context, type, allTypes, result, options.populate);
      }
      recordSeoLayer(context, type, result);
      context.callLog?.push({ kind: "singleton", name, method: "get", result });
      return result;
    },
  } as DrySingletonReader<Record<string, unknown>>;
}

/** The reader itself - see `plans/reader.md`. Untyped (`Record<string,
 * unknown>` under the hood); the project's generated `.d.ts` is what makes
 * `dry()` (declared there as a `DryReader<DryCollectionMap, DrySingletonMap,
 * DryCollectionRelationsMap, DrySingletonRelationsMap>` global) type-safe
 * for real callers. */
export function dry(): DryReader {
  return {
    collection: (name) => createCollectionReader(name),
    singleton: (name) => createSingletonReader(name),
  };
}
