# VEI: move from server SSR to fully client-side render

## Plan

See `/Users/kcoder/.claude/plans/humming-brewing-squid.md` for the full
approved design. Summary: a VEI session no longer takes the server's
live-SSR pipeline at all. `page-handler.ts` either splices the VEI overlay
+ live-render scripts into the cached `built/live/*` HTML (fast path) or
serves a minimal shell (no route match attempted server-side) when nothing
is cached. `src/apps/vei-live-refresh.ts` expands to resolve routing
(`listAllFilesRecursive` + `buildManifestRouteTree`/`matchSourceRoute`,
all pre-existing/portable) AND render (existing `evalModule`/
`resolveMatchToVNode`/`hydrate()` pipeline) entirely client-side, including
the true-404 case. The one real gap: `dry-reader-http.ts`'s client `dry()`
never produced real edit markers (by design, for the build/preview use
case) - extended with an optional `vei` context so a never-server-rendered
page can still be click-to-edited.

Supersedes/removes the earlier same-session stopgap fix (readBuiltPage
fallback inside the live-SSR branch for a VEI route-tree miss).

## Status

Code + tests complete. `bun run typecheck` clean, full suite
135 files / 1350 tests passing.

Files changed:
- `src/server/page-handler.ts` - new VEI branch (splice cache-hit /
  shell-miss), dropped `resolveVeiContext`
- `src/server/app-router/render.ts` - dropped `veiLiveManifest`, added
  `spliceVeiScripts`/`buildVeiShellDocument`
- `src/server/app-router/build-document.ts` - `hydrateEntryHref` can now be
  `""` to omit the script tag (shell document)
- `src/server/app-router/route-manifest.ts` - new `notFoundRoute` export
- `src/content-types/dry-populate.ts` - `markRecord`'s context param
  loosened to a structural type
- `src/content-types/dry-reader-http.ts` - new `vei?` config field +
  `markOrInert`, real boxing when a VEI session is present
- `src/server/handler.ts` - dispatcher's `context.session` now falls back
  to a VEI session (`resolveVeiSession`) when the real admin session
  expired - fixes public-page reads (`dry-http`/`content-types`/
  `pages-source`) during a long VEI browse
- `src/server/csrf.ts` - `dry-http` exempted from CSRF (a read despite
  being POST; a public page can't satisfy CSRF anyway)
- `src/apps/vei-live-refresh.ts` - full rewrite: resolves routing
  (`listAllFilesRecursive` + `buildManifestRouteTree`/`matchSourceRoute`)
  AND renders (existing eval pipeline), including true-404, entirely
  client-side
- Tests: `page-handler.test.ts` (replaced 2 stopgap tests with 3 new VEI
  ones), `route-manifest.test.ts` (+3), `render.test.ts` (+3),
  `dry-reader-http.test.ts` (new file, +6)

## Speed

Plan approved after 3 Explore-agent passes + direct verification
(preact-iso hydrate() source, dry-reader.ts list() marking parity,
build-document.ts exports). One Plan-agent validation pass was cut off by
a session-limit error mid-run; proceeded on direct-verification confidence
instead of re-running it. During implementation, found and fixed a real
gap the plan hadn't fully resolved: `dry-http`/`content-types`/
`pages-source` all require `context.session`, which a VEI-only browse
(real admin session expired) can't provide from a public page - fixed at
the `handler.ts` dispatcher level (VEI-session fallback) rather than
patching each route.

**DB fix** (user-approved 2026-08-14): root cause wasn't actually
`_versions` (that table's schema was already correct on disk) - it was
`superAdminSeedStatement()`'s `INSERT INTO "role" ... ON CONFLICT("name")`
hitting a `role` table with NO unique index on `name` at all. Broader
sweep found the SAME drift on 3 more tables (unique per the content-type
schema, but no real DB index): `user.email`, `menu.name`,
`redirect.from`. Checked all 4 columns for actual duplicate values first
(none), backed up `.dry/content.sqlite`, then added the 4 missing
`CREATE UNIQUE INDEX "ux_<table>_<col>"` (naming matches
`migration.ts`'s own `uniqueIndexName` convention exactly) - no row data
touched. `bun run dev` now boots clean, `GET /` returns 200.

**Live verification** (Playwright, `bun run dev`, real signed-in admin
session in the browser): confirmed end-to-end.
- Clicked "Edit content" on `/` (no built cache for this path) -> got the
  bare shell (`hasHydrateClient: false`, `hasIsodata: false`), Dock showed
  Dashboard/Save/Exit (real `edit:true` picked up), body rendered the
  REAL page content ("Welcome to drycms...") - proves
  `vei-live-refresh.ts` did a genuine fresh client-side render with no
  server SSR at all. Network log showed `/api/auth/session`,
  `/api/pages-source` (+ per-folder recursion), `/api/content-types`, and
  `/api/pages-source/pages/page.tsx` all returning 200 - the whole new
  client pipeline (permission resolution, route-tree build, source fetch)
  working with zero 401/403s, confirming the `handler.ts`
  session-fallback + `dry-http` CSRF-exemption fixes actually work in
  practice, not just in theory.
- Navigated directly to a genuinely nonexistent path while still in VEI -
  got the SITE'S REAL `404.tsx` ("Page not found" / "doesn't exist or may
  have been moved" / "Back to home"), VEI Dock still present - the
  true-404 case resolved entirely client-side, no server route match
  involved. (Only console noise: expected 404s from `collectClosure`'s
  own candidate-path probing, e.g. trying `component/Button` before
  `component/Button.tsx` - benign, pre-existing behavior of the reused
  function, not a new bug.)
- Exit round-tripped cleanly back to the anonymous view.
- Did NOT get to click-to-edit a real `dry()`-bound field live (this
  DB's root `page.tsx` is the static shadcn-starter placeholder with no
  bound fields) - covered instead by `dry-reader-http.test.ts`'s 6 direct
  unit tests of the real-vs-inert boxing logic itself.
- Did not exercise the cache-hit splice path live (would need a real
  `/dry/page-build` run against shared DB state) - covered by
  `render.test.ts`'s `spliceVeiScripts` tests and
  `page-handler.test.ts`'s cache-hit VEI test instead.

Implementation + verification complete.
