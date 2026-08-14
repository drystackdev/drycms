# Plan

- Trace the browser-side Tailwind compilation used by Page Editor preview and published page builds.
- Compile against the live `styles/globals.css` dependency graph, not a bare Tailwind import.
- Add regression coverage and run focused tests, typecheck, and production build.

# Status

- Root cause confirmed: rendered HTML contains `bg-primary`, but the compiler input omits `styles/theme.css`, so Tailwind never generates custom-token utilities.
- Preview and publish now expand the live `styles/globals.css` import graph and pass it to the isolated Tailwind compiler.
- Added regression tests for custom theme input, missing imports, and circular imports.
- Focused tests pass (16/16); the full production build passes.
- `bun run typecheck` remains blocked by pre-existing generated `src/apps/component/**` alias errors (`@component/lib/cva`, `@component/lib/utils`).
- Browser QA could not run because no in-app/external browser instance is available in this session.

# Speed

- Implementation complete. Browser visual QA is the only unavailable check; build and focused tests are green.
