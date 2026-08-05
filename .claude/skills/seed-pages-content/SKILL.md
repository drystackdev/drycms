---
name: seed-pages-content
description: Convert a hardcoded section of src/apps/pages/** (the public site) into a drycms content type + real seed data, wired to the page via dry(). Use when asked to "make X page CMS-editable", add a content type for a page/section, or seed entry data into the local content DB.
---

# Seeding content types + data for `src/apps/pages/**`

`src/apps/pages/**` (the public-facing site, App Router-style) starts out as
plain hardcoded JSX/Tailwind with mock arrays at the top of each file - see
`docs/APP-ROUTER.md`. Turning a section into something the CMS admin can
edit is a 4-step conversion, always in this order:

## 1. Read the hardcoded section as the schema's ground truth

Open the page file and find the mock `const`s / inline JSX text it renders.
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
  re-runnable (`bun run seed:pages` clears+reinserts `blog` every run).

See `scripts/seed-pages-content.ts` for a full worked example (the
`homepage` singleton + its 7 section components + the `blog` collection),
runnable with `bun run seed:pages`.

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

Rewrites `src/apps/dry.generated.d.ts` so `dry().singleton("homepage")` /
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
pages (throws if the collection has no `slug` feature).

## Content engine constraint

`content-seed.ts` throws immediately if `content.engine === "D1"` - these
scripts open a local sqlite file directly and have no D1 binding outside a
real request; they only work against the default local `sqlite` engine.
