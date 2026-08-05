# dry() reader: `populate` option for relation fields

## Plan

Add a typed `populate` option to `dry().collection(x).get()` and
`dry().singleton(x).get()` so a `relation`/`relationmirror` field can come
back resolved to the target's full row instead of just a raw id/id array -
this is exactly the `populate` option `plans/reader.md` and `codegen.ts`
already flagged as deferred ("would need a join/extra query the adapter
doesn't do").

Scope decided with user: typed via codegen (not runtime-only/loose), and
covers all cardinalities (manyToOne -> object|null, oneToMany/manyToMany ->
object[]), not just manyToOne. Still N+1 queries under the hood (one extra
`getEntry` per populated id), never a real SQL join - same as the plan's
original sketch.

Files:
- `src/content-types/field-registry.ts` - export `flipCardinality` (was
  private to codegen.ts, now needed by the runtime resolver too).
- `src/content-types/dry-populate.ts` (new) - `resolvePopulateTargets` +
  `populateRelations`, runtime N+1 resolution, publishedOnly-gated.
- `src/content-types/dry-reader.ts` - `DryCollectionReader`/
  `DrySingletonReader` gain a second generic (`R`, the populatable-relations
  map) and a `get(id, { populate })` overload; `toRecord`/`isPublished`
  exported for reuse.
- `src/content-types/codegen.ts` - emit a `<Type>Relations` interface per
  collection/singleton (only relation/relationmirror fields with a
  resolvable target) plus `DryCollectionRelationsMap`/
  `DrySingletonRelationsMap`, and pass all 4 generics to the ambient
  `declare global function dry(): DryReader<...>`.
- `src/content-types/codegen.test.ts` - update the "declares the ambient
  global" assertion for the new 4-arg signature, add relations-interface
  coverage.
- `src/content-types/dry-reader.test.ts` - populate coverage: manyToOne,
  oneToMany/manyToMany, unpublished target filtered out, bad field name
  throws.
- `src/apps/dry.generated.d.ts` - regenerate (`bun run dry:generate`) once
  the real feature lands, so it's a live example.
- `src/apps/pages/blogs/[slug]/page.tsx` - swap the manual
  `dry().collection("category").get(post.category)` call for
  `dry().collection("blog").get(params.slug, { populate: ["category"] })`,
  the original motivating case.

## Status

Done. All pieces landed:
- `flipCardinality` exported from `field-registry.ts`.
- `dry-populate.ts` (new): `populateRelations`/`resolvePopulateTarget`,
  `toRecord`/`isPublished` (moved out of `dry-reader.ts` to avoid a circular
  import - `dry-reader.ts` now imports them from here).
- `dry-reader.ts`: `DryCollectionReader`/`DrySingletonReader` gained the `R`
  generic + `get(id, { populate })` overload; runtime wired through
  `getCollectionEntry`.
- `codegen.ts`: emits `<Type>Relations` per collection/singleton +
  `DryCollectionRelationsMap`/`DrySingletonRelationsMap`; ambient `dry()`
  global now takes all 4 generics.
- `dry-reader-client.ts` (hydration replay reader) updated for the new
  overloaded `get()` shape - options accepted but ignored, since the server
  already ran populate before recording into `callLog`.
- Tests: `codegen.test.ts` (+6 relations-interface cases) and
  `dry-reader.test.ts` (+8 populate cases: manyToOne, null, unpublished
  filtering, manyToMany, relationmirror reverse, singleton, bad field name).
  All 729 tests pass, `tsc --noEmit` clean.
- `dry.generated.d.ts` regenerated for real (`bun run dry:generate`) -
  `BlogRelations { category: Category | null }` / `CategoryRelations { blog:
  Blog[] }` confirmed present.
- `blogs/[slug]/page.tsx` updated to `get(slug, { populate: ["category"] })`.

Follow-on fix during browser verification: the earlier turn's "optimize the
related-posts query" change (`where: [{ field: "category", op: "eq", ... }]`)
turned out to be broken - `entry-tree.ts`'s `flattenDisplayColumns` excludes
EVERY `relation`-kind field from `queryable` columns (manyToOne included,
confirmed via `entry-tree.ts` - a `relation` field is `kind: "relation"`,
never `kind: "column"`, regardless of cardinality), so `where` can never
filter on a relation field. This only surfaced once the page was actually
loaded in a browser (`curl localhost:5173/blogs/<slug>` - `EntryWhereError:
"category" is not a queryable field`), not from `tsc`/tests. Fixed by
populating the category's own auto-generated `blog` relationmirror instead
(`dry().collection("category").get(category.id, { populate: ["blog"] })`),
then filtering out the current post and sorting/slicing client-side - one
fewer `dry()` call than the original 3-call version, and no `where`
limitation to work around. Verified against the real dev DB: correct
category badge, correct related-post list (self excluded), all 5 seeded
blog slugs return 200 with no new server errors.

## Speed

Scoped via AskUserQuestion, implemented, tested (unit + typecheck + live
dev-server browser check), done in one session.

## Follow-up: `where` on a manyToOne relation field + `id`

User wanted `list({ where: [{field:"category",...}, {field:"id",...}] })` to
actually work (the pattern `entry-tree.ts` blocked) rather than working
around it. Implemented for real:

- `entry-tree.ts`: new `flattenWhereColumns()` (superset of
  `flattenQueryableColumns` - also includes a `manyToOne` relation field's
  own FK column, typed as plain `number`) and `ID_WHERE_COLUMN` (synthetic
  pseudo-column for the row's own primary key, never a declared
  `FieldDefinition` so never in `flattenDisplayColumns`/`flattenQueryableColumns`).
  Deliberately kept SEPARATE from `flattenQueryableColumns` rather than
  widening it - that function's output also feeds admin-UI surfaces
  (`ContentEntryList.tsx`'s searchable-fields toggle, `FieldRenderer.tsx`'s
  relation-picker label/columns) where a raw FK id showing up would be
  confusing/misleading, not just unhelpful (confirmed via a research agent
  before touching it - real regression risk, not hypothetical). `oneToMany`/
  `manyToMany` still excluded - no single column to compare without a
  join/subquery `buildWhereClause` doesn't do.
- `entries-sqlite.ts`/`entries-d1.ts`: `listEntries`/`findEntry` now build
  `where`'s column set from `[...flattenWhereColumns(nodes), ID_WHERE_COLUMN]`
  instead of the narrower `queryable`; `sort`/`search`/`publishedOnly`/
  unique-violation-translation all keep using the original narrow
  `flattenQueryableColumns` result, unchanged.
- Tests: `entry-tree.test.ts` (+4: manyToOne included, manyToMany still
  excluded, plain columns still included, `ID_WHERE_COLUMN` shape),
  `entries-sqlite.test.ts` (+1: real `listEntries` call filtering by
  relation + excluding self by id), `dry-reader.test.ts` (+1: same pattern
  through the public `dry()` reader). 735/735 tests pass, typecheck clean.
- `blogs/[slug]/page.tsx` finalized on this: one `list({ where: [category
  eq, id ne], sort: date desc, pageSize: 3 })` call - real SQL filter+sort+
  limit, no more N+1 `.get()` loop. Verified live against the dev DB
  (`WHERE category = 2 AND id != 42 ORDER BY date DESC LIMIT 3` returns the
  correct single related post).

## Follow-up: `where: [{ or: [...] }]`

`EntryWhere` was flat-AND-only (`entry-where.ts` doc comment explicitly
called this out as a future extension point). User asked for OR support
directly. Implemented one level of OR grouping:

- `entry-where.ts`: new `EntryWhereGroup { or: EntryWhereCondition[] }`;
  `EntryWhere = (EntryWhereCondition | EntryWhereGroup)[]` - each top-level
  entry either a plain condition or a group, ANDed together; a group's own
  conditions are OR-joined and parenthesized. One level only (a group can't
  contain another group) - matches the exact shape asked for, deeper mixed
  nesting deferred same as the original doc comment already deferred OR
  itself. Extracted `buildCondition()` (single-condition SQL) out of
  `buildWhereClause`'s loop so the group path reuses it instead of
  duplicating the `in`/null/plain-op branching. Empty group -> `"0"` (matches
  nothing), same convention as an existing empty `in`.
- No changes needed in `entries-sqlite.ts`/`entries-d1.ts`/`dry-reader.ts` -
  `EntryWhere` was already opaquely passed through everywhere except
  `entry-where.ts` itself (confirmed via grep before touching the type, to
  avoid breaking a caller that destructured `.field` off every entry
  assuming it was always a plain condition - none do).
- New `entry-where.test.ts` (11 tests, this module had no dedicated test
  file before - only indirect coverage through `entries-sqlite.test.ts`):
  plain conditions (AND, `in`, empty `in`, null-as-IS-NULL, unknown-field
  throw) plus the new group behavior (OR-join, AND with siblings,
  group-only where, empty group, multiple groups, throw for a bad field
  inside a group). 746/746 total tests pass, typecheck clean. Verified live
  against the real dev DB (`{ or: [{category eq 4},{category eq 3}] }`
  correctly returned posts from either category) and re-checked all 5 blog
  pages still 200 with no new errors.
