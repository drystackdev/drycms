# Role/Permission setup - Singleton UI parity, System toggles, Magic gating

## Plan

Five independent-ish pieces, confirmed with the user (2026-08-07):

### 1. Singleton section in RoleEditor → same UI as Collections

`RoleEditor.tsx`'s "Singletons" fieldset currently renders one flat
`CheckField` per singleton (lines ~392-420). Change it to the same
`<details>`/summary-dots/switches-panel pattern the "Permissions"
(collections) fieldset already uses (lines ~340-390). `permissionActionsFor`
already returns `["setting"]` for a singleton, so the switches panel will
just have one switch - only the wrapper markup changes. Extract the shared
`<details>` block into one small local component (e.g. `PermissionResourceRow`)
used by both fieldsets instead of duplicating the JSX twice.

### 2. New "System" fieldset - flat single-CheckField rows

The flat single-`CheckField`-per-row layout being retired from Singletons
above gets reused for a new third fieldset, "System": every admin page that
isn't a content type, one switch each (single `"setting"` action, same
synthetic-resource pattern `PAGE_COMPONENTS_RESOURCE` already established).

Confirmed scope - full non-content-type admin surface:

- Permission management (`system-permission`, already exists - currently
  mis-modeled as `kind: "collection"` giving it 4 actions nothing actually
  reads individually; flip to `kind: "singleton"` so it collapses to one
  toggle like everything else in this section - grep confirmed no route
  branches on view vs create vs update vs delete for this id, only a
  blanket prefix match)
- Page Components (`system-page-components`, already exists, unchanged)
- Media (`system-media`, **new** - currently has NO gating at all, nav item
  has neither `superAdminOnly` nor `permissionName`)
- Icon Management (`system-icon-management`, **new** - currently `superAdminOnly`)
- Custom/Richtext Components (`system-richtext-components`, **new** - currently `superAdminOnly`)
- Content-Type Builder (`system-content-types`, **new** - currently `superAdminOnly`)
- Key Value (`system-key-value`, **new** - currently `superAdminOnly`)
- Settings (`system-settings`, **new** - currently `superAdminOnly`)

**Excluded: AI Keys.** `protectSystemMutation` in
`server/routes/content-entries.ts` already hard-blocks non-super-admins from
creating/updating/deleting `aiKey` rows unconditionally ("AI credential
management is restricted to super administrators") - a System toggle here
would be decorative at best, misleading at worst (grants a nav link that
still 403s on every mutation). Leaving `ai-keys`'s nav item as
`superAdminOnly: true`, untouched. Flag if this reasoning is wrong.

New resource ids live in `content-types/permissions.ts` next to
`PAGE_COMPONENTS_RESOURCE_ID`, exported for reuse across RoleEditor (UI),
the corresponding server route (enforcement), and `DryLayout.tsx` (nav gate).

**Open question to confirm before/while implementing:** should granting any
new `system-*` permission also require super-admin (like the existing
`system-permission`/`role`/`user`/`aiKey` elevation guard in
`protectSystemMutation`, content-entries.ts:127-136)? Default assumption:
no - these are lower-sensitivity operational toggles (Media, Icon
Management, etc.), unlike permission/user/role/credential grants. Leaving
the elevation guard's protected set unchanged unless told otherwise.

### 3. Server-side enforcement for each new System resource

Mirror the exact `PAGE_COMPONENTS_RESOURCE_ID` example
(`server/handler.ts:150-153`: `requirePermission(context, PAGE_COMPONENTS_RESOURCE_ID, "setting")`)
at the route handler(s) backing each new resource:

- Media routes (storage/file routes)
- Icon Management routes
- Richtext Components routes
- Content Types routes (currently likely gated by `requireSuperAdmin` only -
  needs an audit pass per route, not just nav hiding)
- Key Value routes
- Settings routes

Need to locate and audit each route file during implementation - some may
currently have no server-side check at all (Media, per the nav audit above),
relying only on the nav item being hidden, which is not real access control.

### 4. Client-side nav + page guards

In `DryLayout.tsx`'s `NAV` array: replace `superAdminOnly: true` with
`permissionResourceId: SYSTEM_X_ID` for content-types, icon-management,
richtext-components, key-value, settings; add `permissionResourceId:
SYSTEM_MEDIA_RESOURCE_ID` to media (currently has neither).

Each target page component also needs its own guard (mirror
`RoleEditor.tsx`'s `canViewRole` / `Roles.tsx`'s pattern) - hiding the nav
link doesn't stop direct URL navigation.

### 5. Magic button gating - tighten the existing gate, no new entry point

Confirmed: Magic already exists inside `ContentEntryEditor.tsx` (rendered via
`<MagicChat>`, `content-entry-editor/MagicChat.tsx:223`), gated by its
`canEdit` prop. No new List-page Magic entry point - just correct what feeds
that prop.

Today (`ContentEntryEditor.tsx:295-297`):

```
const canEdit = !!type && canAccess(type.id, isSingleton ? "setting" : isNew ? "create" : "update");
```

This `canEdit` also drives the Save button and field editability
(`inert`/line 452) - must NOT change its definition, or a create-only role
loses the ability to create, and an update-only role loses the ability to
edit. Instead add a **separate** `canUseMagic` value used only for the
`<MagicChat>` prop at line 858:

```
const canUseMagic = !!type && (isSingleton
  ? canAccess(type.id, "setting")
  : canAccess(type.id, "create") && canAccess(type.id, "update"));
```

Pass `canUseMagic` (not `canEdit`) to `<MagicChat canEdit={...}>`.

### Explicitly dropped

**JWT embedding of role/permission** - raised mid-conversation, then
withdrawn by the user after seeing the tradeoff (would cap permission
revocation latency at the access-token lifetime, ~15 min, instead of the
current immediate per-request DB resolution that `content-types/access.ts`
documents as a deliberate choice). Not doing this. `resolveAccess` stays as
today - fresh per request, no caching. Do not revisit without the user
raising it again.

## Status

All 5 phases implemented and verified (2026-08-07):

1. **Singleton UI parity** - `RoleEditor.tsx`'s Singletons fieldset now
   shares `renderPermissionResource` with Collections (same `<details>`/
   dots/switches shell, extracted once).
2. **System fieldset** - new third fieldset, flat toggle rows (the layout
   retired from #1), covering `SYSTEM_RESOURCES`: Permission (kind flipped
   collection→singleton), Page Components, Media, Icon Management, Custom
   Components, Content Types, Key Value. AI Keys excluded per the plan's
   reasoning (hardcoded super-admin-only server-side regardless).
   - **Settings turned out not to need a new resource at all** - discovered
     mid-implementation that `systemSettings` is already a real (hidden)
     singleton with working `canAccess`/server enforcement; only its nav
     item was wrong (`superAdminOnly` → `permissionName: "systemSettings"`,
     same mechanism `seo-defaults` already used).
3. **Server enforcement** - `requirePermission(..., "setting")` added at:
   `handler.ts` (icons/richtext-components non-GET, split into their own
   resource ids), `content-types.ts` (POST/PUT/DELETE schema mutations),
   `key-value.ts` (all 3 handlers). GET stays open on all of these (schema
   listing, icon/component rendering) - confirmed via grep that this data is
   consumed app-wide, not just from these features' own admin pages.
   - **Media got no server-side change** - `storage` is shared
     infrastructure (every File/Image field on every content type reads/
     writes through it); gating the route would break unrelated content
     editing. Client-side guard only (nav + page). This is a real gap - a
     role denied System:Media can still hit `/api/storage` directly and
     upload/delete - documented in `permissions.ts`'s `MEDIA_RESOURCE_ID`
     doc comment. **Resolved 2026-08-07 (later same day): user decided not
     needed** - closing the gap properly would mean splitting "browse the
     Media library" from "use storage via a File/Image field," a bigger
     redesign than a quick patch; not worth it unless a role genuinely needs
     to be hard-blocked from all file access, which isn't the current need.
4. **Nav + page guards** - `DryLayout.tsx` NAV updated; client guards added
   to Media, IconManagement, IconSearchAdd, IconManualForm,
   RichtextComponents, BuilderContentType, KeyValue (KeyValue's existing
   `roles.includes("Super Admin")` string-match replaced with
   `canAccess(KEY_VALUE_RESOURCE_ID, "setting")`, fixing a minor pre-existing
   inconsistency with how every other page checks access).
5. **Magic gating** - `ContentEntryEditor.tsx` now computes `canUseMagic`
   (create&&update for collections, setting for singletons) separately from
   `canEdit`, passed to `<MagicChat>`. Renamed that prop `canEdit` →
   `canUse` in `MagicChat.tsx` since its meaning diverged from the page's
   own `canEdit` (single caller, safe rename).

Verification: `bun run typecheck` clean; `bun run test` - 88 files / 933
tests passed, nothing broken.

**Not done, by explicit user decision**: JWT-embedded role/permissions
(dropped after tradeoff discussion - see "Explicitly dropped" above).

**Resolved 2026-08-07 (later same day)**: whether granting a new `system-*`
permission should also require super-admin, per `protectSystemMutation`'s
existing elevation guard (content-entries.ts:127-136) - user decided **not
needed**. These are lower-stakes operational toggles than role/user/aiKey,
and whoever can already edit a Role is a trusted admin. Elevation guard's
protected set stays as-is (role/user/aiKey/system-permission only) -
closed, not just deferred.

## Speed

Planned and fully implemented in one session (2026-08-07).

## Addendum: explicit `magic` permission (2026-08-07, same day)

Follow-up request: Magic shouldn't be a _derived_ gate (create&&update /
setting) - it needed to be its own explicit, stored per-resource grant, for
every collection AND every real singleton (not the synthetic System
resources - none of those have a Magic feature).

- `content-types/permissions.ts` - `PERMISSION_ACTIONS` gained `"magic"`;
  `permissionActionsFor` now appends it for both collection and singleton
  (still `[]` for component). System resources never call
  `permissionActionsFor` (their System-fieldset rendering hardcodes
  `"setting"` directly), so they don't sprout a Magic toggle.
- `RoleEditor.tsx` - generalized the old hardcoded "View gates
  Create/Update/Delete" rule into `permissionPrerequisites(resource,
action)`: returns which OTHER action(s) must be granted first (OR
  semantics). `magic`'s prerequisite is `["create","update"]` for a
  collection, `["setting"]` for a singleton - the switch renders disabled
  until satisfied. `togglePermission` replaced its one-off "turning off View
  clears everything" branch with a general fixed-point cascade: after any
  toggle, repeatedly drop any granted action whose prerequisite no longer
  holds (so turning off both Create and Update also drops Magic, same as
  turning off View already dropped everything).
- `ContentEntryEditor.tsx` - `canUseMagic` simplified to
  `canAccess(type.id, "magic")` directly (previously derived from
  create&&update/setting - now that derivation only decides whether the
  Role editor lets `magic` be turned ON, not whether it's granted).
- `ai-magic-write.ts` - the server-side `checkAccess` call (line ~314,
  `streamMagicWrite`) now checks `"magic"` instead of `update`/`setting` -
  this is the authoritative enforcement point, covering both regular Magic
  turns and RichText "Rewrite selection" (same endpoint).
- `permissions.test.ts` updated for the new expected action lists.

**Closed 2026-08-07 (later same day)**: the RichText "Rewrite selection"
inline button (`AiRewriteButton`, via `rewriteApi.ready` in
`ContentEntryEditor.tsx`) was gated only on `aiKey.ready`, not
`canUseMagic`. Fixed - `rewriteApi`'s `useMemo` (and the doc comment
explaining it) moved down to right after `canUseMagic` is computed (it
needs `type`, declared later in the component than the useMemo's old
position, hence the move rather than a same-spot edit); `ready` is now
`aiKey.ready && canUseMagic`, deps `[aiKey.ready, canUseMagic]`. Both Magic
entry points (the chat bubble and Rewrite-selection) now render
consistently with the same `magic` grant. `bun run typecheck` clean,
88 files / 933 tests still pass.

## Addendum: Key Value removed entirely (2026-08-07, same day)

User call: the whole Key Value admin feature ("UI và code liên quan") was
unnecessary - removed rather than kept as a System permission. Deleted:

- `src/pages/KeyValue.tsx`, `src/server/routes/key-value.ts` (whole files)
- Its `App.tsx` route + lazy import, `DryLayout.tsx` NAV entry,
  `handler.ts`'s `API_ROUTES` registration
- `KEY_VALUE_RESOURCE_ID` (`permissions.ts`) and `KEY_VALUE_RESOURCE`
  (`RoleEditor.tsx`'s `SYSTEM_RESOURCES` - now 6 entries, not 7)
- Its `/key-value` entry in `page-guard.ts`'s `AUTHENTICATED_PAGES` (now
  empty - `guardPageRequest`/its 3 call sites in `entry-node.ts`/
  `entry-worker.ts`/`dev-server.mjs` were left in place as reusable
  general-purpose infrastructure, not deleted just because their one
  configured path went away)
- The `KeyValue` icon - removed at its actual source (`icons.config.json`),
  then regenerated via `bun run build:icons` rather than hand-editing the
  generated `components/icons/index.tsx`

**Deliberately NOT touched**: `src/kv/*` (the underlying store engine) and
everything in `server/auth-security.ts` that depends on it (session
revocation/blacklist, login rate limiting) - confirmed via
`codegraph_explore` that `auth-security.ts` builds its own `KeyValueStore`
independently of `routes/key-value.ts`, so it was never affected by this
route's existence and isn't affected by its removal. See
`status/key-value-system.md`'s own 2026-08-07 update for the fuller
rationale. `kv/kv.test.ts` (tests the engine, not the removed route) is
untouched and still passes.

Verification: `bun run typecheck` clean; `bun run test` - all files/tests
still passing after removal (see below for the exact count at time of
verification).

## Addendum: `system-vei` permission for the Visual Editing Interface (2026-08-07, same day)

VEI (`status/vei.md`) had no permission gate at all - any signed-in admin,
regardless of role, could enter edit mode on the public site (per-content-type
`update`/`setting` grants already limited what they could then actually
_edit_, via `resolveVeiContext.canUpdate`, but not whether they could open the
overlay in the first place). Added a 7th `SYSTEM_RESOURCES` entry, same
synthetic-singleton pattern as the others:

- `permissions.ts` - `VEI_RESOURCE_ID = "system-vei"`.
- `RoleEditor.tsx` - `VEI_RESOURCE` ("Visual Editing"), pushed onto
  `SYSTEM_RESOURCES`; renders as the same flat `setting` toggle the System
  fieldset already gives every other entry, no new UI code.
- `vei-routes.ts`'s `handleVeiRoute` - real server-side gate: after minting
  the `drycms_vei` token (or refreshing an expired access cookie to get one),
  decodes it back to the admin's `id`/`name`/`email` and calls
  `resolveAccess(...).can(VEI_RESOURCE_ID, "setting")` before ever setting the
  cookie; a `false` result 403s instead of granting edit mode. This is the
  one enforcement point that actually matters, since it's the boundary that
  issues the capability.
- `routes/auth.ts`'s `withSessionCookies` (all 4 call sites: register-first-
  admin, login, refresh, update-profile) now only sets the public
  `drycms_admin` hint cookie when `user.isSuperAdmin ||
user.permissions.includes(permissionKeyFor(VEI_RESOURCE_ID, "setting"))` -
  otherwise it explicitly clears it. This is UI-only (the cookie is
  non-`HttpOnly`, readable/forgeable by the visitor's own browser), but it's
  what keeps `apps/vei/overlay.ts`'s "Edit" button from ever being offered to
  someone who'd just get a 403 from the real gate above.

New tests in `vei-routes.test.ts`: a non-super-admin role with no `system-vei`
grant gets 403 on `/vei/enter` (no `Set-Cookie` at all); the same role with
the grant added gets the normal 303 + `drycms_vei` cookie. `bun run
typecheck` clean, `bun run test` - 88 files / 935 tests pass (2 new), `bun
run build` (client + SSR) passes.
