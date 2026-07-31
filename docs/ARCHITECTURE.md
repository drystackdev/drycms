# Architecture

drycms is a standalone Preact + Vite + Node app - no Astro, no separate
library package (see `AGENTS.md` for the file layout and dev commands). This
doc is about how the pieces fit together and why; read it before touching
`src/server/**`, `src/content-types/**`, `src/storage/**`, or
`src/components/RichTextField/**`.

## Server: one Fetch-shaped handler, adapter per runtime

`src/server/handler.ts` is the entire server-side API surface as a single
`(Request) => Promise<Response>` function. It dispatches by the path segment
right after `${path}/api/` (`storage`, `icons`, `iconify`, `content-types`,
`content`, `richtext-components`) to a route module, then by HTTP method
within that module. `src/server/adapters/node.ts` is the only adapter wired
up today; `adapters/types.ts` documents the contract a future
Workers/Bun adapter would need to satisfy. `env` stands in for a Workers-style
`fetch(request, env, ctx)` env object - Node has nothing to put there (`{}`).

`dry.config.ts` (repo root) is resolved once at server startup by
`src/server/options.ts`'s `resolveOptions()` into a fully-normalized
`ResolvedDryOption`. Invalid config throws **at resolution time**, not at
first request - see "fail at config time" in CODING-PRINCIPLES.md. The one
exception is `content.engine: "D1"`: the live `D1Database` binding only
exists per-request (`context.env`), so its adapter must be constructed fresh
inside the route handler, never cached at module scope like the other
engines are.

**Caution:** the dev server (`scripts/dev-server.mjs`) resolves config once
per process and keeps it at module scope for the process's whole lifetime.
Editing `dry.config.ts` requires a dev-server restart to take effect - see
"concurrent editing / stale process" in CODING-PRINCIPLES.md.

## Content engine: schema adapter + entry adapter, three backends

Content has two orthogonal concerns, each with its own adapter interface
(`src/content-types/engine/types.ts` / `entries-types.ts`):

- **`ContentEngineAdapter`** - schema: create/alter/drop the physical
  representation of a `ContentTypeDefinition` when the Content-Type Builder
  saves.
- **`ContentEntryEngineAdapter`** - rows: CRUD on the actual entries.

Three engines implement both, selected by `content.engine` in `dry.config.ts`
(`src/content-types/engine/index.ts`'s `createContentEngineAdapter` /
`createContentEntryEngineAdapter` factories):

| engine | schema module | entries module | storage |
| :-- | :-- | :-- | :-- |
| `sqlite` (default) | `engine/sqlite.ts` | `engine/entries-sqlite.ts` | a real SQLite file, real DDL |
| `D1` | `engine/d1.ts` | `engine/entries-d1.ts` | Cloudflare D1, real DDL |
| `file` | `engine/file/file.ts` | `engine/file/entries-file.ts` | one JSON file per record, no DDL, git-diffable |

The `file` engine reuses the same `local`/`github`/`gitlab` storage adapters
as `storage`/`icons` (see below) - it's a third root within the same
disk/repo, not a separate storage mechanism. When adding a feature to the
content engine, check whether it needs implementing symmetrically across all
three, or is legitimately sqlite/D1-only (row-level SQL utilities like
`permissions.ts` are a deliberate, narrow exception - see below).

## Content-type / field model

`src/content-types/types.ts`'s `ContentTypeDefinition` is the schema unit:
`kind` is `"collection"` (many rows), `"singleton"` (exactly one row, e.g.
site settings) or `"component"` (reusable field group embedded in other
types, no table/route of its own). `fields: FieldDefinition[]` holds the
custom fields; `field-registry.ts` defines every field *type* (`text`,
`number`, `relation`, `component`, etc.) - each with a `shape`
(`"column" | "flatten" | "child-table" | "virtual"`) that determines its
physical layout, an optional `Editor` component, and `configFields`/
`validationFields` descriptors that drive the generic Add/Edit Field dialog
(one shared form renders these instead of a bespoke form per field type).

Several things are **cosmetic display overlays that never affect the real
database column order**, kept as separate persisted maps precisely so
"how it looks" and "how it's stored" can't silently drift into each other:

- `fieldOrder?: string[]` - display order in the schema editor's Fields list
  and the entry editor's form. `tree.ts`'s `resolveTableTree` (real DB column
  order) always puts system columns first regardless of this.
- `fieldSides?: Record<string, "left"|"right">` - which column (main content
  vs. showcase panel) a field renders in on the entry editor.
- `fieldDescriptions?: Record<string, string>` - per-id description override,
  only ever meaningful for a synthetic `relationmirror` row (see below),
  which has no `FieldDefinition.description` of its own.

All three are **self-healing maps**: an id missing from the map gets a
computed default instead of erroring (`system-fields.ts`'s
`applyFieldOrder`/`defaultFieldSide`), and a stale id (referring to a field
or feature that no longer exists) is silently ignored. This is a deliberate,
recurring idiom in this codebase - follow it for any similar per-id override
you add, rather than requiring the map to be exhaustive or erroring on drift.

**System fields** (`system-fields.ts`) are synthesized on demand from
`ContentTypeFeatures` (title/slug, draft, schedule, timestamps, seo,
sortable) - never stored as real `FieldDefinition`s. **`relationmirror`**
fields are the same idea for the *reverse* side of a relation: every
`relation` field on type A pointing at type B auto-generates a synthetic
mirror field on B (id `` `__mirror_${sourceTypeId}_${sourceFieldId}` ``) -
never manually added, never in `fields[]`, computed by
`relationMirrorFieldsFor(type, allTypes)`. It opens through the *same*
`FieldDialog` a real field uses (Label/Name/Type locked, Description/side
still editable), and its Remove action cascades to delete the real `relation`
field on the source type.

`ContentTypeDefinition.version` is an optimistic-lock counter, incremented on
every successful save - check it when adding any new save path.

## Permissions / roles

`role` and `permission` are ordinary seeded content types (`seed.ts`), but
`permissions.ts` additionally hand-writes raw SQL for exactly those two
tables (`permissionSyncStatements`, `permissionActionsFor`,
`superAdminSeedStatement`) - a deliberate, narrow exception to the
schema-definition-only boundary the rest of the engine maintains, not a
general row-CRUD feature. One `permission` row exists per (resource, action)
pair; a collection gets view/create/update/delete (+publish if
`features.draft` is on), a singleton gets a single `"setting"` action,
components get none. `role.isSuperAdmin` is a bypass switch seeded once onto
the permanent "Super Admin" role - not something an admin toggles through
`RoleEditor.tsx`, which deliberately excludes the field.

**As of this writing there is no enforcement** - the schema and the
Roles/RoleEditor UI exist, but no request is actually checked against a
role's permissions yet. Don't assume permission rows gate anything until
that enforcement pass lands. Also note: since content-type system
protections were removed (any type, including `role`/`permission`, can now
be freely renamed or deleted), renaming/deleting either will silently break
`permissions.ts`'s hardcoded table-name SQL - nothing guards against this.

## Storage: one adapter interface, three backends, three independent roots

`src/storage/` implements one adapter interface (`types.ts`) three ways -
`local.ts` (filesystem), `github.ts`, `gitlab.ts` (repo contents API) - all
constructed via `createStorageAdapter()` from a `ResolvedStorageOption`.
`storage` (user-uploaded media), `icons` (Icon Management's own assets),
`content` (the `file` content engine's JSON store), and `richtext.storage`
(confirmed RichText component bundles) are **four independent roots**
sharing this same mechanism - never sharing a directory even when they share
a backend `kind`. `github`/`gitlab` credentials come from env vars
(`GITHUB_REPO`/`GITHUB_PAT_KEY`/`GITHUB_BRANCH`,
`GITLAB_PROJECT`/`GITLAB_PAT_KEY`/`GITLAB_BRANCH`/`GITLAB_HOST`), never from
`dry.config.ts` itself, so no secret ends up committed. `github`/`gitlab`
`list()`/`listAll()` deliberately drop `modifiedAt` (+ GitLab file size) for
list-call speed - a user-approved perf tradeoff, don't add them back without
asking.

## RichText

A hand-built rich text editor (`src/components/RichTextField/`, ProseMirror-
based) - not a thin wrapper over an off-the-shelf WYSIWYG. Notable
architectural choices, each the result of a specific bug or decision (see
`status/*.md` for the full history if you need it):

- Only `.richtext-content` (the actual editable surface) renders inside a
  **shadow DOM root** - toolbar/menus/dialogs stay in the light DOM. CSS for
  the shadow content lives in `content-shadow-styles.ts` (hand-edited
  TS/string, not a `.css` file - there is no build step for it).
- User-registered components (`dry.config.ts`'s `richtext.componentsDir`,
  default `src/dry-components`) are scanned for a `DryEditerComponent(...)`
  default export per subfolder. Once an admin "confirms" one, it's built into
  a **standalone JS bundle** (Preact inlined) via a nested `vite.build()` +
  `@preact/preset-vite` call (`build-component-bundle.ts`) - this only runs
  inside the dev server (no separate production build step for it), so it
  must explicitly force `NODE_ENV=production`/disable Preact DevTools/set
  `minify: "oxc"` itself rather than inheriting the dev server's own mode.
  The editor mounts a confirmed component through the *same* Preact instance
  its own bundle imported (fetched from the same origin as that bundle's
  `preact.js`) - two different Preact instances in the same page silently
  breaks hooks (`Cannot read properties of undefined (reading '__H')`).
- HTML import/export treats marks as DOM-serializer "runs", matching
  ProseMirror's own algorithm - never read `el.style.*` when importing HTML,
  since the CSSOM rewrites hex colors and grid `span` values on the way
  through, corrupting round-trips.
- Grid layout, table toolbar, lists, links, and reorder-mode are all
  hand-rolled features layered on top of the base editor, not plugins from
  an existing rich-text ecosystem - see `status/grid.md` and the RichText-
  prefixed memory entries if extending any of them.

## Routing

Full Preact SPA via `preact-iso` (`src/routers/App.tsx`); no server-side
routing beyond the one API handler above and serving the client bundle.
