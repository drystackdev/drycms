# Porting `mai-anh-quyen`'s fixes onto `sivelap` (2026-08-12)

## Plan

The two branches diverged 50+/26 commits from `73bae8c`, and `mai-anh-quyen`
never gained `sivelap`'s MCP server / page-components / avatar work - so a
merge was never on the table. Cherry-pick the commits behind each reported
bug instead, resolve by hand, then verify against a real `wrangler dev`
Worker (the runtime the production hang actually happened on).

Reported:

1. RichText Image and Image Field out of sync.
2. New entry: broken image link.
3. Production hangs on every page after signing in (Cloudflare).

Added mid-session by the user:

4. Paste into RichText still buggy.
5. Ref picker dialog should use the collection's own cache mechanism, and
   deleting a row should null out the relations pointing at it.
6. `bun run dev:worker` should seed a full demo project, with tests.

## Status

### 1-3, cherry-picked and verified

| Bug | Commits ported |
| --- | --- |
| 1. RichText ↔ ImageField | `71c3034`, `87da0a9` |
| 2. New-entry image link | `4ce69d5`, `8d2d45d`, `87da0a9` |
| 3. Prod hang after login | `46e2a4d`, `172b962`, `5d1723c` |

`094f98e` (FakeLockManager) was already on `sivelap` via `2331449`, and
`e8ee175` was byte-identical to `sivelap`'s own `501247d` - both skipped as
empty. Deliberately dropped from the picks: `src/apps/dry.generated.d.ts`
(relocated to `.dry/` here), `src/apps/pages/blogs/[slug]/page.tsx` (a
public-site CSS tweak, unrelated, and partly reverted on that branch anyway)
and `generated-asset-hrefs.ts` (build output - kept `sivelap`'s hashes).

One conflict needed a real decision: `scoped-source.ts`'s `listAll`.
`87da0a9` makes ids absolute, `2d2686f` adds the hidden-`.tmp.*` fallback -
both are wanted, so the merged version keeps `isInScope` + absolute ids AND
`scoped.length > 0 ? scoped : list(null)`.

`status/auth-refresh-hang.md` (ported) has the full root-cause writeup for
bug 3 - three variants of "one promise, created in one request/tab, awaited
by another that can never release it".

Verified on `wrangler dev` + real D1/R2 (not just unit tests):

- Bug 3, recovery: dropped the `drycms_session` cookie mid-session, fired 3
  API requests at once - all 3 401'd, ONE `POST /auth/refresh` (coalesced)
  came back 200, both retries succeeded, total 57ms. Pre-fix production
  attempted no refresh at all and sat on spinners.
- Bug 3, dead session: dropped `drycms_refresh` too - the 401 flipped the app
  to Sign in via `markSessionExpired()` instead of spinning forever.
- Bug 1: RichText's "Insert image" dialog now has the same flat
  **Entry / File / Link** tab row as `ImageField`, Entry first, Link tab
  `type="url"` with a demo placeholder.
- Bug 2: uploaded into a new entry's hidden `.tmp.*` folder, picked it - the
  field rendered `/dry/api/storage/.tmp.article.admin-example-com/qa-cover.webp`
  (absolute, was prefix-stripped and unresolvable before). After Save both
  the `cover` id AND the RichText `<img src>` were rewritten to
  `entry/qa-article/qa-cover.webp`.

### 4. RichText paste

Cherry-picked `2d2686f` (pasted-image confirm dialog + style sanitisation),
`0722693` (its e2e specs), `11dedef` and `27af18c` (surface the real reason a
pasted image URL's redirect was refused, then follow one re-validated
redirect).

### 5. Ref picker cache + delete-nulls-relations

**Cache.** `RelationField` did an unconditional `source.fetchRows()` in its
own effect on every open/page/sort/search. It now goes through `useFetch`
with a key the SOURCE builds (`rowsCacheKey`), deliberately the same
`entries:<type>:list:<params>` shape `ContentEntryList.tsx` already uses, so
the picker and the List page share IndexedDB entries rather than each
keeping a half-stale copy. That also means the picker inherits the
data-version protocol: a delete elsewhere bumps the version and the picker
self-corrects.

- `RelationFieldSource.fetchRows` is now `(query, ifVersion, signal) =>
  VersionedFetchResult<RelationFieldEntryPage>`, plus `toRow` - the cached
  payload has to stay byte-identical to the List page's, so flattening moved
  after the read.
- `useFetch` gained `enabled` (default `true`). Without it, an entry form
  with several relation fields would fetch every target collection just to
  render its closed pickers.
- `handleCreated` uses `reload()` instead of the old `refreshToken` counter.

Measured on the Worker: while closed, the only `demoAuthor` traffic is the
per-id chip resolution; opening adds exactly ONE list request; re-opening
renders 2 rows within 250ms (cache-first, before any network round trip).

**Delete.** `deleteEntry` deleted the row and the child rows it OWNED, but
nothing pointing AT it - no generated DDL declares real foreign keys, so a
`manyToOne` column kept a dead id and a link table kept a dead row. In the
admin that showed as a relation chip stuck on `ID: 46vJkL`.

`entry-tree.ts` gained `inboundRelationRefs(targetTypeId, allTypes)`, which
walks every collection/singleton (tracking the real table per level -
`flatten` stays, `component-repeat` switches) and returns each physical
reference site plus its owning type name. Both engines now clear them inside
`deleteEntry` - `UPDATE ... SET col = NULL` for a `manyToOne` column,
`DELETE ... WHERE target_id = ?` for a link table - and bump the referencing
type's resource version, but only when something actually changed (an
unbumped type would keep serving the stale row from IndexedDB). `dbRun` in
the D1 engine now also returns `changes` for that check.

Verified on the Worker: deleting the category left `category: null` ("No
items selected." in the editor); deleting one of two authors left
`authors: ["2mBGhT"]` and only "Ada Lovelace" on screen - no dangling chip.

### 6. Demo project on `dev:worker`

- `src/content-types/demo-seed.ts` - pure data: 5 content types (a component,
  two slugged collections, the main collection touching text/richtext/image/
  number/boolean/date/multi-select/both relation cardinalities, and a
  singleton with a repeatable component), 7 entries with real relations, and
  3 page sources (`/demo`, `/demo/[slug]`, `@component/DemoCard`).
- `src/content-types/demo-seed.test.ts` - 13 tests: every field type is
  registry-known, every relation/component target is a demo type, the array
  is in dependency order, no reserved names (`title` was caught here), ids
  stable across calls, entries pass their own type's `validateEntryValue`,
  relation targets exist and are created first, page paths sit under real
  source roots and only import/read things the seed also creates.
- `scripts/seed-demo.ts` - pushes it over the ordinary admin HTTP API
  (`getPlatformProxy` doesn't work under bun, so talking to the server that
  owns the bindings is the only way to reach miniflare's D1/R2). Idempotent:
  types matched by fixed `demo-*` ids, entries by slug, page sources never
  overwritten (`--force` relaxes that last one).

**Revised 2026-08-12, same day**: this first landed auto-wired into
`dev:worker` (a `scripts/dev-worker.mjs` wrapper watched for `wrangler dev`'s
"Ready on" line, then seeded; `dev:worker` itself gained a pre-build
`--pages-only` step to get the pages into `src/apps/pages` before the
compile-time route glob ran). The user asked for seeding to stay a separate,
deliberately-run command instead - starting the dev server and populating it
with demo content are two different decisions, not one step. Reverted:
`dev:worker` is back to its original `pull → build:worker → wrangler dev`;
`scripts/dev-worker.mjs` and `seed-demo.ts`'s `--pages-only` mode (and the
local-store `applyDemoTypesLocally` it depended on) are gone. `bun run
seed:demo` is unchanged otherwise - run it yourself, against whichever
server (`bun run dev` or `bun run dev:worker`) you already have up.

Known limit, by design rather than a gap in the seed: under `dev:worker` (and
production) `/demo` 404s for an ordinary visitor until it's built once from
the Page Editor - `page-handler.ts` serves `built/live/*` only, and the build
runs in the BROWSER, so a CLI can't publish it. The seeder prints this
instead of a URL that 404s. Under `bun run dev` the page is live immediately.

### Verification

- `bun run typecheck` clean.
- `bun run test`: 1211 passed, 4 failed - the same 4 that fail on `sivelap`
  untouched (`component-preview`, `sitemap`, 2 in `auth.test.ts`; the auth
  pair is the `avatar` field this branch added and that test not expecting
  it). Net +38 passing tests.
- `bun run test:e2e`: 22/22, twice in a row. Two of those needed fixing
  first, both of them mine:
  - `richtext-paste-image.spec.ts` opened `/dry/content/blog/new`. That's a
    `mai-anh-quyen` fixture assumption - `blog` came from its `dry.seed.json`,
    which `sivelap` removed in `a6aab73`, and the e2e server boots a fresh
    DB with the packaged system types only. Rewritten to create its own
    slugged collection with a RichText field, like `entry-media-picker.spec.ts`
    already does.
  - `entry-media-picker.spec.ts` failed only under parallel workers, and not
    always in the same place - which is the real finding: every spec shares
    ONE server, one SQLite file and one storage root, and several of them
    apply a real schema migration. Under contention the loser surfaces
    somewhere unrelated (a Save whose navigation never lands, a picked image
    whose field never resolves). `playwright.config.ts` now pins
    `workers: 1`; the whole suite is 37s serial. The race was latent before
    this branch - adding two more schema-applying specs is what made it show.
- `bun run dev:worker` builds, boots, auto-seeds, and re-seeds idempotently.

### Found while working, NOT fixed

`regenerateTypesCache` → `writeGeneratedDryTypes` calls `createStorageAdapter`
directly instead of `getStorageAdapter()`, so under `kind: "r2"` every schema
save logs `StorageError: storage.kind "r2" requires a live R2 bucket binding`
and the types cache never regenerates on a Worker. Caught and non-fatal (the
save itself succeeds), pre-existing, and outside what was asked for.

## Speed

Bugs 1-3 ported and verified in one pass; 4-6 arrived mid-session and were
done in the same sitting. Cherry-picks landed with 4 conflicts total, all
mechanical except `scoped-source.ts`'s `listAll`.
