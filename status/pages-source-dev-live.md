# `.dry/pages-source` as dev's live app-router source

## Plan
Full plan: `/Users/kcoder/.claude/plans/enumerated-zooming-truffle.md`.

1. `scripts/sync-pages-r2.ts` push/pull become full mirror (always overwrite), matching `r2-sync-assets.ts`.
2. Dev's `discoverRoutes()`/`page-handler.ts`/sitemap read live pages from `pagesSourceStorage`
   (`.dry/pages-source`) via a new `DevPagesSource` seam backed by `vite.ssrLoadModule`, instead of
   the compile-time `import.meta.glob` over `src/apps/pages`. `app-router-plugin.ts`'s ambient-global
   injection gate widens to also cover the storage root. Client hydration (`hydrate-client.ts`) needs
   its own fix (dev-only manifest tag) since it independently globs `src/apps/pages` in the browser.
3. `src/apps/pages` becomes a gitignored, build-time-only artifact, materialized by `pages:sync --pull`
   (local for `build`, `--remote` for `build:worker`) right before `vite build`. Production's render
   path (Worker bundling, VEI live-render) is otherwise unchanged.
4. Required follow-on fixes: `scripts/new-project.ts` (writes starter site into `src/apps/pages`
   today - must target `pagesSourceStorage` instead), `page-handler.test.ts`'s dev-branch tests
   (depend on real `src/apps/pages` files on disk - must use an injected fixture instead).

## Status
All 3 parts + required follow-ons implemented and verified:

1. `scripts/sync-pages-r2.ts` push/pull rewritten to unconditional-overwrite
   mirror semantics.
2. `route-tree.ts` (`DevPagesSource`, async `discoverRoutes`), `page-handler.ts`,
   `sitemap.ts`, `app-router-plugin.ts` (widened ambient-global gate),
   `dev-server.mjs` (builds `devPagesSource`, dropped the old boot-time
   push+pull), `hydrate-client.ts`+`render.ts` (dev hydrate manifest for
   client-side hydration) all done. Verified live: edited
   `.dry/pages-source/about/page.tsx` while `bun run dev` was running,
   confirmed the site + a real headless-Chromium hydration pass
   (`window.dryHydrated === true`, zero console errors) reflected it with no
   restart; confirmed `dry()` now resolves (ReferenceError before the fix).
3. `.gitignore` now ignores `/src/apps/pages/`; `bun run build` runs
   `pages:sync --pull` (local) first and was verified end-to-end (real
   `vite build` picked up the freshly materialized pages).
4. `scripts/new-project.ts` now writes the starter site into
   `pagesSourceStorage` instead of `src/apps/pages`. `page-handler.test.ts`'s
   dev-branch tests use an injected `DevPagesSource` fixture instead of real
   files - verified passing even with `src/apps/pages` temporarily removed.

Known deviation from the original plan, decided live with the user:
`build:worker` does NOT auto-pull from R2 before building. `pull`'s R2
branch calls `wrangler r2 object list`, which doesn't exist in the
installed `wrangler` (4.120.0 - only `get`/`put`/`delete` do), discovered
by actually running `bun run build:worker`. Fixing that needs a real
Cloudflare-API/S3-compatible listing call, out of scope here. Until then:
`push`/`get`/`put` all work fine - keep R2 in sync by hand with
`bun run pages:sync --push --remote` before `deploy`.

Not done (deliberately, needs the user - writes to production R2):
the one-time `bun run pages:sync --push --remote` migration to seed R2 with
the current `src/apps/pages` content before it stops being git's source of
truth. `src/apps/pages`'s working tree currently holds content pulled from
`.dry/pages-source` during verification (uncommitted, from testing `bun run
build`) - review with `git diff`/`git status` before committing.

## Speed
Done. `bun run typecheck` and `bun run test` both clean (same 12
pre-existing, unrelated failures as the baseline - confirmed via `git
stash`). `bun run build` and `bun run build:worker` both verified with a
real run.
