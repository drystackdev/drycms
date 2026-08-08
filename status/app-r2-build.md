# app-r2 build (plans/app-r2.md) - Giai đoạn 1/2/4 core + mục 7/10/13

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

## Speed

Single long session, 2026-08-09 (spanning a context-window compaction
partway through mục 7 - work continued seamlessly from the saved summary).
Typecheck (`bun run typecheck`) and the full test suite (`bun run test`)
run repeatedly throughout, not just at the end - every new/changed file
confirmed against a clean-tree baseline before moving on. Final state: 0
typecheck errors; 1050 passed / 13 failed (the same 13 pre-existing
failures confirmed unrelated to this work via `git stash` before starting,
see `status/app-r2-spike.md`) / 0 new failures across the whole session.

Giai đoạn 1-4 (route manifest, build core, dynamic params, CSS+hydration)
are now done and each independently live-verified under a real `wrangler
dev`, not just unit-tested. Giai đoạn 5 (sitemap/schedule) and Giai đoạn 3's
UI Build are done at the core but missing setting/UI polish (see the 🟡
markers in `plans/app-r2.md`'s "Giai đoạn" section). Not yet started:
Giai đoạn 6's in-browser code editor, and the live cutover of
`page-handler.ts`/`sitemap.ts`/`discoverRoutes()` - deliberately still
deferred, per this file's own "Working principle" above.
