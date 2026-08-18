# Full reset ("Reset everything")

## Plan

Two separate asks from the user:

1. Content-history git-mirror ("log lưu content") appears not to be firing -
   investigate.
2. Upgrade `GithubSyncSettings.tsx`'s existing "Reset All page" button into a
   real "reset everything" action: content database back to the built-in
   default types with no data EXCEPT the currently signed-in admin's own
   account, every uploaded media file deleted, pages-source/build state back
   to the mock starter, and the browser's IndexedDB/caches cleared. Gated by
   a typed `RESET-<random-6-char-token>` confirmation (not a plain Yes/No),
   with a live per-step progress dialog while it runs.

## Status

- (2) Implemented and typechecked/unit-tested clean (`bun run typecheck`,
  `bun run test` - 150 files/1448 tests). NOT yet exercised live against a
  real `.dry/content.sqlite` - this is destructive to the running dev
  tenant's real data, so it needs the user's own live click-through (or
  explicit go-ahead + a `GET /api/backup` safety snapshot first) before
  calling it verified.
  - `src/content-types/engine/sqlite.ts`: extracted the first-boot
    metadata/`_versions`/default-seed sequence into an exported
    `bootstrapDefaultContentSchema(handle)`, reused both by `getHandle()`
    (unchanged behavior) and the new reset route (run against a throwaway
    `:memory:` handle to produce a genuine fresh-boot dump).
  - `src/content-types/engine/backup.ts`: exported `sqlLiteral` (was
    private) so the new route can hand-build 2 extra `INSERT`s with the same
    escaping `buildSqlDump` uses.
  - `src/server/routes/full-reset.ts` (new): `PUT .../full-reset/content`
    drops every real table and replays a `buildSqlDump` of the throwaway
    fresh-boot database (via the existing `restoreFromDump` primitive
    `routes/backup.ts`'s restore already uses - same atomicity/D1-recovery
    for free), then re-inserts the calling admin's own `user` row verbatim
    (same `id` - keeps the live session cookie valid, no forced re-login;
    `avatar` cleared since `PUT .../full-reset/media` wipes `storage`) plus a
    `user_roles` membership in the freshly-seeded "Super Admin" role.
    Also explicitly recreates `_pages`/`_page_deps` (empty) - those tables
    live in the same physical DB but are bootstrapped by
    `pages-registry-{sqlite,d1}.ts`'s OWN once-per-process/isolate
    `CREATE TABLE IF NOT EXISTS`, which would never notice this route
    dropped them out from under it otherwise.
    `PUT .../full-reset/media` wipes the whole `storage` (media) root, same
    "remove each root entry recursively" shape `github-sync.ts`'s PUT
    already uses. Both self-gate on `requireSuperAdmin` (no dispatcher-level
    check, no Role toggle - same precedent as `backup`/`storage-backup`).
  - `src/server/handler.ts`: registered `"full-reset"`.
  - `src/components/FullResetDialog.tsx` (new): the typed-confirmation +
    live progress-checklist dialog. Sequence: `full-reset/content` →
    `full-reset/media` → existing `github-sync` PUT (pages-source reset +
    best-effort git push - now naturally a no-op push since `githubSync`'s
    own row was just wiped, matching "reset everything") + re-fetch fresh
    content types + `publishAllPages` → clear the app's 6 known IndexedDB
    databases. Reloads the page on success.
  - `src/pages/GithubSyncSettings.tsx`: swapped the old `ConfirmDialog`+
    `resetAllPages()` for `FullResetDialog`; section now gated on
    `authState.value.user?.isSuperAdmin` (was previously reachable by
    anyone with the `githubSync` "setting" grant, too broad for something
    this destructive).
- (1) Investigated by reading, not live-reproduced: `githubSync` IS
  configured for this tenant (gitlab, `thanhkhan2k/drycms-storage`,
  `drycms-dev` branch, token present) - so the "not configured, no-op by
  design" explanation does NOT apply here. Write path
  (`content-history.ts`'s POST → `entry-git-sync.ts`'s
  `syncEntryDraftToGit`/`syncSchemaChangesToGit`) and read path
  (`ContentHistoryDialog.tsx` → `content-history-http-api.ts` → same route's
  GET) both read as correctly wired from the code alone. Only `menu` has any
  actual entry data right now (1 row) among the git-mirror-eligible types
  (`redirect`/`seoDefaults`/`systemSettings` are empty) - never reproduced
  live (would need a real save + checking History, which needs the user's
  own click-through or fresh working dev credentials - the ones in memory
  are stale). Unresolved.

## Speed

Single session, 2026-08-18. (2) is code-complete; (1) needs a live repro
session to make any further progress - blocked on that, not on more code
reading.
