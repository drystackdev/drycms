import { defineConfig } from "vitest/config";
import { appRouterPlugin } from "./src/server/app-router/app-router-plugin.js";

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
  // `appRouterPlugin` transforms local `pagesSourceStorage` modules and the
  // synthetic paths in its focused tests - injects the
  // `dry()`/`params()`/`setTitle()` ambient-global imports real page/layout
  // source calls without importing itself, same as `vite.config.ts` wires up
  // for the real dev server.
  plugins: [appRouterPlugin()],
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
