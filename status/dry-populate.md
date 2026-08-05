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
