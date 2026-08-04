import tailwindcss from "@tailwindcss/vite";
import preact from "@preact/preset-vite";
import { defineConfig } from "vite";
import { dryGlobalPlugin } from "./src/server/app-router/dry-global-plugin.js";

export default defineConfig({
  // `dryGlobalPlugin` (`enforce: "pre"`) injects `dry()`'s import for
  // `src/apps/pages/**` before Preact's own JSX transform runs - see
  // `plans/app-router.md`'s "Quyết định kiến trúc" #4. `tailwindcss()` only
  // transforms CSS files that `@import "tailwindcss"` themselves
  // (`src/apps/globals.css` - see "CSS: 1 file chung" in the same doc) -
  // the admin's own hand-rolled `.css` files (`docs/DESIGN.md`) never
  // opt in, so this is safe to register globally rather than needing a
  // separate Vite config just for `src/apps`.
  plugins: [dryGlobalPlugin(), tailwindcss(), preact()],
  build: {
    // Showcase intentionally bundles every component demo into one route
    // chunk; it is lazy-loaded from the app shell, so this size is not part of
    // the initial path. Keep Vite's warning threshold above that deliberate
    // demo bundle while retaining the default warning for normal chunks.
    chunkSizeWarningLimit: 1024,
  },
  resolve: {
    // Keep `preact-iso` and the app on one Preact singleton.
    dedupe: ["preact", "preact/hooks", "preact/jsx-runtime", "preact/jsx-dev-runtime"],
  },
  optimizeDeps: {
    // Prebundling `preact-iso` embeds a second Preact module in Vite dev.
    exclude: ["preact-iso"],
  },
});
