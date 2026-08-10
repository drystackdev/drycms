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
within that module. `src/server/adapters/node.ts` bridges Node's
`http.IncomingMessage`/`ServerResponse` to real `Request`/`Response` objects
(`entry-node.ts`); `src/server/entry-worker.ts` is Cloudflare Workers'
equivalent entry, needing no such bridge at all - `handler.ts`/
`page-handler.ts`/`page-guard.ts` are already Fetch-API-shaped, so it's a
thin `fetch(request, env, ctx)` export that calls them directly (see
`adapters/types.ts`'s own doc comment on why Workers needs no bridging code,
and `status/cloudflare-workers-adapter.md` for the full Workers-support
plan/its remaining gaps - Bun is the one runtime still unimplemented). `env`
is a Workers-style `fetch(request, env, ctx)` env object - Node's adapter has
nothing real to put there (`{}`), Workers passes its real bindings
(`R2Bucket`/`D1Database`/KV namespaces) straight through.

`src/server/config.ts` is resolved once at server startup by
`src/server/options.ts`'s `resolveOptions()` into a fully-normalized
`ResolvedDryOption` - no project-level config file, `kind` (`"local"` vs
`"cloudflare"`) is derived automatically from which SSR entry is being built
(`import.meta.env.DRYCMS_KIND`, baked in by `vite.config.ts`'s `define`).
Invalid config throws **at resolution time**, not at first request - see
"fail at config time" in CODING-PRINCIPLES.md. The one exception is
`content.engine: "D1"`: the live `D1Database` binding only exists per-request
(`context.env`), so its adapter must be constructed fresh inside the route
handler, never cached at module scope like the other engines are.

**Caution:** the dev server (`scripts/dev-server.mjs`) resolves config once
per process and keeps it at module scope for the process's whole lifetime.
Editing `src/server/config.ts`/`options.ts` requires a dev-server restart to
take effect - see "concurrent editing / stale process" in
CODING-PRINCIPLES.md.

## Content engine: schema adapter + entry adapter, three backends

Content has two orthogonal concerns, each with its own adapter interface
(`src/content-types/engine/types.ts` / `entries-types.ts`):

- **`ContentEngineAdapter`** - schema: create/alter/drop the physical
  representation of a `ContentTypeDefinition` when the Content-Type Builder
  saves.
- **`ContentEntryEngineAdapter`** - rows: CRUD on the actual entries.

Two engines implement both, selected by the resolved `content.engine`
(`src/content-types/engine/index.ts`'s `createContentEngineAdapter` /
`createContentEntryEngineAdapter` factories):

| engine | schema module | entries module | storage |
| :-- | :-- | :-- | :-- |
| `sqlite` (default) | `engine/sqlite.ts` | `engine/entries-sqlite.ts` | a real SQLite file, real DDL |
| `D1` | `engine/d1.ts` | `engine/entries-d1.ts` | Cloudflare D1, real DDL |

Both are SQL, so a content-engine feature almost always needs implementing
symmetrically in each pair of modules - the two files stay deliberately
parallel. A third `file` engine existed until 2026-08-04 (one JSON file per
record, no DDL) - removed because it only served the storage layer's
now-defunct `github`/`gitlab` backends, which made content git-diffable; when
those adapters were removed from storage, the `file` engine's sole purpose
vanished (see `plans/remove-file-engine.md` for the details).

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
  vs. side panel) a field renders in on the entry editor.
- `fieldDescriptions?: Record<string, string>` - per-id description override,
  only ever meaningful for a synthetic `relationmirror` row (see below),
  which has no `FieldDefinition.description` of its own.

All three are **self-healing maps**: an id missing from the map gets a
computed default instead of erroring (`system-fields.ts`'s
`applyFieldOrder`/`defaultFieldSide`), and a stale id (referring to a field
or feature that no longer exists) is silently ignored. This is a deliberate,
recurring idiom in this codebase - follow it for any similar per-id override
you add, rather than requiring the map to be exhaustive or erroring on drift.

`deletedFieldIds?: string[]` / `deletedFeatureKeys?: (keyof
ContentTypeFeatures)[]` are a **two-stage trash**, not cosmetic: the schema
editor's Remove button only adds an id here - the underlying
`FieldDefinition` stays in `fields[]` (and `features[key]` stays `true`) so
`tree.ts`/`migration.ts` keep generating its real column exactly as before,
and `naming.ts`'s uniqueness check still blocks a new field from reusing the
same name. The id/key is just hidden from the active Fields/Features list and
the entry editor (`system-fields.ts`'s `activeFields`/
`activeSystemFieldsFor`). The real `DROP COLUMN` only fires once something is
deleted a *second* time, forever, from the trash itself - splicing the id out
of `fields[]`/flipping `features[key]` to `false` for real. Only meaningful
when editing an EXISTING content type; `ContentTypeEditor.tsx` deletes
for real immediately on a brand-new, unsaved one, since there's no live
column yet to protect.

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

### System-type protections (`naming.ts`)

Four independent flags on `ContentTypeDefinition` (`types.ts`) let a handful
of seeded types (`role`, `aiKey`, `seo`, `user`) opt into
protection against being reshaped through the generic schema editor, enforced
both client- and server-side - not merely cosmetic:

- **`hidden`** - absent from `ContentTypes.tsx`'s list, `DryLayout.tsx`'s
  Content dropdown, and every relation/component target picker in
  `ContentTypeEditor.tsx`. Still fully functional underneath (own table, own
  entries API) - reached through a dedicated page instead (`role` via
  `Roles.tsx`/`RoleEditor.tsx`, `aiKey` via its own pinned nav entry).
  Set on `role`/`aiKey`/`seo`.
- **`locked`** - the type's TABLE can never be deleted: the schema editor's
  Danger Zone hides the delete button client-side, and `routes/
  content-types.ts`'s `DELETE` handler rejects it server-side
  (`ContentEngineError("protected")`, 403). Fields/features otherwise stay
  freely editable except any id in `protectedFieldIds`. Set on `user` (needed
  for login) and `seo` (needed for `features.seo`).
- **`frozen`** - the WHOLE schema (fields, features, name) can never change
  via the content-types API at all, not just deletion - `naming.ts`'s
  `assertNotFrozen` rejects any save outright as a `NamingError` (400). Only
  ever paired with `hidden: true`. Set on `role`/`aiKey`; `frozen` is
  specifically what stops an admin from reshaping system schemas relied on by
  auth and other built-in features.
- **`protectedFieldIds`** (`string[]`) - individual fields on an otherwise-
  editable type that can never be edited or removed once seeded.
  `naming.ts`'s `validateProtectedFields` compares each field by full value
  (JSON-equal), so a rename/retype/config change is rejected exactly like an
  outright removal, not just deletion. Still shown normally in the Fields
  list and still openable in `FieldDialog` (view-only: every control
  disabled, footer swaps to a single "Close" button) - never hidden from
  view, only from saving. Set on `user`'s `email`/`password`/`roles`.

`naming.ts` also owns name validation (`validateContentTypeName`/
`validateFieldName` - alphabet + a `RESERVED_NAMES` set covering every
synthetic system column) and `normalizeFieldOrder` (overwrites each field's
`order` to match its position in `fields[]` right before every save, so array
position - not a client-submitted value - is always the real source of
truth). Route these through `naming.ts` rather than re-implementing a check
inline when adding a new save-path guard.

## Permissions / roles

`role` is the only seeded RBAC content type. `role.permissions` stores stable
`<contentTypeId>:<action>` keys directly; the Role editor derives available
keys from current content-type metadata, so there is no second permission
table or row-sync process. A collection gets view/create/update/delete
(+publish if `features.draft` is on), a singleton gets a single `"setting"`
action, and components get none. `role.isSuperAdmin` is a bypass switch
seeded once onto the permanent "Super Admin" role - not something an admin
toggles through `RoleEditor.tsx`, which deliberately excludes the field.

`role` and `aiKey` are seeded with `hidden: true` and `frozen: true` (see
"System-type protections" above); the role schema is part of the auth model.

**Enforced as of 2026-07-31** - see "Auth" below for the session/permission
enforcement layer (`content-types/access.ts`'s `resolveAccess`). Every
`role`'s `isSuperAdmin` flag bypasses every check unconditionally.

## Storage: one adapter interface, two backends, icons nested inside storage

`src/storage/` implements one adapter interface (`types.ts`) via two backends,
selected by the resolved `kind`:

| kind | adapter | storage root |
| :-- | :-- | :-- |
| `"local"` (default) | Node's `fs` module | project's `.dry/` directory |
| `"cloudflare"` | Cloudflare R2 | R2 bucket with key-prefix per option |

`storage` (user-uploaded media) is the independent root: under `kind:
"local"` it resolves straight to `.dry/storage/`, so an upload is stored and
served through the API at `/${basePath}/api/storage/<id>`; under `kind:
"cloudflare"` it resolves to a key-prefix `storage/` in the configured R2
bucket. `icons` (Icon Management's own SVGs) is never independent - it always
resolves to a `dry-icons/` subfolder of `storage`'s own resolved root under
both `kind`s, since an icon is just an image file. `components.storage`
(confirmed RichText component bundles) remains its own root (`.dry/components/`
locally, `components/` prefix in R2), sharing the same adapter mechanism
without sharing a directory. See `status/cloudflare-workers-adapter.md` for
the full R2 backend design and deployment setup.

An `image` field stores a bare storage id (`"hero.jpg"`), never a URL -
`resolveImageSrc()` (`storage/http-source.ts`) turns one into a servable
`/<path>/api/storage/<id>`, passing an already-absolute or root-relative
value (the picker's "Link" tab) through untouched. Page code does NOT call
it: `media-src-hook.ts` installs a Preact `options.vnode` hook that resolves
`src`/`poster` on `img`/`video`/`audio`/`source`/`track` as each vnode is
created, so `<img src={post.image} />` just works. It's installed on BOTH
sides - `app-router/render.ts` for SSR and `apps/hydrate-client.ts` for the
browser (which also seeds `setAdminPath()` from `#dry-vei-config`, since
`window.__DRY_CONFIG__` exists only in the admin app) - because a `src`
resolved on only one side reverts to its raw storage id on any re-render.
Two callers still resolve explicitly, both outside JSX: `render.ts`'s
`og:image`/JSON-LD tags, and the VEI overlay's DOM preview patch, which
writes attributes with `setAttribute` and so never passes through Preact at
all.

## RichText

A hand-built rich text editor (`src/components/RichTextField/`, ProseMirror-
based) - not a thin wrapper over an off-the-shelf WYSIWYG. Notable
architectural choices, each the result of a specific bug or decision (see
`status/*.md` for the full history if you need it):

- Only `.richtext-content` (the actual editable surface) renders inside a
  **shadow DOM root** - toolbar/menus/dialogs stay in the light DOM. CSS for
  the shadow content lives in `content-shadow-styles.ts` (hand-edited
  TS/string, not a `.css` file - there is no build step for it).
- User-registered components are discovered from `src/**/dry.<name>.<ext>`
  files exporting `DryComponent(...)`. An explicit `DryComponent({ name })`
  wins; otherwise the filename supplies the element name. Once an admin
  "confirms" one, it's built into a **standalone JS bundle** (with static
  dry-component imports inlined and Preact shared as `preact.js`) via a nested `vite.build()` +
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

## Auth: session cookie + first-run Super Admin registration

Sign-in (`src/server/routes/auth.ts`, `store/auth.ts`, `pages/SignIn.tsx`/
`RegisterSuperAdmin.tsx`) issues a **stateless, signed session cookie** - no
session table, so it works identically across all 3 content engines. `src/
lib/session-token.ts` follows the exact "version tag + base64 payload" idiom
`password-hash.ts`/`secret-crypto.ts` already use: an HMAC-SHA256 (Web
Crypto) over `{id, name, email, iat, exp}`, keyed off the same
`DRYCMS_SECRET_KEY` env var `secret-crypto.ts` already requires (one app
secret, not a second one to configure). The `Set-Cookie` is `HttpOnly`/
`SameSite=Lax`/`Path=${basePath}`, `Secure` only over https.

`entries-types.ts`'s `ContentEntryEngineAdapter.getRawEntry(type, id)` (added
alongside `getEntry`) is what makes login possible at all: every engine's
normal `getEntry`/`listEntries` masks `password`/`secretkey` columns via
`entry-codec.ts`'s `rowToValue` (by design, so the generic entries API never
leaks a hash) - `getRawEntry` returns the row exactly as stored instead, and
is used ONLY by `routes/auth.ts` to `verifyPassword` a login attempt, never
exposed over the generic entries HTTP route.

`GET /api/auth/session` always reports `hasAnyUser` (is the `user` table
empty?) alongside whatever session cookie is present - this one call drives
`routers/App.tsx`'s `AuthGate`, which sits *above* `DryLayout`/`<Router>`.
`/login` (`SignIn`) and `/register` (`RegisterSuperAdmin`) are real,
always-routable paths, not just gate states - visiting either directly works.
Every OTHER path under `path` (the actual dashboard: `/dashboard`,
`/content/*`, `/content-types`, ...) requires a session and redirects to
`/login` (or `/register`, first-run - `RegisterSuperAdmin` is the only way to
create the first account, assigning the permanently-seeded "Super Admin"
role from the seed definition). The bootstrap POST additionally requires a
deployment-provided `DRYCMS_BOOTSTRAP_TOKEN` of at least 32 characters and a
CSRF token, so an uninitialized public instance cannot be claimed by an
arbitrary cross-site or unauthenticated request. Already-
authenticated visits to `/login`/`/register` bounce to `/dashboard`; an
already-anonymous visit to `/register` once a user exists bounces to
`/login` (registration is first-run only). Sign in/Register render
standalone, no sidebar/topbar chrome; both share the same `.auth-split*`
layout (`components.css`).

`AuthGate` also gates itself on `path` - only URLs at or under `path` are
this app's concern. The dev server/adapters serve the same `index.html` for
*any* unmatched path (`scripts/dev-server.mjs`), so a visit to the bare site
root `/` (or anything else outside `path`) would otherwise still mount this
SPA and fall into its router's dashboard-redirect fallback; `AuthGate`
checks `url.startsWith(path)` first and renders nothing (a blank page,
skipping the session fetch too) when it doesn't match.

### App-level seed: `dry.seed.json` + packaged storage assets

An app's OWN content types (as opposed to the 6 built-in defaults above) can
be packaged for a fresh production deploy - see `plans/content-type-seed.md`
for the full design. `bun run seed:sync` snapshots the current dev content-
type DB (every type, including the 6 defaults) into `src/apps/dry.seed.json`
(alongside `dry.generated.d.ts` - both are generated-but-committed app
artifacts); when that file has content, `content-types/seed.ts`'s
`resolveDefaultContentTypeDefinitions()` uses it INSTEAD of
`defaultContentTypeDefinitions()` for every boot's `pendingSeedStatements`
diff - completely replacing the built-in list, not layering on top of it.
Imported as a plain static JSON import (`resolveJsonModule`), not read with
`node:fs`: this module also has to load on Cloudflare Workers, which has no
filesystem, and is also reached from plain `bun scripts/*.ts` runs
(`seed-sync.ts`, `dry-generate.ts`), which never go through Vite - a static
import is the only form both runtimes resolve with no I/O. Separately, `bun run build`
zips the `storage`/`icons`/`components.storage`/`pageComponents.storage`
roots into `dist/server/seed-assets.zip` (`src/lib/zip.ts`, a hand-rolled
STORE-only container - no new dependency); `routes/auth.ts`'s
`register-first-admin` extracts it into whichever roots the RUNNING
server's own config (`src/server/config.ts`) resolves to (once, gated on
`hasAnyUser` being false - never re-extracted on a later boot, unlike the
schema seed above).

### Enforcement (added 2026-07-31): a session for everything, permissions for content

`src/server/session.ts`'s `resolveSession()` runs once in `handler.ts`
before dispatch, for **every** `/api/**` segment - rejects with 401
`{error:"unauthenticated"}` for any segment except `auth` itself (register/
login/logout/session have to be reachable with no session). `storage`/
`icons`/`iconify`/`richtext-components` need nothing beyond this - any
authenticated user may use them, no per-resource model exists for them.

`content-types/access.ts`'s `resolveAccess(entryAdapter, allTypes, session)`
resolves what that session's user can do - **fresh on every call, no
caching** (a revoked role grant takes effect on the very next request,
not just at the user's next login - a stricter contract than the session
token's own `name`/`email`, which happily go stale until then). Walks
`user.roles` → each `role` row (fetched via `getEntry`) →
`role.isSuperAdmin` short-circuits to "can do anything" the moment one
matches, otherwise unions every matched role's permission keys and checks the
requested `(contentTypeId, action)` key directly.

Two routes call this on top of `handler.ts`'s central gate (belt-and-
suspenders - their own unit tests call the exported handler directly,
bypassing `handler.ts` entirely):
- **`routes/content-entries.ts`** - every verb maps to a `PermissionAction`
  (singleton collapses everything to `"setting"`; collection: `GET→view`,
  `POST→create`, `PUT`/`PATCH→update`, `DELETE→delete`) and 403s unless
  `access.can(type.id, action)`. On draft-enabled collections, creating or
  updating a row with `draft: false` additionally requires the distinct
  `publish` permission.
- **`routes/content-types.ts`** (the Content-Type Builder - schema/field/
  feature edits, not entry data) - `GET` only needs the central "has a
  session" gate (the sidebar and every entry editor need the type list
  regardless of role); `POST`/`PUT`/`DELETE` additionally require
  `access.isSuperAdmin` - there's no granular "can edit schema" permission
  action in the model, so schema writes are Super-Admin-only outright.

Server-side only this pass - no client UI hides/disables an action a role
can't perform; a denied action still round-trips and surfaces as a thrown
`*ApiError`/toast.

## Routing

Full Preact SPA via `preact-iso` (`src/routers/App.tsx`); no server-side
routing beyond the one API handler above and serving the client bundle.
`AuthGate` (see Auth above) sits above the router itself, deciding whether
`DryLayout`/`<Router>` render at all.
