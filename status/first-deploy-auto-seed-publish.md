# First-deploy auto-seed + auto-publish

## Plan

Two asks from the user (Vietnamese): after a fresh tenant deploy,
1. push the sample/starter files (`.tsx`/`.css`/`.md`) up to `pagesSourceStorage`
   (R2 in prod) automatically, instead of requiring `bun run pages:sync
   --push --remote` by hand.
2. auto-run "Publish all" if the built/live registry (`_pages`) has zero rows.

Confirmed with the user: (1) runs server-side, on every `GET
/api/auth/session` request (independent of the EMAIL_ADMIN/PASSWORD_ADMIN
auto-bootstrap already in flight), gated by an in-memory one-shot flag so
the real cost (a storage `listAll`) only ever hits once per isolate. (2)
CANNOT run server-side - building a page needs the admin SPA's own
Sucrase/Tailwind pipeline (`page-build.ts`'s `buildPage`/`compileEsmAsset`),
which doesn't exist under Node/Workers request handling (confirmed via
`runtime-env.ts`'s documented workerd crash trying exactly this). User
agreed: (2) runs in the BROWSER, the first time an authenticated admin's
session loads, mirroring the existing `rebuildAffectedPages` headless
in-process pattern (not the VEI hidden-iframe indirection - that one exists
only because VEI ships inside the public-site bundle without Sucrase/
Tailwind; the admin SPA already has it).

Sample content source: today's earlier session already committed real
starter files into git under `src/apps/{pages,component,styles,md}/**`
(commits `cf280b7`/`d83e235`) and un-ignored them in `.gitignore` - reused
as the seed source via Vite's eager raw-text glob (same mechanism
`ai-page-source-docs.ts` already uses for `docs/*.md`), NOT a runtime
`fs.readFile` (breaks under `kind: "cloudflare"`).

Files:
- NEW `src/server/app-router/sample-pages-source.ts` - raw-glob manifest.
- NEW `src/content-types/seed-pages-source.ts` - `seedPagesSourceIfEmpty`.
- NEW `src/page-components/initial-publish.ts` - `publishAllPages` (client).
- EDIT `src/server/routes/auth.ts` - wire seed + `needsInitialPublish` flag
  into the `session` GET response.
- EDIT `src/store/auth.ts` - carry `needsInitialPublish` on `AuthState`.
- EDIT `src/routers/App.tsx` - `AuthenticatedApp` fires `publishAllPages`
  once, gated on `PAGE_BUILDER_RESOURCE_ID` permission.

Known doc debt (NOT fixing here, flagged to the user separately): AGENTS.md
still describes `src/apps/pages/**` as "gitignored, NOT hand-edited" - now
stale since `cf280b7`/`d83e235`.

## Status

Done. Implemented, unit-tested (1278/1278 pass, typecheck clean), and
verified live against a fresh `bun run dev:worker` instance (real local
D1/R2 simulation, `.wrangler` state wiped first for a genuine "fresh tenant"
test):
- `GET /api/auth/session` on an empty `sivelap-content` bucket correctly
  wrote all 11 starter files under `pages-source/**` (curl + the wrangler
  Local Explorer API's R2 listing confirmed the exact keys/sizes).
- `POST /api/auth/register-first-admin` correctly returned
  `needsInitialPublish: true` against the empty `_pages` D1 table.
- Client-side auto-publish trigger (`AuthenticatedApp`'s effect ->
  `publishAllPages`) is typechecked and confirmed present in the built
  client bundle (`needsInitialPublish` string found in `dist/client/assets/
  main-*.js`), but NOT exercised in a live browser this session - the
  shared Playwright MCP browser profile was locked by another concurrent
  session/task and left alone rather than force-taken.
- `dev:worker` process stopped and `.wrangler` deleted afterward per the
  user's own instruction.

## Speed

Single session, complete. Follow-up if wanted: a live-browser pass once the
shared Playwright browser is free, and fixing AGENTS.md's stale
"`src/apps/pages/**` gitignored, NOT hand-edited" line (now inaccurate).
