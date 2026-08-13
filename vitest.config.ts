import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { appRouterPlugin } from "./src/server/app-router/app-router-plugin.js";
import { COMPONENT_ALIAS, COMPONENT_ROOT } from "./src/server/app-router/source-roots.js";

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
  // `appRouterPlugin`'s `transform` only touches files under `src/apps/pages/`
  // or the local `pagesSourceStorage` root (see its own gate) - injects the
  // `dry()`/`params()`/`setTitle()` ambient-global imports real page/layout
  // source calls without importing itself, same as `vite.config.ts` wires up
  // for the real dev server/build. `page-handler.test.ts`'s prod branch now
  // renders the real `src/apps/pages/404.tsx`/`500.tsx` (mục 12's
  // `readBuiltPage` miss fallback), which calls `setTitle()` bare - without
  // this, that render throws `setTitle is not defined` under vitest's own
  // Vite instance, which never had this plugin registered before.
  plugins: [appRouterPlugin()],
  test: {
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
  resolve: {
    alias: {
      // `page-handler.test.ts` renders the real `src/apps/pages/404.tsx`
      // (`@component/Button`) through `handlePageRequest`'s prod branch -
      // same target `vite.config.ts`'s own `COMPONENT_ALIAS` resolves to for
      // a real build (vitest has no "serve"/"build" `command` of its own to
      // branch on, and the live `.dry/pages-source` copy isn't guaranteed to
      // exist in a fresh checkout, so the committed `src/apps/component/`
      // starter is the only target that's always there).
      [COMPONENT_ALIAS]: fileURLToPath(new URL(`./src/apps/${COMPONENT_ROOT}/`, import.meta.url)).replace(/\/$/, ""),
    },
  },
});
