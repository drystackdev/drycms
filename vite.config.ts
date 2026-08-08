import tailwindcss from "@tailwindcss/vite";
import preact from "@preact/preset-vite";
import { defineConfig } from "vite";
import { appRouterPlugin } from "./src/server/app-router/app-router-plugin.js";
import { assetHrefsPlugin } from "./src/server/app-router/asset-hrefs-plugin.js";

// Set by `bun run build:worker` only - `isSsrBuild` alone can't tell the
// Workers build apart from the Node one (both are `vite build --ssr`), and
// the two need different chunking (see `inlineDynamicImports` below).
const isWorkerBuild = process.env.DRYCMS_WORKER_BUILD === "1";

export default defineConfig(({ isSsrBuild, command }) => ({
  /**
   * `public/` is NOT a static-asset folder here - `options.ts`'s
   * `resolveStorageOption` makes it the File Manager's own root under
   * `kind: "local"`, so it holds user-uploaded media (see that function's
   * doc comment). Vite's default behaviour would copy every byte of it into
   * `dist/client` AND `dist/server` on each build, which is pure waste:
   * stored media is always addressed by bare id and served through
   * `/dry/api/storage/<id>` off the storage adapter (`routes/storage.ts`'s
   * `withPreview`), never as a plain `/<name>.ext` static file. On
   * `kind: "cloudflare"` that adapter is R2, so shipping the same bytes as
   * Workers assets duplicates them; on Node the server reads `public/` off
   * disk at runtime, not out of `dist/`. Either way the copy is dead weight.
   *
   * Kept ON in dev (`command === "serve"`), where Vite's static serving of
   * `public/` is what makes a freshly-uploaded file reachable immediately -
   * the behaviour `resolveStorageOption`'s comment describes. If this app
   * ever needs genuinely static, deploy-time files (favicon, robots.txt),
   * they need their own directory rather than `public/`, which is now the
   * media root.
   */
  publicDir: command === "build" ? false : "public",
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
  plugins: [appRouterPlugin(), assetHrefsPlugin(), tailwindcss(), preact()],
  build: {
    // Page Components carries the whole `Editer` code editor (TypeScript
    // services + Prism) in one route chunk; it is lazy-loaded from the app
    // shell, so this size is not part of the initial path. Keep Vite's
    // warning threshold above that deliberate bundle while retaining the
    // default warning for normal chunks.
    chunkSizeWarningLimit: 1024,
    // Three shapes, one config: the Workers SSR build needs a single
    // inlined bundle (see below), the Node SSR build takes Vite's defaults,
    // and only the plain client build (`vite build --outDir dist/client`)
    // gets the multi-input block - CLI `--ssr <entry>` makes `<entry>` the
    // sole rollup input for either SSR build regardless of
    // `rollupOptions.input` here, so that `input` map would be ignored
    // there anyway. `appsGlobals`/`appsHydrate` are App Router's Tailwind
    // output + client hydration bootstrap, built+hashed like any other
    // asset - see `app-router/assets.ts`, which reads the resulting
    // `manifest.json` to find them at runtime (`plans/app-router.md`'s
    // Giai đoạn 3/2).
    ...(isSsrBuild
      ? isWorkerBuild
        ? {
            rollupOptions: {
              output: {
                // One self-contained bundle, no shared chunks. With
                // splitting on, the `src/apps/pages/**` chunks import
                // shared modules that rollup hoisted INTO the entry chunk,
                // so the entry re-exports all of them (`export { ...,
                // REF_SYMBOL as o, ... }`) - and workerd validates every
                // export of the entry as a handler, failing the upload with
                // "Incorrect type for map entry 'o': the provided value is
                // not of type 'function or ExportedHandler'". Inlining
                // leaves `export default { fetch }` as the only export.
                // Costs nothing on Workers: `wrangler deploy` concatenates
                // the whole graph into a single script either way.
                inlineDynamicImports: true,
              },
            },
          }
        : {}
      : {
          rollupOptions: {
            input: {
              main: "index.html",
              appsGlobals: "src/apps/globals.css",
              appsHydrate: "src/apps/hydrate-client.ts",
              appsVeiOverlay: "src/apps/vei/overlay.ts",
              // mục 7 (app-r2 build pipeline hydration) - the client
              // bootstrap for a page that only exists as browser-compiled
              // source in `pagesSourceStorage`, which Vite's build never
              // saw (`appsHydrate` above hydrates a Vite-known SSR route
              // via `import.meta.glob` instead). Its own `preact-iso/
              // hydrate` import is dynamic, not this file's static one -
              // see `hydrate-built.ts`'s doc comment for why: mixing it
              // into the ADMIN app's own deduped Preact chunk here would
              // be a SECOND, separate Preact module instance from the one
              // a built page's own compiled JS loads at runtime
              // (`build-preact-runtime-bundle.ts`), and hooks silently
              // break across two instances.
              appsHydrateBuilt: "src/apps/hydrate-built.ts",
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
