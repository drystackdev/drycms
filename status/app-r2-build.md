# app-r2 build (plans/app-r2.md) - ALL Giai đoạn + mục items ✅ DONE, live-verified end to end (2026-08-09)

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

**This principle's own exit condition was reached the same session** (a
real build ran through the real UI for `/` and `/blogs/hello-world`) - see
"Update 2026-08-09, part 6" below for the actual cutover, done deliberately
per this principle, not in spite of it.

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

### Explicitly NOT done

~~Mục 6 (Tailwind per-page CSS)~~ → **done, see "Update 2026-08-09" below.**

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

## Update 2026-08-09 (same day, continued after "tiếp tục công việc đến khi xong")

**Mục 6 (Tailwind CSS) unblocked and BUILT for real** - Playwright freed up.
Live-confirmed (not source-inferred) via a throwaway harness, then deleted:

- Mount order matters: `<style type="text/tailwindcss">` must be added
  BEFORE importing `@tailwindcss/browser`, or `ruleCount` stays 0 - the
  package's `styleObserver` appears to bind only to tags that exist at
  import time.
- Per-page CSS leakage is REAL, not theoretical: building page B right
  after page A in the same document left A's classes in B's compiled
  output (`stillHasBgRed500FromPageA: true`).
- A fresh iframe per build genuinely isolates - confirmed zero leakage
  both directions.

Built for real off these findings: **`tailwind-build.ts`**
(`compileTailwindCss`) - fresh hidden iframe per call, imports
`@tailwindcss/browser` via Vite's `?url` suffix (`main`/`browser`/`exports`
in that package's `package.json` all point at the same single
`dist/index.global.js`, a dependency-free IIFE build - not the ESM entry a
plain bare import would execute immediately in the WRONG document). Wired
into `page-build.ts`'s `buildPage()` (`inlinePageCss`) - inlines the
compiled CSS as a `<style>` tag rather than a separate cached asset (mục
6's original text envisioned content-hashed files; inlining is simpler,
still strictly per-page, deferred until a real page's size says otherwise).
Guarded by `typeof document === "undefined"` so the existing vitest suite
(no real DOM) keeps passing unchanged.

**Found and fixed while wiring this in for real**: `build-document.ts`
originally imported `GLOBALS_CSS_HREF`/`HYDRATE_ENTRY_HREF`/`VEI_OVERLAY_HREF`
from `assets.js`, believed safe (that module doesn't itself touch
`config.ts`). Live Playwright run proved this WRONG:
`assets.js` re-exports from `resolve-asset-href.ts`, which imports `node:fs`
at module scope - a static `export {...} from` pulls in the whole module
regardless of which names are used, so ANY import from `assets.js` broke in
a real browser (`Module "node:fs" has been externalized for browser
compatibility`). Fixed the same way `adminPath`/`siteLang` already were:
`buildHeadPrefix`/`BuildDocumentContext` now take all 3 hrefs as plain
arguments; `render.ts` (server-only, safe) supplies real ones from
`assets.js`; `page-build.ts` takes them as a required, caller-supplied
`PageBuildInput.assets` field with NO default (real values await mục 7 -
"page.js động + import map" - which decides what a built page's own
script/CSS hrefs should even point at for a standalone deploy).

**Full pipeline confirmed end-to-end live** (Playwright, real dev server,
real current `src/apps/pages/page.tsx`+`layout.tsx`, not a toy fixture):
compile → render → dry() → Tailwind CSS → complete HTML document, 97ms,
13.8KB HTML with 11.5KB of correctly-scoped inlined CSS
(`.max-w-3xl`/`.text-slate-500`/`.rounded-full` all present, nothing
irrelevant).

**Found while verifying this: `bun run dev`'s API routes need a manual
restart to pick up brand-new route files.** `scripts/dev-server.mjs` loads
`adapters/node.js` (which wires `handler.ts`'s `handleApiRequest`) ONCE at
startup via a top-level `await vite.ssrLoadModule(...)`, unlike
`page-handler.ts`, which that same file's own comment says is deliberately
reloaded "fresh... on EVERY call" specifically so App Router pages need no
restart. New files under `routes/` (`dry-http.ts`/`pages-build.ts`/
`types-cache.ts`/`pages-source.ts`, all added earlier today) 404'd - not a
bug in any of them, confirmed by curl once restarted (all now correctly
401/405/403 depending on auth/method, matching their real gates). Restarted
via the project's own `bun run dev` (which already gracefully closes a
prior instance by matched command line - `closeExistingDevServer()` - not
an improvised kill). **Practical implication for future sessions**: adding
a NEW route file (not editing an existing one) needs `bun run dev`
restarted before it's reachable, despite `CLAUDE.md`'s "no directory needs
a manual rebuild" - that guarantee is specific to `page-handler.ts`'s App
Router path, not `handler.ts`'s API dispatch table.

Also found: the dev admin credentials in
`[[project_drycms_dev_admin_credentials]]` no longer work (401 on a real
login attempt) - flagged there, not re-derived.

## Update 2026-08-09, part 2: `bun run build:worker` + real `wrangler dev`

User asked to build + run Cloudflare local specifically to find bugs. Did:
`bun run build:worker` (client + Workers SSR bundle), then
`./node_modules/.bin/wrangler dev` (real miniflare - simulated D1/R2/KV, not
Vite dev's Node-side stand-ins). Registered a fresh throwaway super admin
via `register-first-admin` (fresh local D1, `hasAnyUser: false` - nothing to
do with the user's real dev DB, whose stored credentials are separately
confirmed stale - see `[[project_drycms_dev_admin_credentials]]`).

**Real bugs found and fixed, both only surfaced under a real R2 binding**
(Vite dev's local-disk storage adapter never exercises these paths -
`kind:"local"` DOES implement `listAll`/has no `.id`-vs-`.path` mismatch to
trip over):

1. **`PageBuild.tsx` crashed on load: "Cannot read properties of undefined
   (reading 'split')".** Root cause: I wrote a local `FileEntry` interface
   guessing a `.path` field: the REAL type (`storage/entry-types.ts`) has no
   such field - a relative storage path lives on `.id`
   (`storage/entry.ts`'s `toFileEntry`: `id: stat.path`). Silent under
   Vite dev's `kind:"local"` adapter, which implements `listAll()`
   (`?tree` returns `supported:true`) - the buggy field was only read once
   the fallback path ran. Fixed: renamed to `TreeEntry`, `.id` throughout.
2. **`?tree` unsupported under R2 was itself correctly reported
   (`{"supported":false}`, per `storage/types.ts`'s own documented R2/S3
   exclusion) but `PageBuild.tsx` didn't handle that case at all** - would
   have crashed on `tree.entries.filter(...)` the moment `entries` is
   `undefined`. Added `listAllFilesRecursive()`, a per-folder walk via the
   already-existing non-tree `GET /dry/api/pages-source/<folder>`.

**Confirmed working, not just typechecked, for the first time against real
infra** (previously only exercised via the SQLite engine + Vite dev's local
storage):

- `pages-registry-d1.ts` (the D1 engine implementation of `_pages`/
  `_page_deps`) - zero live coverage before this; `GET /dry/api/pages-build`
  correctly returned `{"pages":[]}` against a fresh D1, and later the real
  built row after a real build.
- `scripts/sync-pages-r2.ts --push --local` (the R2 code path - only
  `--push` local-disk had been run before) - pushed 4 real files into the
  local R2 bucket via `wrangler r2 object put`, immediately consumed by the
  admin UI.
- The FULL click-through: logged in via the real login form, navigated to
  `/dry/page-build`, saw "1 static page / Not built", clicked Build, watched
  status flip to "Live" with a real timestamp - compile (sucrase) → render
  (`resolveMatchToVNode`) → `dry-http` (real D1) → Tailwind CSS (real
  isolated-iframe compile) → publish (real R2 write, real D1 `_pages` row)
  → status reload, entirely inside a real Cloudflare Workers simulation.
  Fetched the resulting object back from R2 afterward (`GET
  /dry/api/pages-build?path=/`): 13,739 bytes, correct content, inlined CSS
  present (`tailwindcss v4.3.3`, `.max-w-3xl` real rule). Zero console
  errors/warnings through the entire flow.
- `entry-worker.ts`'s new `scheduled` export is correctly recognized by
  wrangler (its startup log warns "Scheduled Workers are not automatically
  triggered during local development" - that warning only appears when a
  `scheduled` handler is actually registered).

`wrangler dev` was stopped after this pass (was consuming port 8787 for
nothing further). `.wrangler/`'s local D1/R2/KV state and `dist/`'s build
output are both gitignored - confirmed, left in place, no cleanup needed.

## Update 2026-08-09, part 3: mục 4 (dynamic route params)

Built the last unfinished piece of Giai đoạn 2: `route-manifest.ts`'s
`listDynamicPageTemplates` (finds every single-level `[param]` page
template in the tree, skips catch-alls entirely, same "khai báo tay hoặc
chấp nhận không build" decision as before) + new
`page-components/dynamic-routes.ts`'s `resolveDynamicPages` (matches a
template to a content type via `seoUrlPattern` - the SAME, only, existing
collection->route association this codebase has, per `sitemap.ts`'s own
doc comment - no new config field added; fetches every published slug via
paginated `dry-http` calls, 500/page, mirroring `sitemap.ts`'s server-side
`publishedEntries` loop but through the HTTP layer). Wired into
`PageBuild.tsx`: dynamic pages now appear in the same table as static ones,
and a template with no matching content type shows as a explicit
"Unresolved dynamic routes" warning instead of being silently dropped.

**Verified live, both the negative and positive path**, under a fresh
`wrangler dev` restart:

- Pushed a `blogs/[slug]/page.tsx` with NO matching content type yet -
  correctly rendered the "Unresolved dynamic routes" warning
  (`/blogs/[slug]`), zero console errors, no crash (this is exactly the
  code path most likely to have had an untested assumption, given the
  `.id`/`.path` bug found earlier the same day).
- Created a real `blogPost` content type (`features.slug`, `seoUrlPattern:
  "/blogs/{slug}"`) and one entry (`slug: "hello-world"`) through the real
  content-types/content-entries API (found the entries POST body is the
  raw `EntryValue` directly, not `{value: {...}}` - a wrong first guess,
  fixed before it went anywhere). Reloaded `/dry/page-build`: the template
  resolved to `/blogs/hello-world` automatically. Clicked Build: status
  went "Not built" -> "Live". Fetched the result back:
  `params().slug` rendered correctly ("Blog post: hello-world") AND the
  layout chain applied correctly (`class="blog-shell"` present) - proves
  the whole chain (template detection -> type matching -> slug fetch ->
  per-page params -> build -> publish) end to end, not just its parts in
  isolation.

9 tests added (2 in `route-manifest.test.ts`, 3 in `dynamic-routes.test.ts`,
covering pagination past 500 rows and the no-match case) - full suite still
0 new failures, same 13 pre-existing ones.

## Update 2026-08-09, part 4: mục 7 (hydration from dynamic `.js`)

Built the last unfinished piece of Giai đoạn 3: `page-build.ts`'s
`compileEsmAsset` now compiles the WHOLE reachable closure (entry + every
layout + anything THEY import) to real ESM, rewrites relative imports to
public `built-assets` URLs, and embeds a `#dry-hydrate-manifest`/
`#dry-hydrate-params` pair in the built HTML. `hydrate-built.ts` (new
bootstrap, separate from `hydrate-client.ts` - reads that manifest instead
of `import.meta.glob`) `import()`s the entry/layout chain and calls
`resolveMatchToVNode` + `hydrate`, same as the existing SSR hydration path.

**Two real bugs found only by actually building and running this, not by
reading the code:**

1. **`preact-runtime.ts` (the shared `h`/`Fragment`/hooks/`hydrate`
   re-export a built page's compiled JS needs to import from at runtime)
   cannot be a normal `vite.config.ts` `rollupOptions.input`.** Built it as
   one anyway first, since that's what every other app-r2 client asset
   (`appsHydrate`, `appsVeiOverlay`) already is. `bun run build:worker`
   produced a chunk with almost every export silently gone - only
   `hydrate` survived (the one name something else in the SAME build,
   `hydrate-built.ts`, genuinely imports). Root cause: this file's real
   reader is a built page's own compiled JS, generated LATER, entirely
   outside this Vite build, by Sucrase, in a visitor's browser - Rollup can
   never see that usage, so from its own graph's point of view every other
   export is dead code, and it prunes them. Tried and confirmed to have
   **zero effect**, in this order: `preserveEntrySignatures:"strict"`,
   `treeshake:false`, local `const` rebindings instead of `export {...}
   from`, even a forced `globalThis` write referencing every binding (that
   last one kept the underlying VALUES alive but Rollup still dropped the
   `export` keyword on all but `hydrate`). This is exactly the shape of
   problem Vite/Rollup **library mode** exists for - its whole contract is
   "every declared export survives, because something outside this build
   is going to import it by name." Found the precedent already solving
   this in this exact codebase: `RichTextField/build-component-bundle.ts`'s
   `buildSharedPreactBundle`, a nested `vite.build({build:{lib:...}})` for
   its own (differently-shaped) Preact vendor bundle. Mirrored it:
   `build-preact-runtime-bundle.ts`'s `buildPreactRuntimeBundle()`, called
   lazily by `ensurePreactRuntimeAsset` (`built-pages-storage.ts`) and
   cached in `built-assets` storage under a fixed key
   (`__dry/preact-runtime.js`) - build once, serve forever, no
   invalidation needed since the content never changes per-project.
2. **Even with a correct standalone bundle, `hydrate-built.ts` statically
   importing it would have been a SECOND bug**, subtler and never visible
   as a build error: Vite would bundle that static import into the ADMIN
   app's own deduped Preact chunk - a different module instance than the
   one a built page's own `page.js` loads at its public URL. Two Preact
   instances in one render tree silently breaks hooks (state tracking
   lives in module-scope closures). Fixed by having `hydrate-built.ts`
   `import()` `hydrate` DYNAMICALLY from the manifest's own
   `preactRuntimeUrl` field (added alongside `entryUrl`/`layoutUrls`) - the
   browser's ES module cache (one instance per absolute URL) is what
   actually guarantees the two line up, not anything Vite does at build
   time. (`resolveMatchToVNode` itself never calls `h()`/`Fragment()` -
   confirmed by reading it - so this was the only place that mattered.)

**Also found while wiring the lazy build:** gated
`ensurePreactRuntimeAsset`'s build-if-missing branch on
`import.meta.env.DEV` first (mirroring `buildAndStore`'s existing dev-only
gate for richtext components) - wrong signal, found live under a real
`wrangler dev` run: that always executes the compiled PRODUCTION worker
bundle, so `import.meta.env.DEV` is `false` there too, meaning the bundle
could never self-bootstrap under Workers AT ALL, not even for local
testing. The real constraint is narrower than dev-vs-prod: a nested
`vite.build()` needs live Vite/esbuild tooling, which only Node can run
(dev OR prod) - workerd never can, dev or deployed. Switched to the same
`process.versions.node` check `types-cache.ts`'s `writeGeneratedDryTypes`
already uses to tell the two runtimes apart.

**Verified live end-to-end under a real `wrangler dev` (real D1+R2, not
Vite dev's Node-side stand-ins):** rebuilt (`bun run build:worker`) and
confirmed `appsPreactRuntime` is gone from `dist/client/assets` entirely
(no longer a rollup input) and `appsHydrateBuilt`'s compiled chunk has zero
static Preact imports of its own. Bootstrapped `preact-runtime.js` once via
a throwaway Node script + `wrangler r2 object put` (same manual-push
pattern already used once before for pages-source files) since this
particular `wrangler dev` session has no Node process sharing its R2
backend. Pushed a `/hydrate-test` page with a real `useState` counter
island (not in `src/apps/pages/` - written straight to local R2 to avoid
touching the real project tree, deleted afterward), built it through the
real admin UI, then loaded the built HTML directly
(`/dry/api/pages-build?path=/hydrate-test` - `page-handler.ts`'s live serve
path still deliberately doesn't read from `built/live/*`, so the page
itself still correctly 404s at its real URL) in a real Playwright browser
tab: layout chain rendered correctly, button read "Count: 0", three real
clicks took it to "Count: 1" → "2", `window.dryHydrated === true`, zero
console errors or warnings through the entire load+interact sequence. Test
page, its two source files, and its build/registry row were all deleted
after confirming.

`page-build.test.ts`'s 5 tests updated with real new assertions (not just
passing field plumbing) on the compiled ESM output - `jsAssets` paths,
rewritten import specifiers landing on the public `built-assets` URL not
the bare relative one, hooks import rewritten to the same runtime URL as
`h`/`Fragment` - and on the embedded manifest's exact JSON, including the
new `preactRuntimeUrl` field. Full suite still 0 new failures, same 13
pre-existing ones.

## Update 2026-08-09, part 5: mục 9's remaining piece - the schedule interval setting

Last unfinished piece of quyết định #11: `scheduleFlipIntervalMinutes`,
configurable in Settings, default 60. New `lib/schedule-flip-setting.ts`
(pure, zero other imports - both the server-only `schedule-flip.ts` and the
browser-bundled `PageBuild.tsx` import it directly, mirroring how
`system-settings-theme.ts` is already shared between `routes/
system-settings.ts` and `Settings.tsx` for the same `systemSettings.data`
blob - deliberately NOT importing `schedule-flip.ts` itself from
`PageBuild.tsx`, which would drag D1/KV-backed server adapters into the
client bundle, the exact class of bug mục 7 already hit once with
`assets.ts`). `entry-worker.ts`'s `scheduled` export now reads the setting
and a KV timestamp (`shouldRunScheduledFlip`/`recordScheduledFlipRun`,
reusing `getAuthSecurityStore` under its own `"schedule-flip"` namespace -
`rate-limit.ts` already reuses that same store for an equally not-quite-auth
concern, so this isn't a new pattern) BEFORE calling `runScheduledFlip` -
a tick that fires too soon now costs one KV read and nothing else, no D1
round trip at all.

**Real data-loss bug found while designing this, before writing any of the
new code:** `Settings.tsx`'s save built `data` from ONLY its own 15 known
theme keys (`JSON.stringify(value)`), so the very next time anyone saved a
color, it would have silently wiped `scheduleFlipIntervalMinutes` (or
anything else a different page ever wrote into that same shared blob) right
back out. Not hypothetical - reproduced live before fixing (see below).
Fixed both writers (`Settings.tsx` and the new `PageBuild.tsx` section) to
merge onto the full blob loaded at read time (`{...otherStoredData,
...ownKnownFields}`) rather than replacing it outright.

**Verified live under a real `wrangler dev`:** set the interval to 45 on
`PageBuild.tsx`'s new "Publish schedule" card, saved - zero console errors.
Switched to Color schema, changed the Primary color, saved. Fetched
`GET /dry/api/content/systemSettings` directly: both `"scheduleFlipIntervalMinutes":45`
and `"primaryColor":"#123456"` present in the SAME blob - the merge fix
holds under the exact two-writers scenario that would have broken it.
Triggered `/cdn-cgi/local/scheduled` (wrangler dev's manual cron-trigger
endpoint) twice back to back: both logged `skipped (45min interval not yet
elapsed)` - correct, since miniflare's local D1/KV state persists across a
`wrangler dev` restart, and an earlier trigger from before the interval was
even set was still within the (newly lowered) 45-minute window. Confirms
the whole real chain - setting read, KV timestamp read, comparison, gate -
actually executes against real bindings, not just mocks. The "should run"
branch is covered by 4 new unit tests with controlled fake timestamps
instead (both `schedule-flip.test.ts` and a new colocated
`schedule-flip-setting.test.ts` for the pure parse function) - waiting 45
real minutes for the positive case wasn't worth it given the mechanism
(the exact same KV read+compare) is already exercised live by the skip
path above.

8 new tests total (4 in `schedule-flip-setting.test.ts`, 4 in
`schedule-flip.test.ts`'s new `describe` block - the latter needed an
explicit KV reset in `beforeEach`, since `getAuthSecurityStore`'s fallback
adapter is one module-level in-memory store shared across every test in
the file, not scoped by the `env` object passed in). Full suite: 0 new
failures, same 13 pre-existing ones.

## Update 2026-08-09, part 6: THE cutover - mục 8 + mục 12 + mục 14

The big one: this file's own "Working principle" (never flip live-serving
behavior until a real build has run through a real UI) has now been
satisfied - `/` and `/blogs/hello-world` were built and published earlier
this same session - so `page-handler.ts` was flipped for real. Prod
(`!isDev`, no VEI session) now serves ONLY from `built/live/*`
(`readBuiltPage`) or 404s - zero live rendering for anonymous traffic.
`/sitemap.xml` moved to `buildSitemapResponseFromRegistry` (mục 8) in the
same pass, deliberately coupled to the page-serving cutover: the two have
to agree on "what's actually reachable," or the sitemap would advertise
URLs that immediately 404 crawlers. `sitemapEdgeCacheTtlSeconds` (mục 14)
got wired into `entry-worker.ts` too, decoupled from the page cache's own
on/off toggle. Deleted `pages-cache.ts`/`build-id.ts` (the old
`PageCacheEnvelope` scheme this replaces) entirely, not left as dead code.

**Deliberate, documented deviation from mục 12's own text**: a VEI session
(dev or prod) is carved OUT of the static-only branch and keeps getting the
exact same live SSR-with-edit-markers render it already had - found while
DESIGNING this, before writing any code: `page-build.ts`'s pipeline renders
every `dryBind()` as an inert, marker-free ref (confirmed in its own test's
doc comment), so a built page's HTML has nothing for the client-side
overlay to hook per-field editing onto. Making mục 12's literal "VEI runs on
static HTML" text real needs `page-build.ts` to stop stripping those
markers - a separate, not-yet-scoped follow-up, not something to improvise
mid-cutover. The carve-out keeps the shipping, working editing experience
intact while that's pending.

**Real bug found while WRITING TESTS, not while building the code**:
Vitest's own `mode` is `"test"`, and Vite defines `DEV` as `mode !==
"production"` - so a plain `import.meta.env.DEV` read is `true` under
Vitest, identical to a real dev server, with no way to observe the new prod
branch at all from that alone. The first test written against it silently
ran the wrong branch and failed confusingly (a `readBuiltPage` write/read
round-trip appeared broken, when the request was actually never reaching
that code at all - full live SSR ran instead and happened to also produce
a 404 for the same made-up pathname, for an unrelated reason). Fixed by
giving `handlePageRequest` a 3rd `isDev` parameter, defaulting to the real
`import.meta.env.DEV` - none of its 3 real call sites (`entry-node.ts`,
`entry-worker.ts`, `scripts/dev-server.mjs`) pass it explicitly, so nothing
about a real build changes; only tests pass it to pick a branch on purpose.
Also found and fixed, independently: `page-handler.test.ts` already had
ONE test ("leaves an ordinary route match at status 200") that was failing
before any of today's changes - confirmed by running it against the
pre-session baseline code directly (swapped files back temporarily, not
`git stash`, to avoid any risk to concurrent work) - `/blogs/[slug]/page.tsx`
was never actually committed to this project, only ever pushed straight to
a test R2 bucket in an earlier session's live verification. Rewrote it
to reflect what's actually true instead of just deleting it.

**Verified live end-to-end under a real `wrangler dev`** (D1+R2 real, not
simulated): anonymous `GET /` and `GET /blogs/hello-world` both 200,
byte-identical static HTML (real inlined Tailwind, zero dev-source script
tags). A never-built path 404s with a bare `"Not found"` body.
`/sitemap.xml` lists exactly those 2 URLs with `<lastmod>` (the registry
version's own signature - the old direct-D1 version never had `<lastmod>`
at all). Most important: drove a REAL VEI session through Playwright
(clicked "Edit content" -> real `/dry/vei/enter` round trip -> real
`drycms_vei` cookie) and reloaded `/` - the embedded `dry-vei-config`
correctly flipped to `{"edit":true}` and the loaded script switched from
`appsHydrateBuilt-*.js` (the static build's own bootstrap) to
`appsHydrate-*.js` (the live-SSR one) - direct proof the carve-out is
really live-rendering, not inferred from reading the code. Clicking Exit
correctly reverted both. Zero console errors through the whole sequence.
One red herring chased down first: an initial check right after a rebuild
showed stale (empty) asset hrefs in the served HTML - NOT a real bug, a
`ctx.waitUntil`-backed edge-cache write racing a same-second re-request;
waiting a moment and re-checking showed correct, fresh content with a
genuine cache MISS.

`page-handler.test.ts` rewritten (6 tests: admin-path passthrough,
redirect-wins-in-both-branches, prod serves-a-built-page, prod bare-404,
dev live-404-with-hydration-script, dev ignores-built-page-entirely). Full
suite: 0 new failures; 12 pre-existing ones now (was 13 - one of them lived
in the now-deleted `pages-cache.test.ts`).

## Update 2026-08-09, part 7: Giai đoạn 6 - in-browser code editor

The last unbuilt piece of app-r2's original vision - "cây thư mục tham
chiếu... khi thay đổi 1 file .tsx... sẽ build lại trang" (the plan's own
"Ý tưởng gốc"). The storage plumbing already existed (`pagesSourceStorage`,
`sync-pages-r2.ts`, `types-cache`); what was missing was the editor itself.

Added `routes/pages-source.ts`'s POST/PUT/PATCH/DELETE (a close mirror of
`routes/page-components.ts`'s own, same `.tsx`/`.ts`-only validation), gated
on `system-code` in `handler.ts` (GET stays open - the build flow, gated on
`system-build`, needs to read it too). `PageEditor.tsx` (nav "Page Code
Editor") turned out to be almost entirely REUSE: `ComponentTreePanel` needed
zero changes, `Editer`'s wiring and the create/delete/move flow are a close
copy of `PageComponents.tsx`'s own. The one real addition, per an explicit
user ask mid-session ("thực hiện luôn UI code editer panel kèm phần preview
trên iframe theo từng trang"): a live preview pane that runs `buildPage()`
(the exact function `PageBuild.tsx`'s "Build" button calls) against the
CURRENTLY EDITED, not-yet-saved source, rendering the result into an iframe
via `srcdoc` - never `publishBuiltPage`, so it can never touch `built/
live/*`/`_pages` no matter how much someone free-types. Only available when
the selected file is itself a `page.tsx` matching a real static route -
resolving "which page(s) does this shared layout/component affect" is a
follow-up, not solved here.

**2 real bugs found live, chasing down why the preview kept showing stale
content - neither would have surfaced from reading the code:**

1. **Race condition.** Two edits close enough together - inside
   `buildPage()`'s own in-flight time, not just inside the debounce window -
   start two overlapping `refreshPreview()` calls, and nothing guaranteed
   the one that STARTED last also FINISHED last. An older, slower build
   could silently overwrite a newer one's correct result. Fixed with a
   sequence token (`previewSeqRef`) discarding any resolution that isn't
   the most-recently-started call - the exact same pattern `Editer.tsx`'s
   own `checkSignatureHelp` already uses (`sigSeq`) for the identical race,
   found independently rather than copied consciously at first.
2. **The real one.** Even with #1 fixed, a FRESH, single, non-overlapping
   preview build still showed stale content. Root cause: `buildPage()`'s
   returned HTML embeds a hydrate manifest
   (`#dry-hydrate-manifest`) unconditionally, pointing `hydrate-built.ts` at
   `${builtAssetsBaseUrl}/page.js` - which is whatever a REAL "Build" click
   on Page Build last PUBLISHED, not this preview's own fresher, unsaved
   compile. The iframe's first paint was correct (fresh SSR), but the
   instant hydration finished, it silently overwrote that correct DOM with
   the stale published version - the exact same "hydration reconciles
   against a stale tree" hazard `hydrate-client.ts`'s own doc comment
   already documents for a different trigger (pre-hydration DOM edits), hit
   here from a new angle. Fixed by stripping the
   `dry-hydrate-manifest`/`dry-hydrate-params` script tags from the preview
   HTML before setting `srcdoc` - `hydrate-built.ts` already no-ops
   gracefully with no manifest present (mục 7's own "static page, no
   islands" case), so the preview correctly falls back to an accurate
   STATIC render. Making interactive islands work in the preview too is a
   follow-up, not solved by this pass - noted alongside mục 12's own
   VEI-marker follow-up as a second, related gap in the same area.

**Verified live end-to-end under a real `wrangler dev`**: opened the real
pages-source tree (files pushed in earlier sessions), edited the real root
`page.tsx`, confirmed the preview updates correctly - via direct DOM
inspection (`iframe.contentDocument.querySelector('h1').textContent`), not
just a screenshot (a first screenshot attempt was misleading: the iframe's
limited panel height cut off the very content that would have shown the fix
already working, momentarily looking like a still-open bug). Restored the
real homepage's original content via a direct API call afterward. Then, the
full loop: created a brand new file (`editor-test/page.tsx`) through the
"New component" button, wrote real content, watched the preview pick up the
new route (`/editor-test`) automatically, saved, switched to Page Build,
saw it correctly listed "Not built", clicked Build, then fetched
`/editor-test` on the real public URL - byte-correct HTML matching exactly
what was written in Page Editor, proving the whole chain (edit in browser →
save → build → real public URL) end to end. Cleaned up both the built
artifact and the source file afterward.

New test file `routes/pages-source.test.ts` (13 tests, mirroring
`page-components.test.ts`'s own structure almost exactly). Full suite: 0 new
failures, same 12 pre-existing ones.

## Update 2026-08-09, part 8: mục 12's remaining piece - rebuild-on-save

The one explicit gap left in mục 12's own wording after part 6's cutover:
"Sau `saveAll()` thì chạy build cho trang hiện tại + trang phụ thuộc, xong
mới `window.location.reload()`." Part 6 shipped the READ side (prod serves
`built/live/*`) but never wired anything to make a VEI save actually refresh
what anonymous visitors see - without this, every content edit made the
static site silently stale until someone remembered to click Build.

- `routes/pages-build.ts` GET gained a `?byResource=a,b` branch - unions
  `PagesRegistryAdapter.listPathsByResource(resource)` (already existed
  since mục 5, never had a caller) across the given resource names.
  Inherits the route's existing blanket `system-build` gate for free (no
  `handler.ts` change needed).
- `PageBuild.tsx` gained a headless `?autoBuild=/a,/b` mode: once its normal
  load effect finishes (new `ready` flag, set in a `finally` - needed
  because "no pages to build" and "still loading" both look like an empty
  `targets` map otherwise), it runs `buildOne()` for just those paths and
  `postMessage`s `{type:"vei:build-done", ok, built, failed}` to
  `window.parent`. `buildOne` now returns `Promise<boolean>` instead of
  swallowing its own success/failure silently.
- `overlay.ts`'s `saveAll()`: after the existing `saveTarget` loop, a new
  `rebuildAffectedPages(resources)` fetches `?byResource=`, then reuses the
  SAME hidden `agent` iframe `saveTarget` just finished with (no new iframe)
  to load `page-build?autoBuild=...`, awaits `vei:build-done` (timeout
  `20s + 15s per page`), THEN reloads. Every failure mode (no
  `system-build`, offline, a stuck build) just resolves instead of
  throwing, so `saveAll` falls back to its exact pre-existing plain-reload
  behavior - the new step can only add a rebuild, never break a save.
- **Real bug found live, not while writing the code:** both halves worked
  correctly when exercised directly (manual fetch, opening
  `page-build?autoBuild=` as a top-level page), but calling them from
  inside `saveAll()` reloaded almost instantly - far too fast for a real
  build (Sucrase compile + render + an isolated-iframe Tailwind pass) to
  have run. Root cause: `saveTarget` saves through the SAME hidden iframe
  by driving the real `ContentEntryEditor`, whose successful save discards
  the entry's draft from `entry-draft-db` - and that discard broadcasts a
  `BroadcastChannel` "delete" that THIS SAME overlay's own
  `subscribeEntryDraftChanges` cross-tab listener also receives, reloading
  immediately with no awareness that `saveAll()` itself is still mid-flight.
  Harmless before this update (the old `saveAll()` also reloaded right after
  its save loop, same outcome either way) - only became a real bug once
  something MEANINGFUL needed to happen between the save loop and the
  reload. Fixed with a `saveAllInFlight` guard flag (true for the duration
  of `saveAll()`, including the rebuild step) that the cross-tab listener
  now checks before reloading - genuine cross-tab saves/discards (a
  DIFFERENT tab or session) are completely unaffected.
- **Verified live end-to-end under `wrangler dev`:** added one real
  `dry()`-bound field (`dryBind(post.$.title)`) to the root page in BOTH
  places that need it - the repo's `src/apps/pages/page.tsx` (what
  `import.meta.glob` bundles into the worker for VEI's live-SSR pipeline)
  and `pagesSourceStorage` via Page Editor (what the browser build pipeline
  reads) - these are two genuinely separate stores (quyết định #6/mục 13),
  confirmed live: editing only the `pagesSourceStorage` copy left VEI
  rendering the OLD bundled page with zero markers, since a `wrangler dev`
  worker bundle freezes `import.meta.glob` at build time. After rebuilding
  the worker with both copies aligned: entered VEI, edited the blog post's
  title through the real field dialog, Cancelled (kept the draft), clicked
  the dock's Save, waited (~8-12s for the real rebuild - checking too early
  twice in a row is what surfaced the race above), then `curl`'d the page
  with NO cookies at all and got the new title back, byte-correct, with no
  manual Build click. Cleaned up afterward: reverted both `page.tsx` copies
  (`git checkout --` for the repo file, retyped verbatim through Page Editor
  for the storage copy), reset the blog post's title back to "Hello World",
  rebuilt both pages once more so the static output matches the reverted
  source, and did a final worker rebuild so the running `wrangler dev`
  matches git exactly.
- 3 new tests in `routes/pages-build.test.ts` (the `?byResource=` branch,
  against a real SQLite `PagesRegistryAdapter`, no mocking). Full suite:
  1072 passed / 12 failed (same pre-existing, unrelated group - +3 vs. part
  7's count, entirely the new tests), 0 typecheck errors.
- **Found, NOT fixed in this piece, FIXED in part 9 below:** any page whose
  `page.tsx` uses the `dry()`/`params()` ambient globals threw
  `ReferenceError: dry/params is not defined` during CLIENT hydration of a
  BUILT page.

## Update 2026-08-09, part 9: hydration globals fix + UI Build's remaining polish

Picked up the 2 loose ends explicitly left open at the end of part 8: the
hydration `ReferenceError` (found but out of scope there) and Giai đoạn 3's
last 🟡 marker (progress/resume + batch PUT for "Build all").

**Hydration fix.** Root cause, traced through `app-router-plugin.ts`/
`page-build.ts`/`hydrate-built.ts` together: `dry`/`params`/`setTitle`/
`dryBind` are real ambient globals only by TypeScript convention
(`dry.generated.d.ts`'s `declare global`) - 3 different runtime contexts
each have to make that true their OWN way. Server SSR and the OLD
`hydrate-client.ts` get it from `app-router-plugin.ts`, a Vite plugin that
AST-injects a real `import` per consumer at build time. `page-build.ts`'s
own `evalModule` (the CJS/`new Function` path that renders a page ONCE,
client-side, inside the admin tab during a build) passes all 4 as
`new Function` parameters. `compileEsmAsset` - the OTHER half of the same
file, producing the REAL standalone `page.js`/`layout.js` a visitor's
browser `import()`s to hydrate - does neither: no Vite pass to inject an
import, and it emits genuine ESM (not an eval), so there's no parameter
list to smuggle them through either. The 4 identifiers reach a visitor's
browser completely unbound.

Fixed in `hydrate-built.ts` only, not `compileEsmAsset`: that file already
read `#dry-replay-data`/`#dry-hydrate-params` and called
`setReplayLog`/`setCurrentParams` (the exact replay plumbing
`dry-reader-client.ts`/`hydrate-client.ts` already used - `buildDocument()`
is shared, so an app-r2 build already embeds the same `#dry-replay-data`
script the old pipeline does) - it just never exposed the 4 functions
anywhere the dynamically-imported page/layout code could reach them. Added
`Object.assign(window, { dry, params, setTitle, dryBind })` right before the
`import()`s that load the compiled modules: an unqualified identifier
reference in ANY module, including a real ES module, still falls through to
the global scope when nothing else binds it - standard JS scoping, not a
workaround. `dryBind` needed no special client variant: a replayed value
always carries an inert ref (`createInertRefProxy`), exactly like the
original build-time render (never VEI edit mode), so it returns `{}` both
times - no hydration mismatch introduced.

Verified live under `wrangler dev`: before the fix, `/` and
`/blogs/hello-world` both threw the exact reported error on load. After
rebuilding: 0 console errors on either, `window.dryHydrated === true`, and
`typeof window.dry/params/setTitle/dryBind === "function"` confirmed
directly via `browser_evaluate`.

**UI Build polish (mục 11's last 2 gaps).**

- *Batch PUT.* `POST /api/pages-build` now also accepts `{ pages: [...] }`
  (`isValidBatchBody`) alongside the original single-page body, unchanged
  for backward compatibility - `buildOne`/the VEI `?autoBuild=` rebuild path
  still use it directly (batching a single page is pure overhead). Server
  loops `publishOne` (extracted from the old POST handler body) over each
  entry SEQUENTIALLY, not `Promise.all` - `kind: "local"` shares one SQLite
  handle, so concurrent writers would just serialize anyway, and this keeps
  behavior identical across engines. Returns `{ records, errors }`; a
  per-page validation/write failure is reported without failing the pages
  that DID succeed. `PageBuild.tsx`'s `buildAll()` still compiles one page at
  a time (CPU-bound work in one tab, nothing to gain batching that part) but
  now flushes every 5 compiled results through ONE `publishBuiltPages` call
  instead of one `publishBuiltPage` per page.
- *Progress/resume.* `buildAll()` persists `{ total, remaining }` to
  `localStorage` after every CONFIRMED outcome - a batch that actually
  published, or a single page that failed to build/had no target and won't
  be retried - never optimistically before that. A batch publish failure
  mid-flush therefore leaves exactly the unconfirmed pages in the persisted
  queue, not silently drops them. On load, an existing queue surfaces as an
  "Interrupted build" card (Resume/Discard). A FRESH "Build all" always
  queues the FULL page list again, not just what's currently "Stale" - the
  scenario mục 11 itself names (editing a shared root `layout.tsx`) is a
  CODE change, which `_page_deps` staleness tracking (content-driven) can't
  see at all, so skipping "already Live" pages would silently under-build.

  **Real bug hit restarting `wrangler dev` for this round's testing, unrelated
  to the code itself:** 3 full generations of leftover `wrangler dev`/
  `workerd` process trees from earlier restarts this session were all still
  running (port-only `lsof -ti:8787 | kill` had only ever killed the
  outermost process in each tree, not the whole tree), and the newest one's
  `workerd` crashed on startup with `SQLITE_BUSY (extended:
  SQLITE_BUSY_RECOVERY)` - multiple processes holding the same local D1
  SQLite file open. Fixed by killing every `wrangler`/`workerd` PID matching
  the project path individually (verified each with `kill -0`) before
  starting one clean instance.

  Verified live under `wrangler dev`: "Build all" on the real 2-page site
  produced exactly 1 `POST /api/pages-build` (`browser_network_requests`),
  not 2 - batching confirmed. Resume/Discard tested by seeding
  `localStorage`'s `dry-page-build-queue` directly with a partial queue
  (simulating a closed-mid-build tab, since actually killing a Playwright
  tab mid-network-call isn't reliably reproducible): reloading showed the
  correct "N of M pages" banner; Resume built exactly the remaining pages
  and cleared the queue; a second seeded queue was correctly cleared by
  Discard without building anything. Both `/` and `/blogs/hello-world`
  confirmed still showing their original starter content afterward (no
  test-data leakage from this round).
- 3 new tests in `routes/pages-build.test.ts` for the batch branch (publishes
  several pages in one call; a bad entry doesn't fail the valid ones in the
  same batch; the original single-page body still works unchanged).

Also discovered mid-session: the user committed part 8's work themselves
(commit `a0a71b1`, their own git identity, own IDE) shortly before this
part started - explains why an early `git status` check in this part showed
fewer modified files than expected. Not an error; just a concurrent-editing
note for the record, same category as `components.css`'s untouched
unrelated edit noted in part 8.

Full suite after this part: 0 typecheck errors; 1075 passed / 12 failed
(same pre-existing, unrelated group - +3 vs. part 8's count, entirely this
part's new batch tests).

## Update 2026-08-09, part 10: PageEditor UX - user-directed, outside the original mục list

A dense, multi-part request from the user (not a numbered plan item - direct
UX direction), all landed in one pass: dev-environment auto-sync, real
`dry()` types/completion in the editor, a `ComponentTreePanel.tsx` UX
overhaul (folder select, unified inline create, dirty dots), a reordered
3-column layout with a matching 3-part toolbar, preview support for
`layout.tsx`/`404.tsx`/`500.tsx` (not just `page.tsx`), and a responsive
xs/sm/md/lg/xl scaled preview. Plus one small separate fix mid-session: hide
VEI's "Edit content" button inside the preview iframe (it rendered because
the built HTML always embeds the overlay script and the admin's own session
cookie satisfies `hasAdminHint()`, but clicking it inside a detached
`srcdoc` iframe does nothing useful).

Full writeup lives in `plans/app-r2.md`'s Giai đoạn item 10 (kept there since
it's genuinely a plan-tracked deliverable now, not a footnote) - this entry
covers the session-log angle: what was found live, and how it was verified.

**Real find, not a bug in the new code:** wiring `dry()` typing surfaced
that `typesCacheStorage` (`dry.generated.d.ts`'s cache) was completely empty
in this session's `wrangler dev` instance - nobody had ever run a Content
Types "Apply and build" against it, and the OTHER 2 regen paths
(`dev-server.mjs`'s Node-only startup hook, `scripts/dry-generate.ts`) both
explicitly can't reach a `kind: "cloudflare"` D1 binding standalone. Proven
via the actual mechanism (not guessed): typed `dry()`/`params()`/
`setTitle()`/`dryBind()` directly, read each one's REAL hover diagnostic
text off the DOM (`"Cannot find name '...'."`, all 4), then confirmed the
MERGE logic itself is correct by monkey-patching `window.fetch` to answer
`/api/types-cache` with a real `.d.ts` sample. This is a pre-existing
environment-state gap the new wiring correctly degrades around (empty
string in, empty contribution, no crash), not something this pass needed to
fix.

**Verified live, this part specifically:**
- `page.tsx`/`layout.tsx`/`404.tsx` preview: correct label, correct
  content, "No problems" status for all 3 - `layout.tsx` showed its real
  header/footer chrome wrapping the orange placeholder div; `404.tsx`
  rendered standalone with no layout, matching `renderErrorHtml`'s own
  no-layout behavior at serve time.
- Viewport scaling: XL (1280px, wider than the ~480px default preview
  column) produced `zoom: 0.35`; XS (375px, narrower than the column)
  produced `zoom: 1` (already fits, no shrink needed) - `frame.style.width`/
  `.zoom` read directly off the DOM, not inferred.
- `ComponentTreePanel`: selecting "blogs" applied `.folder-active`
  (confirmed via `className` read, not just the accessibility tree);
  clicking "New" rendered the input INLINE as the first child inside
  "blogs", not at a fixed top-of-list spot; submitting "test-scoped.tsx"
  created it at "blogs/test-scoped.tsx" (toast confirmed); submitting
  "test-subfolder/" created a folder at "blogs/test-subfolder" (trailing
  slash → folder, confirmed via toast); selecting the just-created file and
  clicking "New" again correctly fell back to "blogs" (its parent) with no
  folder explicitly re-clicked, proving the `activeFolder ?? parentOf(
  selectedPath)` fallback. Both test items deleted afterward via the
  existing right-click → Delete → confirm flow, tree confirmed back to its
  original shape.
- Dev auto-sync: started a real `bun run dev` (Node, port 5173) alongside
  the session's `wrangler dev` (port 8787, no conflict) and read its own
  startup log directly - `pulled 1 file(s)`, naming `about/page.tsx`, a real
  file that existed only in local `pagesSourceStorage` from an earlier
  session and had never reached git. Left untracked (not auto-committed or
  deleted - could be the user's real content) rather than assumed to be
  disposable.
- Shared-component risk: `PageComponents.tsx` (the OTHER consumer of
  `ComponentTreePanel.tsx`) still typechecks against the changed props
  (`isDirty` is optional, nothing else changed shape); its own tree UI
  couldn't be click-tested live this session (`pageComponentsStorage` under
  `kind: "cloudflare"` doesn't support `?tree` listing and this component,
  unlike `PageEditor.tsx`, has no recursive fallback for that case - a
  pre-existing gap, not something this pass touched or introduced).

`useDevicePreview.ts` split into a width-table-agnostic `useScaledPreview`
(the real `zoom`-based mechanism) plus a thin 3-preset wrapper preserving
the exact original `useDevicePreview()` behavior/signature for Component
Builder - `PageEditor.tsx` calls the new export directly with its own
5-preset table, so neither feature's preset set leaks into the other's.

0 new unit tests this part - the surface here is almost entirely
interactive UI, verified live via Playwright (DOM reads, not just
accessibility-tree text) rather than added as unit tests, consistent with
how the rest of `PageEditor.tsx` has been tested all session. 0 typecheck
errors; full suite unchanged at 1075 passed / 12 failed (same pre-existing,
unrelated group).

## Speed

Single long session, 2026-08-09 (spanning a context-window compaction
partway through mục 7 - work continued seamlessly from the saved summary).
Typecheck (`bun run typecheck`) and the full test suite (`bun run test`)
run repeatedly throughout, not just at the end - every new/changed file
confirmed against a clean-tree baseline before moving on. Final state: 0
typecheck errors; 1075 passed / 12 failed (pre-existing, unrelated - see
`status/app-r2-spike.md` for the original `git stash`-confirmed baseline)
/ 0 new failures across the whole session.

Every numbered mục in `plans/app-r2.md` and every Giai đoạn item is now ✅ -
no 🟡 markers left. Giai đoạn 1-4 and 6 (route manifest, build core, dynamic
params, CSS+hydration, in-browser code editor) are all done and
independently live-verified under a real `wrangler dev`, not just
unit-tested. mục 8/9/11/12/14 (sitemap, schedule, UI Build incl. batch+
resume, THE cutover incl. rebuild-on-save, sitemap TTL) likewise. `sivelap`
(the real site running in this session) now serves anonymous traffic
entirely from `built/live/*`, that output stays current automatically after
a VEI save, its pages can be authored/previewed/saved/published without
leaving the browser (now with a 3-column layout, folder-scoped creation,
responsive device preview, and real `dry()` typing), "Build all" survives an
interrupted tab and doesn't hammer storage with one request per page, a
built page's client bundle hydrates cleanly instead of throwing on `dry()`/
`params()`, and a local dev checkout keeps `src/apps/pages/**` and
`pagesSourceStorage` from silently diverging. app-r2 is live, usable, and
complete end to end relative to the plan's own numbered list.

One deliberately deferred follow-up remains, not part of the numbered plan
items and explicitly out of scope for this session (needs its own design
pass, not just an implementation push): `page-build.ts` strips VEI's
`dryBind()` markers from built output, so neither a built page's live VEI
editing (mục 12's carve-out, still bypassing to live SSR instead) nor Page
Editor's preview (part 7's mục 6) can be truly interactive/marker-aware yet
- fixing that one root cause would unlock both.
