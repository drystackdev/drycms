# app-r2 build (plans/app-r2.md) - Giai đoạn 1/2/4 core + mục 10/13

## Plan

After the spike (`status/app-r2-spike.md`) confirmed Giai đoạn 1/2 were
unblocked, user said "bắt đầu làm tất cả đi" - build as much of the
unblocked plan as possible in one pass. Explicitly OUT of scope from the
start (communicated before starting): mục 6 (Tailwind per-page CSS - the
spike left this genuinely unresolved, needs a live browser run), mục 7
(hydration polish), mục 11 (full UI Build admin page), Giai đoạn 6's
in-browser code editor. Everything else attempted.

**Working principle adopted mid-session, not in the original plan text**:
build every new capability as REAL, TESTED code, but do not flip any
EXISTING live-serving behavior (`page-handler.ts`'s read path,
`sitemap.ts`'s live handler, `route-tree.ts`'s `discoverRoutes()`) over to
the new pipeline. Reason: this app has a real deployed site
(`sivelap`) - flipping page-handler.ts to "cache-only, 404 on miss" or
sitemap.ts to read `_pages` before ANY page has been built through the new
pipeline would 404/empty the live site the moment it's deployed. Every new
piece below is additive and dark until a human deliberately wires it in,
same as the spike's own harness was dark.

## Status: DONE (this pass) - see per-item detail below

### Built, tested, wired into the request/deploy path

- **`_pages`/`_page_deps` registry** - dual engine (SQLite: `pages-registry-sqlite.ts`,
  D1: `pages-registry-d1.ts`), same bootstrap-per-engine precedent as
  `_versions`. Wired into `getContentAdapters()` as `.pagesRegistry` -
  reachable everywhere `.schema`/`.entries` already are. 8 tests.
- **`dry()` HTTP reader** (mục 3) - `dry-reader-http.ts` (browser) +
  `routes/dry-http.ts` (server, wired into `handler.ts`, gated
  `system-build`). Reuses the REAL `dry-reader.ts` unmodified server-side;
  published-only by omission (no code path honors a draft request). Also
  replicates `recordSeoLayer`'s entry/singleton-driven SEO auto-population
  (`reader.md`'s "tự động đọc") - a correctness detail not in the plan text,
  found while building this. 4 tests.
- **`buildDocument()` extraction** (mục 2) - new `build-document.ts`, free of
  `config.ts`/`dry-context.ts` VALUE imports (confirmed browser-portable).
  `render.ts`'s `renderPage` refactored to import the shared pieces instead
  of keeping its own copies - **zero behavior change**, all 9 existing
  `render.test.ts` cases pass unchanged.
- **Browser build orchestrator** (mục 7's compile step) - `page-build.ts`.
  Extends the spike's allowlist-eval approach; `dry`/`params`/`setTitle`/
  `dryBind` resolve via `new Function` parameters (ambient globals have no
  import statement to rewrite), `preact`/`preact/hooks` via a `require()`
  allowlist. 5 tests, including one exercising ALL FOUR ambient globals +
  an explicit `preact/hooks` import + nested layout together, on REAL
  `resolveMatchToVNode`/`buildDocument` - not stubbed. Found and fixed a
  real bug while writing it: real page source uses `.js`-suffixed relative
  imports (this repo's own convention), which the copied resolution
  algorithm didn't strip before trying `.tsx`/`.ts` candidates.
- **`dry-title-http.ts`** - `setTitle()`'s 3rd variant. Necessary because
  the hydration variant (`dry-title-client.ts`) writes straight to
  `document.title`, NOT into the `seo.page` cascade tier `buildDocument`
  reads - reusing it here would have silently dropped every `setTitle()`
  call from a built page's `<title>`. Found while wiring the orchestrator,
  not anticipated in the plan.
- **Raw-HTML storage** (mục 12's write side) - `built-pages-storage.ts`:
  `liveKeyFor`/`immutableKeyFor` under `pagesCacheStorage`'s root, prefixed
  `built/` so they can never collide with the OLD envelope cache's bare
  `<path>.json` keys (that cache is untouched, still serving the live
  site). `writeBuiltPage`/`publishImmutableObject`/`readBuiltPage`/
  `removeBuiltPage`.
- **`routes/pages-build.ts`** - POST (build+register) / GET (read back,
  bypassing the still-dark public path) / DELETE. Gated `system-build`.
- **`routes/pages-source.ts`** - GET-only read of the new `pagesSource`
  storage root (see below). No write methods - Giai đoạn 6's editor isn't
  built, adding write here now would be a real capability with nothing
  reviewing it.
- **New storage option: `pagesSource`** (`options.ts`/`config.ts`) -
  `src/apps/pages/**`'s eventual storage-backed root (quyết định #6),
  mirroring `pageComponents`/`typesCache`'s exact existing pattern.
  Prerequisite for `scripts/sync-pages-r2.ts` and the route manifest, which
  the plan hadn't separately called out as a gap.
- **`scripts/sync-pages-r2.ts`** (mục 13) - `bun run pages:sync --push`/
  `--pull [--remote|--local]`. Never overwrites an existing destination
  file, either direction. Local-disk push mode **actually run** against this
  repo (safe - `.dry/pages-source/` is gitignored): first run copied 4
  files, second run correctly skipped all 4. R2 push (`--remote`/`--local`)
  shells out to `wrangler r2 object put/get`, same credential reuse
  `r2-sync-assets.ts` already established - **not run against a real
  bucket**. R2 `pull`'s `wrangler r2 object list` output parsing is the
  single least-verified piece of this whole session - flagged in the
  script's own doc comment.
- **`types-cache` fixes** (mục 10) - `writeGeneratedDryTypes` no longer
  imports `node:fs/promises` at module scope (would break on a Workers
  isolate); disk write is now a best-effort branch behind a runtime check.
  Trigger added: `routes/content-types.ts` regenerates+pushes to
  `types-cache` storage after every schema mutation that actually commits
  (batch apply, single save, delete) - previously only ran on
  dev-server startup / a manual script, meaning prod's copy was frozen at
  deploy time. `routes/types-cache.ts` - new GET read route.
- **Permissions** - `system-code` (Giai đoạn 6, no route yet - added now so
  naming is settled) + `system-build` (gates `dry-http`/`pages-build`),
  both wired into `RoleEditor.tsx`'s System fieldset per quyết định #12.
- **Sitemap registry function** (mục 8) - `buildSitemapResponseFromRegistry`
  in `sitemap.ts`, dark (not called from `page-handler.ts`). Reads `_pages`
  instead of looping collection entries; fixes the ORIGINAL function's
  documented "a static page's own noIndex isn't reflected" limitation for
  free (the page was actually rendered by the time a row exists). `siteNoIndex`
  still a live singleton read, per mục 8's own text. 3 tests.
- **Edge-cache TTL split** (mục 14) - `isEdgeCacheable`/`storeEdgeCache`
  both gained an optional trailing `ttlSeconds` param; omitted = byte-identical
  to the original behavior (11 pre-existing tests still pass unchanged), so
  this shipped live with zero risk. `sitemapEdgeCacheTtlSeconds()` added to
  `sitemap.ts` (24h default, capped to the next `_pages.publish_at` if
  sooner) - not called from anywhere live yet, since nothing calls the dark
  sitemap function yet either. 5 new tests total across both files.
- **Cron flip** (mục 9) - `schedule-flip.ts`'s `runScheduledFlip` (pure,
  tested with a real immutable-key write + real flip, not mocked) + `entry-worker.ts`'s
  new `scheduled` export + `wrangler.jsonc`'s `triggers.crons`
  (`*/15 * * * *`). **Scope cut, flagged**: does NOT yet read a
  `systemSettings`-driven interval override (quyết định #11's "chỉnh được
  trong Settings") - runs at the raw cron cadence every tick. Wiring that
  in is small (read/write 2 fields somewhere) but didn't fit this pass -
  `KeyValueStore`'s API wasn't explored deeply enough to commit to a shape
  confidently. 2 tests.

### Explicitly NOT done this pass (unchanged from before "bắt đầu làm tất cả")

- Mục 6 (Tailwind per-page CSS) - spike left this open, needs a live
  browser run + a decision on the per-page-isolation architecture the spike
  surfaced.
- Mục 7's hydration-from-manifest (`page.js` + import map) - only the
  compile-time half (`page-build.ts`) exists; nothing produces/serves a
  `page.js` bundle yet.
- Mục 1's route manifest (`route-manifest.ts`) is built and tested, but
  NOTHING populates `pagesSourceStorage` with real content yet except the
  sync script's push mode, and NOTHING calls `buildManifestRouteTree`
  outside its own test file.
- Mục 11 (full admin "Build" UI - status/stale badges/progress/resume) -
  no UI at all. The only way to trigger a build today is calling
  `page-build.ts`'s `buildPage`/`publishBuiltPage` directly (e.g. from a
  script or a devtools console), which is real and working per its test
  suite, but nothing user-facing.
- Giai đoạn 6 (in-browser code editor for `src/apps/pages/**`) - not
  started. `system-code` permission exists with no route to gate yet.
- The live-behavior CUTOVERS themselves (`page-handler.ts` prod-serves-only-
  from-cache, `sitemap.ts` reading the registry, `discoverRoutes()` reading
  the manifest) - deliberately left as the LAST step, gated on a real build
  pass existing first. See this file's "Working principle" above.
- Cron's configurable interval (noted above under "Cron flip").

## Speed

Single long session, 2026-08-09. Typecheck (`bun run typecheck`) and the
full test suite (`bun run test`) run repeatedly throughout, not just at the
end - every new/changed file confirmed against a clean-tree baseline before
moving on. Final state: 0 typecheck errors; 1044 passed / 13 failed (the
same 13 pre-existing failures confirmed unrelated to this work via
`git stash` before starting, see `status/app-r2-spike.md`) / 0 new
failures across the whole session.

Not a claim of "feature complete" - see the NOT-done list above. What
exists now is a tested, additive foundation the remaining phases (CSS,
hydration, UI, editor, cutover) build on, not yet a working public-facing
feature.
