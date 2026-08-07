# Plan

Goal: drycms's server (`src/server/handler.ts` + App Router page rendering)
runs on Cloudflare Workers, backed by D1 (content, already implemented) and
R2 (file storage, new). Scope confirmed with user: include an R2 storage
backend, and explicitly block the two Node-only features (AI local mode,
RichText Component Builder's "Build" button) on Workers rather than leaving
them to fail obscurely.

## Phase 0 - Audit (done)

Confirmed via `grep`/reads across `src/`:

- `handler.ts`/`page-handler.ts`/`page-guard.ts` are already pure
  `(Request, env) => Promise<Response>` - no Node deps. Per
  `adapters/types.ts`'s own doc comment, these need **no bridging**, unlike
  `adapters/node.ts`.
- Content engine already has a working D1 path (`content-types/engine/d1.ts`
  - `entries-d1.ts`), selected via `content.engine: "D1"` +
    `content.binding`. KV already has `cloudflare-kv.ts` for `kv.kind: "KV"`
    and a D1 kv kind too. Neither needs new work.
- Blockers found (all `node:*` or `child_process` usage, `src/**`, runtime
  code only - build-time/dev-only tooling excluded):
  1. **Storage-backed options** (`storage`, `icons`, `components.storage`,
     `pageComponents.storage`, `pagesCache.storage`, `typesCache.storage`)
     only support `kind: "local"` (`src/storage/local.ts`, `node:fs`).
     `options.ts` already reserves `"r2"`/`"s3"` as `PLANNED_STORAGE_KINDS`.
  2. **Static asset + admin shell serving** (`entry-node.ts`) reads
     `dist/client/**` off disk (`readFileSync`/`createReadStream`). Workers
     needs the Assets binding instead.
  3. **`app-router/assets.ts`** resolves `GLOBALS_CSS_HREF`/
     `HYDRATE_ENTRY_HREF` via a synchronous `readFileSync` of
     `dist/client/.vite/manifest.json` **at module load**. Workers has no
     sync fs at all - this must become a build-time-generated module
     (bake the resolved hrefs into a generated `.ts` file during
     `vite build --ssr`) instead of a runtime file read. This fixes both
     runtimes at once, not just Workers.
  4. **`ai.ts`** local mode (`ai.mode: "local"`) spawns a CLI via
     `node:child_process`. No Workers equivalent - must hard-error.
  5. **RichText Component Builder's "Build"** (`routes/richtext-components.ts`
     - `RichTextField/build-component-bundle.ts`) runs a nested Vite build
       via dynamic `import()`/`pathToFileURL` - Node-only, no Workers
       equivalent. Must hard-error on Workers.
  6. **`app-router/build-id.ts`** uses `node:crypto`'s `randomUUID` - trivial
     swap to the global `crypto.randomUUID()` (Web Crypto, portable to both
     runtimes), removing the dependency rather than relying on
     `nodejs_compat`.
  7. `content-types/types-cache.ts` writes `dry.generated.d.ts`'s copy via
     `node:fs/promises` - confirmed dev-only (mirrors `pagesCache`'s
     `import.meta.env.DEV` gate), not reachable at Workers runtime. No
     change needed, just confirm the gate still holds.

## Phase 1 - R2 storage backend

- Extend `DryStorageOption`/`DryIconsOption`/etc. in `options.ts`:
  `kind: "local" | "r2"`, `r2` variant takes a `binding` (name in
  `wrangler.jsonc`'s `r2_buckets[].binding`), mirroring how
  `ResolvedD1ContentOption`/`ResolvedKvOption`'s `D1`/`KV` variants already
  work (binding name resolved at config time, live object resolved
  per-request from `context.env`).
- New `src/storage/r2.ts` implementing the existing `StorageAdapter`
  interface (`src/storage/types.ts`) against an `R2Bucket`, parallel to
  `src/kv/cloudflare-kv.ts`'s existing shape.
- `createStorageAdapter()` needs a `context`/`env` parameter for the R2
  case, same per-request-vs-module-scope split `content-adapters.ts`
  already does for D1 (`getContentAdapters`). Every call site
  (`routes/storage.ts`, `routes/icons.ts`, `routes/richtext-components.ts`,
  `routes/page-components.ts`, `app-router/pages-cache.ts`) needs updating
  to thread `context.env` through.
- Single `R2Bucket` binding with a key-prefix per option (`storage/`,
  `icons/`, etc.) rather than one bucket per option, to keep
  `wrangler.jsonc` simple.

## Phase 2 - Static asset + shell serving on Workers

- Use Workers Static Assets (`wrangler.jsonc`'s `assets` config, `env.ASSETS`
  binding) instead of `node:fs`.
- New `src/server/entry-worker.ts`: `export default { fetch(request, env,
ctx) }`. Order: `handleApiRequest` for `${path}/api/*` → `guardPageRequest`
  → `handlePageRequest` for non-admin paths → else serve the admin shell
  (`env.ASSETS.fetch()` for `index.html`, with `injectClientConfig` applied
  to the text - same transform `entry-node.ts` does, just sourced from the
  Assets binding instead of `readFileSync`).
- No `adapters/worker.ts` bridging file is needed per `adapters/types.ts`'s
  own reasoning - `entry-worker.ts` is the "thin entry file" it describes,
  calling `handleApiRequest`/`handlePageRequest` directly.

## Phase 3 - Block Node-only features cleanly on Workers

- `ai.ts`: if `ai.mode === "local"` and the runtime is Workers, return a
  clear error instead of attempting `node:child_process` import.
- `routes/richtext-components.ts`'s Build handler: same treatment.

## Phase 4 - wrangler.jsonc + docs

- Add `wrangler.jsonc` at repo root: `d1_databases`, `r2_buckets`,
  `kv_namespaces` (if `kv.kind: "KV"`), `assets` config pointing at
  `dist/client`, `compatibility_date`/flags.
- `package.json`: new `build:worker`/`deploy` scripts.
- Update `docs/ARCHITECTURE.md`'s adapter section and add a short
  deployment doc for the Workers path.

# Status

**All 4 phases implemented and verified on `master` (2026-08-05).**

- Phase 1 (R2 storage): `options.ts` has `kind: "local" | "r2"` for
  `storage`/`icons`/`components.storage`/`pageComponents.storage`/
  `pagesCache.storage`/`typesCache.storage`. `src/storage/r2.ts` implements
  `StorageAdapter` over a hand-rolled `R2BucketLike` (no
  `@cloudflare/workers-types` dependency, matches `kv/cloudflare-kv.ts`'s
  existing approach) - folder emulation via a `.dir` marker + `delimiter:
"/"` listing, same convention `storage/local.ts` uses. `listAll()` is
  deliberately NOT implemented for R2 (matches `StorageAdapter.listAll`'s
  own doc comment on object-storage kinds). New
  `src/server/storage-adapters.ts`'s `getStorageAdapter()` resolves
  `"local"` once at module scope and `"r2"` fresh per-request from
  `context.env`, mirroring `content-adapters.ts`'s existing D1 split -
  threaded through `routes/storage.ts`, `icons.ts`, `richtext-components.ts`,
  `page-components.ts`, and `app-router/pages-cache.ts` (which now takes a
  `context` param, plumbed from `page-handler.ts`). RichText Component
  Builder's Build/rebuild (dynamic `import()` of a bundle straight off
  local disk) only ever worked with `kind: "local"` regardless of runtime -
  a new `requireLocalComponentsRoot()` guard makes that explicit instead of
  a raw type error or silent wrong behavior.
- Phase 2 (Workers entry): `app-router/assets.ts`'s runtime
  `readFileSync(manifest.json)` (the one truly Workers-incompatible piece -
  no sync fs on Workers, even under `nodejs_compat`) is gone. The pure
  resolver functions moved to `resolve-asset-href.ts` (needed a separate
  module - `vite.config.ts` loads the new build plugin directly, outside a
  real Vite pass, and a module with a top-level `import.meta.env.DEV` read
  throws in that context). `asset-hrefs-plugin.ts` calls them once, right
  after the CLIENT build finishes, and writes the resolved hrefs as plain
  string literals into `generated-asset-hrefs.ts` (checked in with an empty
  placeholder, regenerated by every production build - `assets.ts` only
  imports it under `!import.meta.env.DEV`). `src/server/entry-worker.ts` is
  the new Workers `fetch(request, env, ctx)` entry - no bridging code
  needed (`handler.ts`/`page-handler.ts`/`page-guard.ts` were already
  Fetch-shaped), just `entry-node.ts`'s same routing order (static asset →
  App Router page → admin shell) wired to `env.ASSETS` instead of
  `node:fs`.
- Phase 3: `ai.ts`'s `ai.mode: "local"` (`node:child_process` spawn) now
  fails through `loadNodeSpawn()` with a clear
  `` `ai.mode: "local"` requires Node... `` error instead of a raw
  module-resolution error; the streaming path's existing `.catch()` already
  surfaces it as a proper stream error event. `build-id.ts` swapped
  `node:crypto`'s `randomUUID` for the global Web Crypto one - no behavior
  change, just drops the one unnecessary Node-only import outside routes/
  storage. RichText Component Builder's build/rebuild was found to already
  be gated behind `import.meta.env.DEV` (pre-existing), so it needed no new
  Workers-specific gate beyond Phase 1's `requireLocalComponentsRoot()`.
- Phase 4: `wrangler.jsonc` added at repo root (D1/R2/KV binding
  placeholders + `assets` pointing at `dist/client`, `nodejs_compat` -
  required, `Buffer`/`Readable` are used throughout `src/server/**` and
  `storage/r2.ts`, same as the pre-existing `kv/cloudflare-kv.ts`).
  `package.json` gained `build:worker`/`deploy` scripts and a `wrangler`
  devDependency (`bun add -D wrangler`, network install succeeded).
  End-to-end verified: `bun run build:worker` produces a real
  `dist/server/entry-worker.js`, and `wrangler deploy --dry-run` parses the
  config, bundles the worker, and lists all 4 bindings correctly (D1, R2,
  KV, Assets) - build artifacts and the dry-run output dir were deleted
  after verification, nothing real was deployed.

`bun run typecheck` and `bun run test` both pass (691/692 - the one
remaining failure, `build-component-bundle.test.ts`, is pre-existing and
unrelated: a missing `src/dry-components/` fixture directory, confirmed via
`git log` to predate this work).

**Still open / explicitly out of scope for this pass:**

- `wrangler.jsonc`'s D1/R2/KV IDs are placeholders - real deployment needs
  the user to provision those Cloudflare resources themselves
  (`wrangler d1 create` / `r2 bucket create` / `kv namespace create`) and
  set `dry.config.ts`'s `content.engine: "D1"` / `storage.kind: "r2"` (etc.)
  - matching bindings.
- `docs/ARCHITECTURE.md`'s adapter section updated to describe both
  entries; the rest of that doc (content-engine table, storage kinds
  elsewhere) not swept for every stale "local only" mention.
- No CI/GitHub Actions wiring for the Workers deploy - `bun run deploy`
  is manual only.

## Follow-up: `dry.config.ts` collapsed to one `kind` field (2026-08-05)

Per-backend `kind`/`root`/`binding`/`file`/`engine` options (`storage`,
`icons`, `content`, `components.storage`, `pageComponents.storage`,
`pagesCache.storage`, `typesCache.storage`, `kv.kind`/`root`/`file`/
`binding`) are gone from `DryOption` entirely, replaced by one field:
`kind?: "local" | "R2"`. `resolveOptions()` derives all 8 sub-options from
it alone, using fixed binding names (`CONTENT_DB`/`MEDIA_BUCKET`/`KV`,
matching `wrangler.jsonc`) and fixed local directory/file basenames under
`.dry/` - `dry.config.ts` is now just `config({ ai: {...} })`, `kind`
defaults to `"local"`.

`kv`'s tuning knobs (`maxEntries`/`maxBytes`/TTLs/flush/`durability`) are
independent of backend choice, so they survive as a separate optional `kv`
block on `DryOption` (tuning only - no more `kv.kind`/`root`/`file`/
`binding`).

E2E test isolation (never touching a developer's real `.dry/` data) moved
from `dry.config.ts` branching into `resolveOptions()` itself, keyed off
the same `DRYCMS_E2E` env var `scripts/e2e-server.mjs` already sets - no
per-option override needed for that anymore either.

Unit tests that need real filesystem isolation (`mkdtempSync`) can't set a
per-option `root` anymore, so `resolveOptions()` gained a second parameter,
`overrides: { localDataRoot?: string }` - explicitly NOT part of
`DryOption` (a real `dry.config.ts` has no way to reach it), just a single
base-directory override every local default nests under. Updated
`options.test.ts` (full rewrite for the new API), `routes/auth.test.ts`,
`content-types/seed-assets.test.ts` to use it instead of per-option roots.

Verified: `bun run typecheck` clean, `bun run test` 689/690 (same one
pre-existing unrelated failure), `bun run build:worker` +
`wrangler deploy --dry-run` both still succeed with the new minimal
`dry.config.ts` and updated `wrangler.jsonc` comments.

## Follow-up 2: `kind` renamed to `"local" | "cloudflare"`, `ai` follows it too (2026-08-05)

Per user feedback, `"R2"` (too narrow - it's really "the whole Cloudflare
profile", not just the object-storage piece) renamed to `"cloudflare"`
everywhere: `DryOption.kind`, `ResolvedDryOption.kind`, the internal
`resolveStorageBackedOption`/`resolveContentOption`/`resolveKvOption`
parameter type, `wrangler.jsonc`'s comments, `dry.config.ts`. (The
lower-level per-backend `ResolvedStorageOption.kind: "r2"` - a different,
more specific enum about which storage adapter to construct - is unchanged;
only the top-level toggle's naming moved.)

`DryAiOption.mode` is gone - `ai.mode` is now derived from the same
top-level `kind` (`"local"` → CLI mode, `"cloudflare"` → HTTP-API mode via
a stored `aiKey` record), not set independently. `ai.provider` validation
now reads "when `kind` is `local`/`cloudflare`" instead of "when `ai.mode`
is `local`/`server`" in its error messages. `resolveAiOption()` takes
`kind` as its first parameter.

# Speed

Single-session implementation, all 4 phases + two `dry.config.ts`
simplification follow-ups completed and verified 2026-08-05. No open
blockers.

## Follow-up 3: first real deploy - 4 runtime blockers (2026-08-08)

The adapter had never actually been deployed until now. `wrangler deploy`
against a real account surfaced four distinct failures, three of which
Cloudflare hits while merely VALIDATING the uploaded script (it runs the
module's global scope before any request), so they failed the upload
outright rather than showing up as a bad response:

1. `content-types/seed-assets.ts` computed
   `new URL("./seed-assets.zip", import.meta.url)` at module scope.
   `import.meta.url` is not a resolvable base URL in workerd →
   `Uncaught TypeError: Invalid URL string`. Moved inside
   `extractPackagedSeedAssets`, plus an early return when no asset root is
   local (always the case under `kind: "cloudflare"`), so neither the URL
   nor `node:fs` is reached there at all.
2. `app-router/build-id.ts` called `crypto.randomUUID()` at module scope →
   `Disallowed operation called within global scope. ... generating random
   values are not allowed within global scope`. `BUILD_ID` (a const) became
   `buildId()` (memoized on first call). Both call sites in `pages-cache.ts`
   are request-time, so the value is as stable as the const was. The old doc
   comment's claim that this "works unchanged on a Workers isolate" was
   simply wrong.
3. The SSR bundle's entry chunk re-exported every shared module the
   `src/apps/pages/**` chunks also used (`export { ..., REF_SYMBOL as o,
   ... }`) - normal rollup code-splitting. workerd validates EVERY export of
   the entry as a handler → `Incorrect type for map entry 'o': the provided
   value is not of type 'function or ExportedHandler'`. Fixed with
   `inlineDynamicImports: true` for the worker build only, gated on a new
   `DRYCMS_WORKER_BUILD=1` env var set in `build:worker` (`isSsrBuild` alone
   can't tell the Node and Workers SSR builds apart). Costs nothing:
   `wrangler deploy` concatenates the whole graph into one script anyway.
   The Node build still code-splits as before.
4. Runtime, after the script finally booted: registering the first admin
   500'd with `NotSupportedError: Pbkdf2 failed: iteration counts above
   100000 are not supported (requested 210000)`. Workers caps PBKDF2 at
   100,000 and offers no scrypt/argon2 to trade up to, so
   `lib/password-hash.ts`'s OWASP-minimum 210,000 is unreachable there.
   Since the old `v1:` format stored only `salt:hash` (count implied by a
   constant), lowering the constant would have invalidated every existing
   hash - so a `v2:<iterations>:<salt>:<hash>` format now carries the count,
   `v1:` still verifies at 210,000 (works on Node; unverifiable on Workers,
   where `verifyPassword`'s new try/catch returns `false` instead of
   throwing a 500), and new hashes are written at the 100,000 cap.

Debugging note: `wrangler dev --local` reproduces 1-3 exactly (same workerd
validation), which is far faster than round-tripping through a Cloudflare
build. `wrangler tail --format json` caught #4, whose detail
`routes/auth.ts`'s `errorResponse` deliberately hides from the client
(`{"error":"internal"}`). `wrangler tail` needs shell job control
(`nohup ... &` + `disown`); it produced no output under the agent harness's
own background-process mechanism.

Deployment also needs three secrets set on the Worker - `DRYCMS_SECRET_KEY`,
`DRYCMS_JWT_ACTIVE_KID`, `DRYCMS_BOOTSTRAP_TOKEN` (>=32 chars, gates
`register-first-admin`). Set them with an interactive `wrangler secret put`,
never `echo x | wrangler secret put`: the trailing newline `echo` adds
passes the length check but can never match what the form sends, because
`Headers` strips whitespace on the client side while an env var is compared
raw - a silent, permanent "The bootstrap token is invalid."

Verified end-to-end on `wrangler dev --local`: register-first-admin → 201
with the Super Admin role attached, login → 200, wrong password → 401.

## Follow-up 4: the public site (`src/apps/pages/**`) on Workers (2026-08-08)

With the Worker finally booting, the App Router pages were still broken in
production - two unrelated causes, neither of which the other's fix touches:

5. `content-types/seed.ts`'s `loadPackagedSeed()` read `dry.seed.json` with
   `readFileSync(process.cwd() + ...)`. Workers has no filesystem, and the
   read's absence-tolerating `catch` turned that into SILENCE: the deployed
   instance seeded only `defaultContentTypeDefinitions()` (10 built-ins,
   confirmed against the real D1 - no `about`/`blog`/`contact` tables), so
   every page reading an app content type 500'd with
   `dry().singleton("about") - no content type named "about" exists` and
   rendered `500.tsx`. Now a plain static `import ... from
   "../../dry.seed.json"` - the one form that works BOTH under Vite (bundled,
   no I/O) and under plain `bun scripts/*.ts` (which is why the original
   comment ruled out `import.meta.glob`, correctly, but then picked an
   equally runtime-specific alternative). Needs `resolveJsonModule` in
   `tsconfig.json`. Absence is now a build error rather than a silent
   fallback - deliberate: silence is what hid this.
6. `/` never reached the Worker at all. Cloudflare's asset layer answers
   before the Worker runs, and `/` matches `dist/client/index.html` - the
   ADMIN shell - so the site's root page was unreachable and `/` served the
   admin SPA. `entry-worker.ts` already excludes `pathname === "/"` from its
   own asset branch for exactly this reason, but that code never ran. Fixed
   with `assets.run_worker_first: ["/"]` in `wrangler.jsonc`, scoped to `/`
   alone so real assets still skip the Worker entirely.

Proof for #6 (worth repeating for any future "is my route reaching the
Worker?" question): request `/?probe=root` and `/contact?probe=yes` while
`wrangler tail` runs - only `/contact` appears in the log.

Two `entry-codec.test.ts` assertions had hard-coded `/^v1:/` on the password
column; they now assert through `verifyPassword` instead, which tests the
actual intent ("the column holds a hash of what was typed") without coupling
to `password-hash.ts`'s format version. The "ignores `.confirm`" case got
strictly stronger: it now also asserts `confirm`'s value does NOT verify.

Verified on `wrangler dev --local` against a wiped `.wrangler/state`: 28
tables seeded (incl. `about`/`blog`/`contact`), `/` `/about` `/blogs`
`/contact` all render real pages (no `500.tsx`, no admin shell), unknown path
404s, `/dry` still serves the admin shell, `/assets/*` still served directly.
Test suite: 16 failures before and after, all pre-existing (`seed.test.ts`
and friends expect 10 built-in types while `dry.seed.json` now carries 35) -
979 passing, up 2 from the new password-hash cases.
