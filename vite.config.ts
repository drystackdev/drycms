import tailwindcss from "@tailwindcss/vite";
import preact from "@preact/preset-vite";
import { defineConfig } from "vite";
import { appRouterPlugin } from "./src/server/app-router/app-router-plugin.js";

export default defineConfig(({ isSsrBuild }) => ({
  // `appRouterPlugin` (`enforce: "pre"`) injects `dry()`'s import for
  // `src/apps/pages/**` before Preact's own JSX transform runs (a
  // server-real or client-replay version depending on
  // `this.environment.config.consumer` - see the plugin's own doc comment)
  // - see `plans/app-router.md`'s "Quyết định kiến trúc" #4 - and forces a
  // full reload on `src/apps/pages/**`/`globals.css` changes, since
  // `hydrate-client.ts` is a separate bundle Vite's normal per-module HMR
  // doesn't connect a `page.tsx`/`layout.tsx` edit to (the server-rendered
  // HTML it hydrates against would go stale otherwise).
  // `tailwindcss()` only transforms CSS files that `@import "tailwindcss"`
  // themselves (`src/apps/globals.css` - see "CSS: 1 file chung" in the
  // same doc) - the admin's own hand-rolled `.css` files (`docs/DESIGN.md`)
  // never opt in, so this is safe to register globally rather than needing
  // a separate Vite config just for `src/apps`.
  plugins: [appRouterPlugin(), tailwindcss(), preact()],
  build: {
    // Showcase intentionally bundles every component demo into one route
    // chunk; it is lazy-loaded from the app shell, so this size is not part of
    // the initial path. Keep Vite's warning threshold above that deliberate
    // demo bundle while retaining the default warning for normal chunks.
    chunkSizeWarningLimit: 1024,
    // `isSsrBuild` only (never) applies to `vite build --ssr entry-node.ts`
    // - CLI `--ssr <entry>` makes `<entry>` the sole rollup input for that
    // build regardless of `rollupOptions.input` here, so this block only
    // ever affects the plain client build (`vite build --outDir dist/client`).
    // `appsGlobals`/`appsHydrate` are App Router's Tailwind output + client
    // hydration bootstrap, built+hashed like any other asset - see
    // `app-router/assets.ts`, which reads the resulting `manifest.json` to
    // find them at runtime (`plans/app-router.md`'s Giai đoạn 3/2).
    ...(isSsrBuild
      ? {}
      : {
          rollupOptions: {
            input: {
              main: "index.html",
              appsGlobals: "src/apps/globals.css",
              appsHydrate: "src/apps/hydrate-client.ts",
            },
          },
          manifest: true,
        }),
  },
  resolve: {
    // Keep `preact-iso` and the app on one Preact singleton.
    dedupe: [
      "preact",
      "preact/hooks",
      "preact/jsx-runtime",
      "preact/jsx-dev-runtime",
    ],
  },
  optimizeDeps: {
    // Prebundling `preact-iso` embeds a second Preact module in Vite dev.
    exclude: ["preact-iso"],
  },
}));
