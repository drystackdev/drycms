---
name: seed-pages-content
description: Convert a hardcoded section of the page source store (`.dry/pages-source/pages/**`, the public site) into a drycms content type + real seed data, wired to the page via dry(). Use when asked to "make X page CMS-editable", add a content type for a page/section, or seed entry data into the local content DB.
---

# Seeding content types + data for `.dry/pages-source/pages/**`

The public-facing site (App Router-style) lives in the page source store's
`pages/` root - locally that's `.dry/pages-source/pages/**`, the LIVE
source that `bun run dev` reads directly and the Page Editor writes to. It
starts out as plain hardcoded JSX/Tailwind with mock arrays at the top of
each file - see `docs/APP-ROUTER.md`. A sibling `component/` root
(`.dry/pages-source/component/**`) holds reusable pieces a page imports as
`@component/Card` - if the hardcoded section is already split into its own
component file, that's where it lives instead of under `pages/`.

**Never target `src/apps/pages/**` for this** - it's a gitignored,
build-time-only materialized COPY of `.dry/pages-source/pages/**`
(regenerated from it by `sync-pages-r2.ts`, and often simply absent/empty
on a checkout that hasn't run a build yet). Hand-editing it has no lasting
effect: the next sync or build overwrites it from the real source. See
CLAUDE.md's "Two page-source roots" section for the full split.

Turning a section into something the CMS admin can edit is a 4-step
conversion, always in this order:

## 1. Read the hardcoded section as the schema's ground truth

Open the page file under `.dry/pages-source/pages/**` (or `component/**`)
and find the mock `const`s / inline JSX text it renders.
Each visually-distinct block (hero, a card grid, a CTA band) becomes either:
- a **flat field group** → a `component` content type with `shape: "flatten"`
  (`repeatable: false`), embedded on the parent via a `component` field -
  use this for "exactly one of these" (a hero, a CTA band).
- a **repeatable list** → a `component` content type with `repeatable: true,
  sortable: true` - use this for "N of these" (value-prop cards, press
  mentions).
- a genuinely separate resource with its own detail page (blog posts) → its
  own `collection` content type, not a component.

The page itself (home, about, contact) becomes one `singleton` content type
that embeds every section component as a field, in the same order they
render.

## 2. Write the content-type definitions + seed data in one script

Import the shared helpers from `scripts/lib/content-seed.ts`:
- `upsertContentType(def)` - idempotent by `name`; creates on first run,
  reconciles schema on every re-run. **Call components before whatever
  embeds them** - a `component` field's `config.componentId` must already
  exist in the DB when the embedding type is saved.
- `writeSingletonEntry(name, value)` - upsert the one row a singleton has.
- `insertCollectionEntry(name, value)` / `clearCollection(name)` - for a
  `collection`; call `clearCollection` first if the script should be safely
  re-runnable (wipes+reinserts every row on each run).
- `upsertCollectionEntryByField(name, matchField, matchValue, value)` - for
  a collection the seed script doesn't own exclusively, or whose rows are
  referenced elsewhere by id (a `relation` field pointing at them) - matches
  an existing row by field value instead of blind clear+reinsert, so ids
  stay stable across re-runs. Returns the saved row.

There's no permanent `seed:pages` npm script and no standing worked-example
file to open - write a one-off script directly under `scripts/` (e.g.
`scripts/seed-<page>-content.ts`) that imports the helpers above, then run
it once with `bun scripts/seed-<page>-content.ts` against the live DB. (A
prior worked example for the homepage existed at that exact path but was
deleted by a `bun run new:project` reset along with the pages it seeded -
treat this section as the pattern to follow each time, not something to go
read.)

### Field/type naming gotchas (`src/content-types/naming.ts`)

- Content type names: `/^[a-z][a-z0-9-]*$/i` (hyphens OK).
- **Field names**: `/^[a-z][a-z0-9]*$/i` - **no hyphens or underscores**,
  camelCase only.
- `RESERVED_NAMES` blocks a field literally named `title`, `slug`, `draft`,
  `schedule`, `id`, `metadata`, `sortindex`, `parent_id`, `position`,
  `target_id` on ANY type (not just ones with `features.slug` on) - a hero's
  "title" field has to be named something else, e.g. `headline` (its
  display `label` can still say "Title").
- `features.slug: true` on a `collection`/`singleton` synthesizes `title` +
  `slug` fields for you - don't redeclare them.
- Give every `FieldDefinition`/type a **fixed, stable `id`** (not
  `crypto.randomUUID()`) so re-running the seed script is idempotent instead
  of minting duplicates - `upsertContentType` only reuses the real DB id for
  an *existing* type; a brand-new one uses whatever `id` you passed.

### EntryValue shape when writing entries directly (bypassing the HTTP API)

- A flatten (non-repeatable) `component` field's value is a **nested
  object** keyed by the field's `name`: `{ hero: { eyebrow: "...", ... } }`.
- A repeatable `component` field's value is an **array of such objects**:
  `{ valueProps: [{ headline, description }, ...] }`.
- A `date` field wants a real `Date` instance (or an ISO string), not a
  formatted display string - parse "DD/MM/YYYY"-style source data before
  writing it.
- Skip `format: "url"` validation on a field if the source data uses
  placeholder hrefs like `"#"` - it'll reject them.

## 3. Regenerate the typed reader

```
bun run dry:generate
```

Rewrites `.dry/dry.generated.d.ts` so `dry().singleton("homepage")` /
`dry().collection("blog")` are typed. Needed once after schema changes;
`scripts/dev-server.mjs` also does this once on dev-server boot.

## 4. Wire the page to `dry()` instead of the mock array

```ts
const home = await dry().singleton("homepage").get();
const { rows: latestPosts } = await dry().collection("blog").list({
  sort: { field: "date", dir: "desc" },
  pageSize: 3,
});
```

Delete the mock `const` arrays once the page reads live data. A `collection`
with `features.slug` supports `dry().collection(name).get(slug)` for detail
pages (throws if the collection has no `slug` feature). Since this edit is
in `.dry/pages-source/pages/**`, `bun run dev` picks it up immediately -
no rebuild or sync step needed to see the wired-up page.

## Content engine constraint

`content-seed.ts` throws immediately if `content.engine === "D1"` - these
scripts open a local sqlite file directly and have no D1 binding outside a
real request; they only work against the default local `sqlite` engine.
