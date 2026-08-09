# Rebuild-on-save + unify schedule + merge Page Builder permission (2026-08-09/10)

## Plan

Three related changes to the app-r2 build pipeline, requested after a chat
walkthrough of `/dry/page-build` vs `/dry/page-editor`'s overlapping "Build"
buttons:

1. Auto-rebuild pages that depend on a content type right after an ordinary
   (non-VEI) collection/singleton entry Save succeeds - today only VEI's
   `saveAll()` does this; the plain `ContentEntryEditor.tsx` Save button
   didn't.
2. Unify the two independent "schedule publish" mechanisms into one - drop
   the page-level `publishAt`/staged-build concept (`/dry/page-build`'s
   "Schedule for later"), keep only the entry-level `features.schedule`
   date-field gate (`entry-where.ts`'s `buildPublishedOnlyClause`).
3. Merge the `system-code` (Page Code Editor) and `system-build` (Page
   Build) permissions into one `PAGE_BUILDER_RESOURCE_ID` ("Page Builder") -
   in practice nobody was ever granted one without the other.

## Status: DONE, typecheck + full test suite clean

### 1. Permission merge
- `content-types/permissions.ts`: `PAGE_BUILDER_RESOURCE_ID` replaces both
  `CODE_EDITOR_RESOURCE_ID`/`SYSTEM_BUILD_RESOURCE_ID`, keeping the
  `"system-build"` string value on purpose - anyone already granted Page
  Build isn't silently locked out by the merge.
- Updated: `server/handler.ts` (all 3 gate checks), `pages/RoleEditor.tsx`
  (one `PAGE_BUILDER_RESOURCE` toggle instead of two), `components/
  DryLayout.tsx` (both nav items - Page Build AND Page Editor stay separate
  ROUTES, just share the one permission), `pages/PageEditor.tsx`, `pages/
  PageBuild.tsx`, `server/routes/pages-source.ts`, `server/routes/
  pages-source-github-sync.ts` doc comments, `plans/app-r2.md`'s decision
  log (annotated, not rewritten).

### 2. Schedule unification
- Removed entirely: `PageRecord.publishAt`, `PagesRegistryAdapter.
  listDueForPublish`/`nextPublishAt`/`getPage`/`markPublished` (both sqlite
  + d1 adapters, DDL no longer writes `publish_at` on a fresh DB - an
  EXISTING local db keeps the unused column, harmless), `page-handler.ts`'s
  lazy request-time promotion branch, `built-pages-storage.ts`'s
  `publishImmutableObject` + `writeBuiltPage`'s `publishNow` option (always
  publishes live now), `PublishOptions.publishAt`, `sitemap.ts`'s
  `sitemapEdgeCacheTtlSeconds` (replaced by a flat `SITEMAP_EDGE_TTL_SECONDS`
  constant), `PageBuild.tsx`'s whole "Publish schedule" card + `scheduled`
  status.
- Kept unchanged: `features.schedule` (entry-level date field),
  `buildPublishedOnlyClause` (entry-where.ts).
- **Known, accepted gap**: a statically-built page is frozen HTML - once
  `features.schedule`'s date passes, nothing automatically rebuilds the page
  to reveal the now-published entry. Mitigated in practice by #1 below (any
  OTHER save of that resource triggers a rebuild), but a schedule date
  passing with no further edits needs a manual `/dry/page-build` click.
  Flagged to the user; no cron/sweep added back to cover it (that's exactly
  the mechanism just removed).

### 3. Rebuild-on-save
- New `page-components/rebuild-affected-pages.ts`: given `(adminPath,
  typeName, allTypes, onStatus?)`, looks up affected paths via the existing
  `?byResource=` endpoint (`routes/pages-build.ts`'s `handleByResource` -
  same one VEI's `overlay.ts`'s `rebuildAffectedPages` already uses), then
  builds+publishes each in-process using the same low-level primitives
  `PageEditor.tsx` already calls (`buildPage`/`publishBuiltPage`/
  `resolveAllPageTargets` from `page-build.ts`). `page-build.js` is
  dynamic-imported (not static) so its Sucrase/Tailwind weight is only ever
  fetched on a save that actually has affected pages - not on every entry
  form's initial load. Never throws; permission-gated on the same merged
  `PAGE_BUILDER_RESOURCE_ID`.
- Wired into `ContentEntryEditor.tsx`'s `handleSave`, in `finally`, gated on
  `saved && !veiFrame` (VEI's own `saveAll()` already does this itself,
  batched - doing it here too would double-build). UX: a "loading" toast on
  start, updated in place to the final count on completion (user's choice).

## Speed

All 3 parts done in one session. Typecheck clean throughout; full
`bun run test` clean except 1 pre-existing, unrelated failure
(`sitemap.test.ts`'s "includes every static page from the real route tree"
- confirmed via `git stash` to already fail before this session's changes,
likely `src/apps/pages`'s disposable materialized copy missing a `blogs/`
directory in this checkout).

**Not done**: no vitest test for `rebuild-affected-pages.ts` itself - it
reads `window.location`/`canAccess` (browser-only), and this repo's
established convention is that `window`-coupled page-components glue isn't
unit-tested (no test env override exists; `page-build.ts` itself is
deliberately written to avoid `window` so it CAN be tested headlessly - see
its own doc comment). Interactive QA of the rebuild-on-save path (open an
entry that's a real page dependency, Save, confirm the toast + a rebuilt
page) is still pending - no browser tool was used this session.
