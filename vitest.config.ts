import { defineConfig } from "vitest/config";

/**
 * Separate from `vite.config.ts` on purpose: without an explicit `include`,
 * vitest globs `**\/*.test.ts` from the repo root, which also picks up
 * `e2e/**` (Playwright specs, fail immediately under vitest's `test`/
 * `expect`), the vendored `packages/Sortable-master`, and the unrelated
 * `packages/drystack` project living alongside this one. Scoping to `src/`
 * matches drycms's own test layout - same scope the old
 * `bun run --cwd packages/drycms test` had before the migration
 * (see `status/remove-astro.md`).
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
