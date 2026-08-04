# DryCMS

A self-hosted, attribute-styled Preact CMS admin UI - no Astro, served by a
pluggable server adapter (Node by default; Cloudflare Workers and Bun are on
the roadmap, see `src/server/adapters/`).

```sh
bun install
bun run dev      # http://localhost:5173, base path /dry by default
```

See `AGENTS.md` for the full layout and development workflow, and
`dry.config.ts` for configuration (storage/icons/content backends, base
path). With the default local configuration, runtime data is kept under
`.dry/` (explicit paths in `dry.config.ts` remain unchanged).

## Commands

| Command              | Action                                                |
| :-------------------- | :---------------------------------------------------- |
| `bun run dev`          | Start the dev server (Vite + Node, HMR incl. server code) |
| `bun run build`        | Build the client bundle and the Node server bundle     |
| `bun run start`        | Run the production build (`dist/server/entry-node.js`) |
| `bun run test`         | Unit tests (vitest)                                    |
| `bun run test:e2e`     | End-to-end tests (Playwright, needs a running dev server) |
| `bun run typecheck`    | `tsc --noEmit`                                          |
