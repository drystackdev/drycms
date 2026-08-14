# Page Editor file-cache audit

## Plan

- Trace the IndexedDB page-source cache and every Page Editor load/save/move/delete path.
- Compare cache reconciliation against server tree/file semantics, drafts, restore/reset, and concurrent changes.
- Run focused tests or small reproductions and report findings without changing product code.
- Follow-up: audit whether page code still depends on materialized
  `src/apps/{pages,component,styles,md}` and identify stale docs/tooling.

## Status

- Complete. The saved-source cache is a fixed-name browser IndexedDB with a
  `files` store keyed only by path and one `tree` snapshot.
- On Page Editor mount, the cached tree/source paints first; the server tree
  is then fetched, missing paths are deleted from IndexedDB, and every current
  source file is fetched and compared by exact source-string equality.
- `updatedAt` is recorded but never consulted. There is no mtime, ETag,
  content hash, version request, conditional GET, polling, or cross-tab sync.
- Deletion is eventually reconciled correctly after a successful fresh tree
  fetch (`PageEditor.tsx:899-903`; post-mutation `loadTree`: 821-829).
- Modification is eventually reconciled on mount/loadTree by downloading the
  full file and comparing strings (`PageEditor.tsx:906-910`). Ordinary save
  paths do not write through to IndexedDB, so their browser cache stays stale
  until that later reconciliation (`PageEditor.tsx:1150-1160,1221-1234`).
- High-risk race: the background mount sync can overwrite edits typed after
  hydration began. `applyFresh` decides whether to preserve a draft from the
  mount-time `draftMap`, then unconditionally replaces the current in-memory
  source (`PageEditor.tsx:906-910`). Clicking/typing in a file while its
  background GET is in flight can lose the new buffer and its draft write can
  subsequently persist the lost value depending on timer ordering.
- High-risk error path: full `loadTree` converts every failed file GET into an
  empty string, then treats/caches it as authoritative (`PageEditor.tsx:
  819-827`). A transient per-file failure after create/delete/move/restore can
  blank the editor state and poison the saved-source cache; its doc claim of
  a guaranteed-current map is false.
- Medium: when the server-tree refresh fails and any file cache exists, the
  mount flow silently keeps the stale snapshot and suppresses the load error
  (`PageEditor.tsx:886-893`). There is no stale/offline indicator.
- Medium/architecture: the fixed IndexedDB name and path-only keys are not
  scoped by admin base path/project (`page-source-cache-db.ts:14-18`). Two
  drycms instances sharing one origin can show and reconcile each other's
  cached paths until network refresh finishes.
- Efficiency gap: every mount downloads every source file; the cache saves
  first-paint latency but does not save file network reads.
- No focused unit/e2e coverage exists for this cache/reconciliation flow.
- Validation: `bun run typecheck` passes.
- Follow-up result: runtime page code no longer depends on any materialized
  `src/apps/{pages,component,styles,md}` tree. Dev reads live
  `pagesSourceStorage`; production serves `built/live/*`; VEI and Page Build
  fetch/compile from the storage API in the browser. `route-tree.ts` has no
  production glob anymore and `page-handler.ts` never discovers routes in
  production.
- Empirical validation: from a clean `git archive` checkout containing only
  the committed `src/apps` runtime files (`vei/**`, hydration/runtime entry
  files) and none of the four generated roots, both `bun run build:worker`
  and a Node SSR Vite build completed successfully.
- Remaining obsolete behavior: `package.json` still pulls before Node build
  and before `dev:worker`; `watch-pages-worker.mjs` still pulls/rebuilds the
  Worker on every local R2 blob write; `sync-pages-r2.ts` and `pages:sync`
  still implement the old materialization flow; Vite still conditionally
  builds `src/apps/styles/globals.css` and points the production component
  alias at `src/apps/component`. Browser-built pages explicitly suppress
  that CSS href and inline current pages-source CSS instead.
- Standing docs/config comments that are materially stale: `AGENTS.md`'s
  entire two-copy/materialization section; `docs/README.md:20-24`;
  `docs/APP-ROUTER.md:7-9,49-53,190-203`; `docs/DEPLOYMENT.md:54-58`;
  plus comments in `.gitignore`, `tsconfig.json`, `vite.config.ts`,
  `vitest.config.ts`, `server/options.ts`, `source-roots.ts`, `route-tree.ts`,
  `page-handler.ts`, hydration/client reader files, and scripts. Historical
  `plans/`/`status/` contain many old references but are explicitly
  non-authoritative and should generally remain historical.
- `src/apps` itself must NOT be removed wholesale: committed generic runtime
  entries such as `hydrate-built.ts`, `vei-live-refresh.ts`, `vei/**`,
  `preact-runtime.ts`, and `build-preact-runtime-bundle.ts` are still live.
- Follow-up implementation complete: removed the three obsolete sync/watcher
  scripts and their package commands/hooks; removed generated
  `src/apps/{pages,component,styles,md}` content and ignore rules; removed the
  Vite production CSS input/materialized component alias and the legacy
  `src/apps/pages` transform/HMR branch; production CSS href is now explicitly
  empty while dev still serves the live storage file; updated focused tests,
  user-facing permission text, runtime comments, AGENTS.md, and standing docs.
- Validation after implementation: `bun run typecheck`, focused router/asset/
  page-handler tests, `bun run build` (Node), and `bun run build:worker` pass.
  Full Vitest: 1386/1387 pass; the sole failure is the unrelated existing D1
  entries smoke assertion (`entries-d1.test.ts:79`, seeded `menu` count is 2
  while the test expects 1), reproducible when run alone and untouched by this
  change.

## Speed

- Migration cleanup complete. The earlier cache audit remains diagnosis-only;
  the follow-up pages-source architecture cleanup is implemented and verified.
