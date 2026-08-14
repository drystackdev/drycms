import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import preact from "@preact/preset-vite";
import { defineConfig, type Plugin } from "vite";
import { appRouterPlugin } from "./src/server/app-router/app-router-plugin.js";
import { assetHrefsPlugin } from "./src/server/app-router/asset-hrefs-plugin.js";
import { COMPONENT_ALIAS, COMPONENT_ROOT } from "./src/server/app-router/source-roots.js";

// Set by `bun run build:worker` only - `isSsrBuild` alone can't tell the
// Workers build apart from the Node one (both are `vite build --ssr`), and
// the two need different chunking (see `inlineDynamicImports` below).
const isWorkerBuild = process.env.DRYCMS_WORKER_BUILD === "1";

// Read directly off disk (rather than a static `import`) so a plain `node`
// run of this config - no project-level tsconfig/loader involved - doesn't
// need JSON-module import support.
const pkgVersion = (
  JSON.parse(
    readFileSync(fileURLToPath(new URL("./package.json", import.meta.url)), "utf-8"),
  ) as { version: string }
).version;

const PRISM_LANGUAGE_FILE = /\/node_modules\/prismjs\/components\/prism-[\w-]+\.js$/;

/**
 * Gives `prismjs`'s language files (`components/prism-*.js`) the import of
 * prismjs core they are missing.
 *
 * Those files are legacy browser scripts shaped
 * `(function (Prism) { ... }(Prism))`: they read a bare GLOBAL `Prism` and
 * declare no dependency at all, so nothing in the module graph says they must
 * run after core. Core itself is CommonJS (`module.exports = Prism`), which
 * the bundler compiles into a LAZY factory that only executes when a module
 * actually imports it - while a language file, having no CJS markers
 * whatsoever, is treated as ESM and executes EAGERLY at the top of its chunk.
 * The language file therefore ran before core ever did, so neither a local
 * binding nor `window.Prism` existed yet, and production died on
 * `ReferenceError: Prism is not defined` inside the prismjs chunk. Dev never
 * showed it: unbundled, each file is its own request and simply runs in
 * import order.
 *
 * Prepending a real `import` fixes both halves at once - it is the dependency
 * edge that forces core to evaluate first, AND it puts a `Prism` binding in
 * scope for the trailing `}(Prism))` call - so no chunking strategy, and no
 * import order at any call site, can break the pairing again.
 */
function prismjsLanguagesPlugin(): Plugin {
  return {
    name: "drycms:prismjs-languages",
    // Before Vite's CommonJS/ESM handling, so the injected import is part of
    // the module as every later plugin sees it.
    enforce: "pre",
    transform(code, id) {
      if (!PRISM_LANGUAGE_FILE.test(id.split("?")[0]!)) return null;
      return { code: `import Prism from "prismjs";\n${code}`, map: null };
    },
  };
}

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
  server: {
    watch: {
      /**
       * `.dry/` is runtime DATA, not source (see `CLAUDE.md`), and Vite
       * watches the whole project root by default - only `.git`,
       * `node_modules`, `test-results` and the cache dir are ignored out of
       * the box. That mattered for one specific write: publishing a built
       * page (`built-pages-storage.ts`'s `writeBuiltPage`, i.e. every
       * "Build"/"Build all" click in `PageEditor.tsx`/`PageBuild.tsx`) drops
       * an `.html` file into `.dry/pages-cache/built/`, and Vite's HMR
       * handler treats ANY changed `.html` that isn't in the module graph as
       * "html cannot be hot updated" -> `full-reload`. Under
       * `middlewareMode` (which `scripts/dev-server.mjs` uses) that reload is
       * broadcast with `path: "*"`, so it reloads whatever page the browser
       * has open - including the Page Editor tab that just started the
       * build, mid-build, once per published page.
       *
       * `pages-source` is deliberately NOT ignored: it's the live page
       * source (`tsconfig.json` includes it) and `@component/*` resolves
       * into it below, so it belongs in the module graph like any other
       * source file.
       */
      ignored: ["**/.dry/pages-cache/**", "**/.dry/kv/**", "**/.dry/types-cache/**", "**/.dry/content.sqlite*"],
    },
  },
  // Baked in per-build, not read at runtime - see `src/env.d.ts`'s
  // `ImportMetaEnv.DRYCMS_KIND` doc comment. `isWorkerBuild` is the only
  // signal that actually tells the Workers SSR build apart from the Node
  // one (both are plain `vite build --ssr`, so `import.meta.env.PROD` alone
  // is `true` for both and can't distinguish them - see `src/server/config.ts`).
  define: {
    "import.meta.env.DRYCMS_KIND": JSON.stringify(isWorkerBuild ? "cloudflare" : "local"),
    // Read once at build/dev-server startup, not at runtime - see
    // `src/env.d.ts`'s `ImportMetaEnv.DRYCMS_VERSION` doc comment.
    "import.meta.env.DRYCMS_VERSION": JSON.stringify(pkgVersion),
  },
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
  // themselves (`src/apps/styles/globals.css` - see "CSS: 1 file chung" in
  // the same doc) - the admin's own hand-rolled `.css` files
  // (`docs/DESIGN.md`) never opt in, so this is safe to register globally
  // rather than needing a separate Vite config just for `src/apps`.
  plugins: [
    appRouterPlugin(),
    assetHrefsPlugin(),
    prismjsLanguagesPlugin(),
    tailwindcss(),
    preact(),
  ],
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
              // Only during a real build, unlike the other 3 entries below
              // (real, always-on-disk committed files): `src/apps/styles/
              // globals.css` is `styles/`'s (`source-roots.ts`) build-time
              // materialized copy - `sync-pages-r2.ts --pull` writes it right
              // before `bun run build`'s own `vite build` runs, but it does
              // NOT exist yet during `bun run dev` (dev serves the LIVE file
              // straight out of `pagesSourceStorage` instead - see
              // `resolve-asset-href.ts`'s `/@fs/` dev href). Including it
              // unconditionally broke `vite dev`'s own dependency scanner on
              // a fresh checkout - found live, not in review: "Failed to run
              // dependency scan... failed to resolve rolldownOptions.input
              // value" the moment this repo's `.dry/pages-source` didn't
              // have a `src/apps/styles/globals.css` copy sitting around yet.
              //
              // Also gated on the file actually existing on disk: a CI build
              // (Cloudflare Pages/Workers Builds) runs from a fresh git
              // checkout with no `.dry/pages-source` ever populated - `pull`
              // then materializes 0 files, and an unresolvable ENTRY (as
              // opposed to a missing import somewhere inside the graph)
              // took the whole client build down to "0 modules transformed"
              // instead of just this one asset - found live, a real
              // `bun run build` failure on Cloudflare's build image.
              // `resolve-asset-href.ts`'s `resolveGlobalsCssHref` tolerates
              // the resulting gap in `manifest.json` (`required: false`);
              // `build-document.ts`'s `buildHeadPrefix` skips the
              // `<link rel="stylesheet">` tag entirely when there's no href.
              ...(command === "build" && existsSync(fileURLToPath(new URL("./src/apps/styles/globals.css", import.meta.url)))
                ? { appsGlobals: "src/apps/styles/globals.css" }
                : {}),
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
              // The VEI-in-production live-content fix (`page-handler.ts`'s
              // `veiLiveManifest`) - a normal Vite entry (unlike
              // `appsHydrateBuilt` above), sharing the app's one deduped
              // Preact instance, since it re-hydrates over the SAME DOM
              // `appsHydrate` already hydrated moments earlier.
              appsVeiLiveRefresh: "src/apps/vei-live-refresh.ts",
            },
            output: {
              // Keep prismjs to exactly ONE instance across the app. A
              // language grammar registers itself onto whichever copy of
              // core it was bundled next to, so a duplicated core means a
              // route that resolved the other copy sees
              // `Prism.languages.jsx` as undefined. Pinning the package to a
              // single chunk makes that impossible no matter how many routes
              // reach it. This is deduplication only - what guarantees core
              // EVALUATES before its language files is
              // `prismjsLanguagesPlugin` above, not this.
              manualChunks(id) {
                if (id.includes("/node_modules/prismjs/")) return "prismjs";
              },
            },
          },
          manifest: true,
        }),
  },
  resolve: {
    alias: {
      /**
       * `@component/Card` in page source (`source-roots.ts`) - the same alias
       * `page-build.ts` resolves for the in-browser build and `ts-worker.ts`
       * resolves for the editor's type-checking, here for the two compile
       * paths Vite itself owns.
       *
       * Dev (`command === "serve"`) points at the LIVE store: the dev server
       * renders pages straight out of `pagesSourceStorage` through
       * `vite.ssrLoadModule` (`route-tree.ts`'s `DevPagesSource`), so a
       * component has to resolve where it's actually saved, with no build
       * step in between. A build points at the materialized copy
       * `sync-pages-r2.ts --pull` writes right before `vite build` runs -
       * the only form the Worker/Node bundle can see.
       */
      [COMPONENT_ALIAS]:
        command === "serve"
          ? fileURLToPath(new URL(`./.dry/pages-source/${COMPONENT_ROOT}/`, import.meta.url)).replace(/\/$/, "")
          : fileURLToPath(new URL(`./src/apps/${COMPONENT_ROOT}/`, import.meta.url)).replace(/\/$/, ""),
    },
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
