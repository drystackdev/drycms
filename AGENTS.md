## Layout

This is a bun workspace. The root is a demo Astro app; the library lives in
`packages/drycms` and is linked in as `drycms`.

Only the `.ts`/`.tsx` sources are compiled (to `packages/drycms/dist`). The
`.astro`, `.css` and route files are served straight from `src`, so editing them
hot-reloads - but **editing anything under `packages/drycms/src/integration` or
`packages/drycms/src/components` requires a rebuild**:

```
bun run build:lib     # one-off
bun run dev:lib       # tsc --watch, run alongside the dev server
```

`bun run dev` and `bun run build` already run `build:lib` first.

## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

Unit tests live in `packages/drycms` and run with `bun run test`. End-to-end
tests (Playwright) live in `e2e/` at the repo root and run with `bun run test:e2e`
against a running dev server.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
