## Before coding

Read `docs/README.md` first - it indexes `docs/ARCHITECTURE.md` (how the
app works), `docs/DESIGN.md` (visual system + CSS conventions), and
`docs/CODING-PRINCIPLES.md` (standing rules for how changes get made here).
They capture decisions and gotchas that aren't obvious from reading a single
file in isolation.

## Layout

drycms is a standalone Preact app - no Astro, no separate library package.
`packages/drycms` no longer exists; everything lives directly under `src/` at
the repo root (see `status/remove-astro.md` for the migration this replaced).

- `src/` - the whole app: Preact components/pages/routers, plus `src/server/`
  (the API route handlers, config resolution, and adapters).
- `src/server/handler.ts` - the whole server-side API surface as one
  Fetch-API-shaped function (`Request` in, `Response` out).
- `src/server/adapters/node.ts` - the Node bridge (the only adapter
  implemented today; `adapters/types.ts` documents the contract a future
  Workers/Bun adapter would follow).
- `dry.config.ts` (repo root) - the app's own config (path/storage/icons/
  content/richtext), resolved once at server startup by
  `src/server/options.ts`'s `resolveOptions`.
- `vite.config.ts` - client build config (Preact via `@preact/preset-vite`).

Everything under `src/` is real TypeScript/TSX, transformed by Vite - no
separate compile step, and no directory needs a manual rebuild to pick up
changes (dev server + Vite HMR cover all of it, server code included - see
below).

### Two page-source roots - never delete one because the other looks redundant

The site's own pages/layouts (as opposed to the admin app) exist in TWO
separate places that look like duplicates of each other but are not:

- `src/apps/pages/**` (git-tracked) - `page.tsx`/`layout.tsx`/`404.tsx`/
  `500.tsx`/etc., read via `import.meta.glob`. `src/server/page-handler.ts`
  renders EXCLUSIVELY from here for **every dev-server request, and any
  VEI-authenticated session in prod** - this is a hard runtime dependency,
  not a fallback: deleting a file here breaks that page in `bun run dev`
  immediately, even if the exact same content also exists in
  `pagesSourceStorage`/has been "built" through `/dry/page-build`.
- `.dry/pages-source/` locally (`pagesSourceStorage` generally, git-ignored)
  - the SAME pages authored/edited through the browser at `/dry/page-editor`
    (`PageEditor.tsx`) instead of committed to git. This is what the app-r2
    browser build pipeline compiles and publishes to `built/live/*`, which
    `page-handler.ts` serves in prod for an ordinary (non-VEI) visitor
    instead of live-rendering - see that file's own doc comment for the
    full prod-vs-dev split.

The two roots are kept in sync only by `scripts/sync-pages-r2.ts`'s
`push`/`pull` (both never-overwrite; auto-run in that order on every
`bun run dev` startup) - editing one does not update the other outside that
sync. **Before deleting or treating anything under `src/apps/pages/**` as
dead/unused, check whether it's actually unreferenced** (e.g. via
`git log`/a real usage search) rather than assuming `pagesSourceStorage`
having the same-looking content makes the git copy redundant - it does not,
and removing it 404s the live dev server. `.dry/pages-source/**/*.tsx` (and
`.dry/components`, `.dry/richtext-components`, once non-empty - the same
category for Component Builder) are included in `tsconfig.json` alongside
`src/**` for IDE/typecheck purposes, but the rest of `.dry/` (`types-cache`,
`pages-cache`, `kv`, `content.sqlite`) is pure generated/runtime data, never
source - don't add it to `include` even if a file there has a `.ts`/`.d.ts`
extension.

## Development

Start the dev server in the background:

```
bun run dev &
```

This runs `scripts/dev-server.mjs`, a plain-JS entry that boots Vite in
middleware mode and loads every `src/server/**` module through
`vite.ssrLoadModule` - so server code hot-reloads exactly like client code,
no separate watch/build step. Serves on `http://localhost:5173` (base path
`/dry` by default, see `dry.config.ts`).

Production build: `bun run build` (client via `vite build`, server via
`vite build --ssr src/server/entry-node.ts`), then `bun run start` runs the
built `dist/server/entry-node.js` with plain `node`.

Unit tests live under `src/` and run with `bun run test` (vitest, scoped to
`src/**/*.test.ts` by `vitest.config.ts` - it does NOT pick up `e2e/` or
other packages in this repo). End-to-end tests (Playwright) live in `e2e/`
at the repo root and run with `bun run test:e2e` against a running dev
server.

`bun run typecheck` runs `tsc --noEmit` over `src/` plus
`.dry/pages-source/**/*.tsx` (excluding `*.test.ts` - tests are type-checked
implicitly by vitest's own transform, not by `tsc`) - see `tsconfig.json`'s
own comment for why that one `.dry/` subdirectory is included.

## Status tracking

For substantial or multi-step work (not one-off edits), track progress in a
`status/<task-name>.md` file with three sections: `Plan`, `Status`, `Speed`
(progress/pace, blockers). Update that file as work proceeds instead of
re-narrating full details in chat - keep chat replies to brief, high-signal
updates only. This keeps long-running task context out of the conversation
history without hiding what's happening: the user can always open the file
for the full picture.
