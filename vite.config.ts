import { readFileSync } from "node:fs";
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

const VITE_MODULE_PATH = /^(?:\/node_modules\/|\/src\/|\/\.dry\/pages-source\/|\/@(?:id|fs|vite)\/)/;

export function isSandboxPreviewModuleRequest(
  headers: Record<string, string | string[] | undefined>,
  requestUrl = "",
): boolean {
  // These are dev-only Vite module URLs, never API routes or the admin HTML
  // shell. Mark them independently of Fetch Metadata because Chrome has
  // emitted different/missing `Sec-Fetch-*` combinations for optimized-dep
  // imports across versions. This also makes a cached dependency response
  // safe to reuse inside the opaque-origin preview.
  if (VITE_MODULE_PATH.test(requestUrl.split("?")[0] ?? "")) return true;
  if (headers.origin !== "null") return false;
  // Chrome reports top-level module loads as `script`, but optimized-dep
  // imports can arrive as a CORS fetch with destination `empty` (notably
  // `/node_modules/.vite/deps/preact.js`). Both are module-graph requests
  // from the opaque-origin srcdoc preview. The custom dev server runs API
  // middleware before Vite, so this Vite-only allowance cannot expose an
  // authenticated API response to a null-origin caller.
  return headers["sec-fetch-dest"] === "script" || headers["sec-fetch-mode"] === "cors";
}

/** Opaque Page Builder previews need CORS for Vite-transformed module
 * scripts, but not for the admin HTML shell, CSS, media, or API responses.
 * Setting the header before Vite transforms the request also covers 304s. */
function sandboxPreviewModuleCorsPlugin(): Plugin {
  return {
    name: "drycms:sandbox-preview-module-cors",
    enforce: "pre",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (isSandboxPreviewModuleRequest(request.headers, request.url)) {
          response.setHeader("Access-Control-Allow-Origin", "null");
          response.setHeader("Vary", "Origin");
          // Vite serves optimized deps (`/node_modules/.vite/deps/*.js?v=…`)
          // with `max-age=31536000, immutable`, and the preview iframe has
          // its own opaque cache partition. A previous version of this
          // middleware only downgraded that to `no-cache` (store + revalidate
          // via ETag), which still recurred live: an entry module like
          // `hydrate-built.ts` has a bare `import "preact"` that Vite
          // dev-rewrites to the CURRENT optimize-deps hash on every transform,
          // but the entry module's OWN ETag is derived from its source bytes,
          // which don't change across a dependency re-optimize - so a 304
          // replays the BODY cached from before the re-optimize, complete
          // with the now-dead old hash baked into its rewritten import
          // statement, and the srcdoc iframe has no `@vite/client` HMR socket
          // to receive Vite's usual "stale dep, hard-reload" signal and
          // self-heal the way a normal tab would. `no-store` closes that gap
          // by never letting the browser keep ANY copy - no ETag, no 304, no
          // replay - so every load of a sandbox-preview module always gets
          // Vite's live transform output. Dev-only, opaque-iframe-only: the
          // perf cost of skipping caching here is a non-issue.
          response.setHeader("Cache-Control", "no-store");
          const setHeader = response.setHeader.bind(response);
          response.setHeader = function keepNoStore(name, value) {
            return String(name).toLowerCase() === "cache-control" ? response : setHeader(name, value);
          } as typeof response.setHeader;
        }
        next();
      });
    },
  };
}

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
    // A dedicated pre-transform middleware below grants `null` CORS only to
    // sandboxed module-script requests. Vite's generic CORS middleware would
    // otherwise attach it to the admin HTML shell and unrelated dev assets.
    cors: false,
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
  // `appRouterPlugin` (`enforce: "pre"`) injects the ambient page helpers
  // into live local `pagesSourceStorage` modules before Preact transforms
  // them, and broadcasts a full reload when that source changes.
  // `tailwindcss()` only transforms CSS files that opt into Tailwind; the
  // admin's own hand-rolled `.css` files
  // (`docs/DESIGN.md`) never opt in, so this is safe to register globally
  // rather than needing a separate Vite config just for `src/apps`.
  plugins: [
    sandboxPreviewModuleCorsPlugin(),
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
    // there anyway. The committed hydration/VEI runtime entries are built
    // and hashed like any other asset. Tenant source is never a Vite input.
    ...(isSsrBuild
      ? isWorkerBuild
        ? {
            rollupOptions: {
              output: {
                // One self-contained bundle, no shared chunks. With
                // splitting on, Rollup may hoist shared modules into the entry,
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
              appsHydrate: "src/apps/hydrate-client.ts",
              // The public site's whole editing surface: one "Edit this
              // page" button that deep-links into Page Builder
              // (`src/apps/edit-launcher.ts`).
              appsEditLauncher: "src/apps/edit-launcher.ts",
              // mục 7 (app-r2 build pipeline hydration) - the client
              // bootstrap for browser-compiled source in
              // `pagesSourceStorage`. Its own `preact-iso/
              // hydrate` import is dynamic, not this file's static one -
              // see `hydrate-built.ts`'s doc comment for why: mixing it
              // into the ADMIN app's own deduped Preact chunk here would
              // be a SECOND, separate Preact module instance from the one
              // a built page's own compiled JS loads at runtime
              // (`build-preact-runtime-bundle.ts`), and hooks silently
              // break across two instances.
              appsHydrateBuilt: "src/apps/hydrate-built.ts",
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
       * resolves for the editor's type-checking. Vite only needs it for dev:
       * the dev server
       * renders pages straight out of `pagesSourceStorage` through
       * `vite.ssrLoadModule` (`route-tree.ts`'s `DevPagesSource`), so a
       * component has to resolve where it is actually saved. Production page
       * builds resolve the alias from their in-memory source map instead.
       */
      [COMPONENT_ALIAS]: fileURLToPath(new URL(`./.dry/pages-source/${COMPONENT_ROOT}/`, import.meta.url)).replace(/\/$/, ""),
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
    // The git working copy's dependencies (`page-components/git/`) are only
    // ever reached through a dynamic `import()`, so Vite doesn't discover
    // them while crawling the entry graph - it meets them mid-session and
    // re-optimizes, which forces a full page reload right in the middle of a
    // clone. Naming them here gets them pre-bundled at startup instead.
    include: ["isomorphic-git", "isomorphic-git/http/web", "buffer", "@zenfs/core", "@zenfs/dom"],
  },
}));
