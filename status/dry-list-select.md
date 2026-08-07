# dry() reader: `select` option for `list()`

## Plan

Add a `select` option to `dry().collection(x).list()` so a page asks for the
fields it actually renders instead of the whole row. Motivation (from the
user's question about `#dry-replay-data`): every `dry()` result is embedded
in the served HTML as the hydration replay log, so an unused field is paid
for twice - once in the query, once in every visitor's download - whether or
not they're signed in. `get()` is deliberately untouched (a detail page's own
entity needs its whole row, and it feeds the SEO cascade).

Shape decided with user:

```ts
list({ select: { name: true, description: (d) => d } })
```

- `true` -> return the field as stored.
- function -> receives THAT field's stored value, returns what the page wants.
- `select` absent/`undefined` -> every field, exactly as before (confirmed
  explicitly by the user mid-implementation).

Decisions taken while building:

1. **Push the projection down to SQL, not just the returned object.** One
   filtered node tree (`entry-tree.ts`'s new `selectFieldNodes`) drives the
   `SELECT` column list, the row decode, AND `populateChildFields` - so an
   unselected repeatable component / multi-valued relation / relationmirror
   costs no per-row child query at all. That's a query win on top of the
   payload win (`category.list()` on the site was doing one mirror query per
   row for a `blog` array nobody rendered).
2. **Unselected = absent, not `null`.** Different from the pre-existing
   `include` mechanism (a non-inline `richtext` excluded by default still
   comes back as a `null` key, because its node stays in the tree).
3. **A selected field beats the default richtext exclusion** - naming `body`
   in `select` fetches it.
4. **Transforms run before VEI boxing, on plain values**, and their keys are
   passed to `markRecord`/`boxRecordStrings` as "don't box these". Otherwise
   a truncated excerpt would be offered for inline editing while the entry
   editor holds the full text, and a transform would see a boxed `String`
   in an edit-mode render but a plain `string` everywhere else.
5. **Typed via overload, not a conditional return type**: `list<S>` with
   `select` first, plain `list(options?)` second - so no-`select` callers
   keep their exact old signature.

Files:
- `src/content-types/engine/entry-tree.ts` - `selectFieldNodes` (new).
- `src/content-types/engine/entries-types.ts` - `EntryQuery.select`.
- `src/content-types/engine/entries-sqlite.ts`, `entries-d1.ts` -
  `listEntries` narrows its read through `selectFieldNodes`.
- `src/content-types/dry-vei.ts` - `boxRecordStrings(record, target, skipKeys)`.
- `src/content-types/dry-populate.ts` - `markRecord(..., unboxedKeys)`.
- `src/content-types/dry-reader.ts` - `DrySelect`/`DrySelected` types, the
  `list` overload, `selectTransforms`/`applyTransforms`.
- `src/apps/pages/page.tsx`, `blogs/page.tsx`, `blogs/[slug]/page.tsx` - the
  four site `list()` calls now select.
- `docs/APP-ROUTER.md` - the page-author-facing docs.

## Status

Done, verified.

- Unit tests: 6 new in `dry-reader.test.ts` (projection, transforms, no-select
  = full row, where/sort on unselected fields, replay log holds the projected
  rows, edit-mode boxing rule), 2 in `entries-sqlite.test.ts` (SQL-level
  projection + skipped child queries), 1 in `dry-vei.test.ts` (`skipKeys`).
  All pass.
- `bun run typecheck` clean. Type behavior separately proven with a throwaway
  file (since `*.test.ts` isn't type-checked by `tsc`): selected fields typed,
  a transform's return type replaces the stored one, an unselected field is a
  compile error, no-`select` still yields the full generated interface.
- Live dev server, before/after on the same DB: the rendered markup is
  BYTE-IDENTICAL, only the replay log shrank.
  - `/blogs`: blog rows 2176 -> 1647 bytes (dropped `content: null` + the
    all-null `seo` block), category rows 334 -> 170 (dropped `slug` and the
    `blog` mirror array + its per-row query).
  - `/`: blog rows 1131 -> 579, category 334 -> 170.
  - `/blogs/<slug>`: related-posts list 184 bytes for 4 fields.
- Hydration re-checked in a real headless browser (the MCP browser was busy):
  `/blogs` search filters 6 cards -> 1, category chip filters -> 1, the mobile
  menu on `/` still opens, zero console errors/warnings (no hydration
  mismatch).

## Speed

One pass, no blockers.

Pre-existing failures NOT caused by this work (same at `HEAD` in a scratch
worktree): 16 unit tests fail with `table "siteSettings"/"category" already
exists` and seed-content assertions, from the in-progress `dry.seed.json` /
`seed.ts` changes in the working tree. Also fixed one pre-existing type error
in `blogs/page.tsx` (`post.category !== null` left `number | undefined`; now
`!= null`) since that file was being edited anyway.

## Not done (deliberate)

- No `select` on `get()` / singletons.
- Not recursive: naming a component field keeps its whole subtree. A page
  that wants 2 fields out of a 10-field component still gets 10.
- The client replay reader ignores `select` entirely, which is correct - it
  replays an already-projected result.
