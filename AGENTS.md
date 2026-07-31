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

`bun run typecheck` runs `tsc --noEmit` over `src/` (excluding `*.test.ts` -
tests are type-checked implicitly by vitest's own transform, not by `tsc`).

## Status tracking

For substantial or multi-step work (not one-off edits), track progress in a
`status/<task-name>.md` file with three sections: `Plan`, `Status`, `Speed`
(progress/pace, blockers). Update that file as work proceeds instead of
re-narrating full details in chat - keep chat replies to brief, high-signal
updates only. This keeps long-running task context out of the conversation
history without hiding what's happening: the user can always open the file
for the full picture.
