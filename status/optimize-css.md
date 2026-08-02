# Plan

- Remove stale carousel rules that have no matching markup.
- Replace repeated neutral color expressions and hardcoded colors with design tokens.
- Remove unused OverlayScrollbars stock theme declarations only if the app does not reference them.
- Build and typecheck the app, then compare the generated CSS and inspect the diff.

# Status

- Completed the safe CSS cleanup and token consolidation.
- Removed stale `.dry-carousel*` rules; the runtime component keeps its own `.carousel__*` stylesheet.
- Replaced repeated neutral colors and hardcoded app colors with tokens.
- Kept the upstream OverlayScrollbars structural stylesheet unchanged for compatibility.
- `bun run typecheck` passed.
- `bun run test` passed: 55 files, 588 tests.
- `bun run build` passed; generated CSS is 128.01 KB / 20.74 KB gzip.
- Playwright computed-style and light/dark screenshot checks passed against the running dev server.

# Speed

- Started from a clean working tree.
- Completed in one implementation pass; no blockers.
