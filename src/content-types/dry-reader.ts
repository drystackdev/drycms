import { getDryContext } from "./dry-context.js";
import type { EntryWhere } from "./engine/entry-where.js";
import type { EntryRow } from "./engine/entries-types.js";
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
}

export interface DryCollectionReader<T> {
  /** `number` looks up by id; `string` by `features.slug` (throws if the
   * collection has no `slug` feature - there's nothing to look up by).
   * Always published-only (no override) - a page that genuinely needs to
   * preview a draft is a future, session-gated feature (`plans/reader.md`'s
   * deferred Phase 4), not something a build-time reader should make easy to
   * reach for by accident. */
  get(idOrSlug: number | string): Promise<T | null>;
  list(options?: DryListOptions<T>): Promise<{ rows: T[]; total: number }>;
}

export interface DrySingletonReader<T> {
  get(): Promise<T | null>;
}

/** Generic over the project's OWN generated name->interface maps
 * (`DryCollectionMap`/`DrySingletonMap` in the codegen'd `.d.ts` - see
 * `codegen.ts`) so this module carries zero project-specific knowledge; the
 * generated file just re-exports these shapes applied to its own maps. */
export interface DryReader<CMap extends Record<string, unknown> = Record<string, unknown>, SMap extends Record<string, unknown> = Record<string, unknown>> {
  collection<K extends keyof CMap & string>(name: K): DryCollectionReader<CMap[K]>;
  singleton<K extends keyof SMap & string>(name: K): DrySingletonReader<SMap[K]>;
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

function toRecord(row: EntryRow): Record<string, unknown> {
  return { id: row.id, ...row.value };
}

/** Client-side mirror of `entry-where.ts`'s `buildPublishedOnlyClause`,
 * applied to a single already-fetched row - needed because `getEntry` (the
 * plain id lookup) has no `publishedOnly` support of its own (unlike
 * `listEntries`/`findEntry`), so a numeric `get()` gates here instead of in
 * SQL. Same "an untouched draft/schedule counts as published" rule. */
function isPublished(value: Record<string, unknown>): boolean {
  if (value.draft === true) return false;
  const schedule = value.schedule;
  if (schedule instanceof Date && schedule.getTime() > Date.now()) return false;
  return true;
}

function createCollectionReader(name: string): DryCollectionReader<Record<string, unknown>> {
  return {
    async get(idOrSlug) {
      const context = getDryContext();
      const { entries, allTypes } = context;
      const type = mustFindType(allTypes, name, "collection");
      context.touchedTypes?.add(type.name);
      let result: Record<string, unknown> | null;
      if (typeof idOrSlug === "number") {
        const row = await entries.getEntry(type, allTypes, idOrSlug);
        result = row && isPublished(row.value) ? toRecord(row) : null;
      } else {
        const row = await entries.findEntry(type, allTypes, [{ field: "slug", op: "eq", value: idOrSlug }], { publishedOnly: true });
        result = row ? toRecord(row) : null;
      }
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
      });
      const result = { rows: page.rows.map(toRecord), total: page.total };
      context.callLog?.push({ kind: "collection", name, method: "list", result });
      return result;
    },
  };
}

function createSingletonReader(name: string): DrySingletonReader<Record<string, unknown>> {
  return {
    async get() {
      const context = getDryContext();
      const { entries, allTypes } = context;
      const type = mustFindType(allTypes, name, "singleton");
      context.touchedTypes?.add(type.name);
      const row = await entries.getSingletonEntry(type, allTypes);
      const result = row ? toRecord(row) : null;
      context.callLog?.push({ kind: "singleton", name, method: "get", result });
      return result;
    },
  };
}

/** The reader itself - see `plans/reader.md`. Untyped (`Record<string,
 * unknown>` under the hood); the project's generated `.d.ts` is what makes
 * `dry()` (declared there as a `DryReader<DryCollectionMap,
 * DrySingletonMap>` global) type-safe for real callers. */
export function dry(): DryReader {
  return {
    collection: (name) => createCollectionReader(name),
    singleton: (name) => createSingletonReader(name),
  };
}
