# Role/Permission setup — Singleton UI parity, System toggles, Magic gating

## Plan

Five independent-ish pieces, confirmed with the user (2026-08-07):

### 1. Singleton section in RoleEditor → same UI as Collections
`RoleEditor.tsx`'s "Singletons" fieldset currently renders one flat
`CheckField` per singleton (lines ~392-420). Change it to the same
`<details>`/summary-dots/switches-panel pattern the "Permissions"
(collections) fieldset already uses (lines ~340-390). `permissionActionsFor`
already returns `["setting"]` for a singleton, so the switches panel will
just have one switch — only the wrapper markup changes. Extract the shared
`<details>` block into one small local component (e.g. `PermissionResourceRow`)
used by both fieldsets instead of duplicating the JSX twice.

### 2. New "System" fieldset — flat single-CheckField rows
The flat single-`CheckField`-per-row layout being retired from Singletons
above gets reused for a new third fieldset, "System": every admin page that
isn't a content type, one switch each (single `"setting"` action, same
synthetic-resource pattern `PAGE_COMPONENTS_RESOURCE` already established).

Confirmed scope — full non-content-type admin surface:
- Permission management (`system-permission`, already exists — currently
  mis-modeled as `kind: "collection"` giving it 4 actions nothing actually
  reads individually; flip to `kind: "singleton"` so it collapses to one
  toggle like everything else in this section — grep confirmed no route
  branches on view vs create vs update vs delete for this id, only a
  blanket prefix match)
- Page Components (`system-page-components`, already exists, unchanged)
- Media (`system-media`, **new** — currently has NO gating at all, nav item
  has neither `superAdminOnly` nor `permissionName`)
- Icon Management (`system-icon-management`, **new** — currently `superAdminOnly`)
- Custom/Richtext Components (`system-richtext-components`, **new** — currently `superAdminOnly`)
- Content-Type Builder (`system-content-types`, **new** — currently `superAdminOnly`)
- Key Value (`system-key-value`, **new** — currently `superAdminOnly`)
- Settings (`system-settings`, **new** — currently `superAdminOnly`)

**Excluded: AI Keys.** `protectSystemMutation` in
`server/routes/content-entries.ts` already hard-blocks non-super-admins from
creating/updating/deleting `aiKey` rows unconditionally ("AI credential
management is restricted to super administrators") — a System toggle here
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
no — these are lower-sensitivity operational toggles (Media, Icon
Management, etc.), unlike permission/user/role/credential grants. Leaving
the elevation guard's protected set unchanged unless told otherwise.

### 3. Server-side enforcement for each new System resource
Mirror the exact `PAGE_COMPONENTS_RESOURCE_ID` example
(`server/handler.ts:150-153`: `requirePermission(context, PAGE_COMPONENTS_RESOURCE_ID, "setting")`)
at the route handler(s) backing each new resource:
- Media routes (storage/file routes)
- Icon Management routes
- Richtext Components routes
- Content Types routes (currently likely gated by `requireSuperAdmin` only —
  needs an audit pass per route, not just nav hiding)
- Key Value routes
- Settings routes

Need to locate and audit each route file during implementation — some may
currently have no server-side check at all (Media, per the nav audit above),
relying only on the nav item being hidden, which is not real access control.

### 4. Client-side nav + page guards
In `DryLayout.tsx`'s `NAV` array: replace `superAdminOnly: true` with
`permissionResourceId: SYSTEM_X_ID` for content-types, icon-management,
richtext-components, key-value, settings; add `permissionResourceId:
SYSTEM_MEDIA_RESOURCE_ID` to media (currently has neither).

Each target page component also needs its own guard (mirror
`RoleEditor.tsx`'s `canViewRole` / `Roles.tsx`'s pattern) — hiding the nav
link doesn't stop direct URL navigation.

### 5. Magic button gating — tighten the existing gate, no new entry point
Confirmed: Magic already exists inside `ContentEntryEditor.tsx` (rendered via
`<MagicChat>`, `content-entry-editor/MagicChat.tsx:223`), gated by its
`canEdit` prop. No new List-page Magic entry point — just correct what feeds
that prop.

Today (`ContentEntryEditor.tsx:295-297`):
```
const canEdit = !!type && canAccess(type.id, isSingleton ? "setting" : isNew ? "create" : "update");
```
This `canEdit` also drives the Save button and field editability
(`inert`/line 452) — must NOT change its definition, or a create-only role
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
**JWT embedding of role/permission** — raised mid-conversation, then
withdrawn by the user after seeing the tradeoff (would cap permission
revocation latency at the access-token lifetime, ~15 min, instead of the
current immediate per-request DB resolution that `content-types/access.ts`
documents as a deliberate choice). Not doing this. `resolveAccess` stays as
today — fresh per request, no caching. Do not revisit without the user
raising it again.

## Status

All 5 phases implemented and verified (2026-08-07):

1. **Singleton UI parity** — `RoleEditor.tsx`'s Singletons fieldset now
   shares `renderPermissionResource` with Collections (same `<details>`/
   dots/switches shell, extracted once).
2. **System fieldset** — new third fieldset, flat toggle rows (the layout
   retired from #1), covering `SYSTEM_RESOURCES`: Permission (kind flipped
   collection→singleton), Page Components, Media, Icon Management, Custom
   Components, Content Types, Key Value. AI Keys excluded per the plan's
   reasoning (hardcoded super-admin-only server-side regardless).
   - **Settings turned out not to need a new resource at all** — discovered
     mid-implementation that `systemSettings` is already a real (hidden)
     singleton with working `canAccess`/server enforcement; only its nav
     item was wrong (`superAdminOnly` → `permissionName: "systemSettings"`,
     same mechanism `seo-defaults` already used).
3. **Server enforcement** — `requirePermission(..., "setting")` added at:
   `handler.ts` (icons/richtext-components non-GET, split into their own
   resource ids), `content-types.ts` (POST/PUT/DELETE schema mutations),
   `key-value.ts` (all 3 handlers). GET stays open on all of these (schema
   listing, icon/component rendering) - confirmed via grep that this data is
   consumed app-wide, not just from these features' own admin pages.
   - **Media got no server-side change** — `storage` is shared
     infrastructure (every File/Image field on every content type reads/
     writes through it); gating the route would break unrelated content
     editing. Client-side guard only (nav + page). This is a real gap - a
     role denied System:Media can still hit `/api/storage` directly and
     upload/delete - accepted as out of scope for this pass, documented in
     `permissions.ts`'s `MEDIA_RESOURCE_ID` doc comment.
4. **Nav + page guards** — `DryLayout.tsx` NAV updated; client guards added
   to Media, IconManagement, IconSearchAdd, IconManualForm,
   RichtextComponents, BuilderContentType, KeyValue (KeyValue's existing
   `roles.includes("Super Admin")` string-match replaced with
   `canAccess(KEY_VALUE_RESOURCE_ID, "setting")`, fixing a minor pre-existing
   inconsistency with how every other page checks access).
5. **Magic gating** — `ContentEntryEditor.tsx` now computes `canUseMagic`
   (create&&update for collections, setting for singletons) separately from
   `canEdit`, passed to `<MagicChat>`. Renamed that prop `canEdit` →
   `canUse` in `MagicChat.tsx` since its meaning diverged from the page's
   own `canEdit` (single caller, safe rename).

Verification: `bun run typecheck` clean; `bun run test` — 88 files / 933
tests passed, nothing broken.

**Not done, by explicit user decision**: JWT-embedded role/permissions
(dropped after tradeoff discussion — see "Explicitly dropped" above).

**Open item nobody has confirmed yet**: whether granting a new `system-*`
permission should also require super-admin, per `protectSystemMutation`'s
existing elevation guard (content-entries.ts:127-136). Shipped as-is
(unchanged/not extended) per the plan's stated default assumption — revisit
if that assumption is wrong.

## Speed

Planned and fully implemented in one session (2026-08-07).
