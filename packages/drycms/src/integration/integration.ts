import { createRequire } from "node:module";
import preactIntegration from "@astrojs/preact";
import type { AstroIntegration } from "astro";
import {
  APP_ENTRYPOINT,
  CONTENT_ENTRIES_ROUTE_ENTRYPOINT,
  CONTENT_ROUTE_ENTRYPOINT,
  ICONIFY_ROUTE_ENTRYPOINT,
  ICONS_ROUTE_ENTRYPOINT,
  STORAGE_ROUTE_ENTRYPOINT,
  type DryOption,
  resolveOptions,
} from "./options.js";
import {
  VIRTUAL_CONFIG_TYPES,
  VIRTUAL_CONTENT_CONFIG_TYPES,
  VIRTUAL_ICONS_CONFIG_TYPES,
  VIRTUAL_STORAGE_CONFIG_TYPES,
  dryFixOptimizeDeps,
  dryVirtualConfig,
  dryVirtualContentConfig,
  dryVirtualIconsConfig,
  dryVirtualStorageConfig,
} from "./virtual.js";

const PREACT_INTEGRATION_NAME = "@astrojs/preact";

/**
 * `@astrojs/preact` is a dependency of drycms, not of the host project, so bare
 * specifiers pointing at it are not resolvable from the project root. Resolving
 * them here - relative to this file - keeps `dry()` the only thing a consumer
 * has to install.
 */
const require = createRequire(import.meta.url);

function resolveFromHere(specifier: string): string | undefined {
  try {
    return require.resolve(specifier);
  } catch {
    return undefined;
  }
}

const PREACT_CLIENT_IDS = [
  "@astrojs/preact/client.js",
  "@astrojs/preact/client-dev.js",
  "@astrojs/preact/server.js",
];

function preactAliases(): Record<string, string> {
  const alias: Record<string, string> = {};
  for (const id of PREACT_CLIENT_IDS) {
    const resolved = resolveFromHere(id);
    if (resolved) alias[id] = resolved;
  }
  return alias;
}

// Third-party deps the admin app's lazy-loaded routes/components pull in
// (see App.tsx's `lazy(() => import(...))` list and each dep's own
// importer: @preact/signals - store/dashboard.ts, field-visibility.ts;
// overlayscrollbars - components/overlayscrollbars.ts; preact-iso -
// routers/App.tsx; prosemirror-* - the rich text field; dayjs - date
// fields; prismjs(+components) - CodeBlock.tsx). They live in drycms's own
// `node_modules` (a nested workspace package), not the consumer project's,
// so Vite can't resolve the bare specifiers below from project root
// without an alias - same problem `preactAliases` solves for
// `@astrojs/preact`.
// The `prismjs/components/prism-jsx` subpath must come before the bare
// `prismjs` entry: Vite's alias matcher takes the first pattern where
// `importee === pattern || importee.startsWith(pattern + "/")`, so if the
// bare `prismjs` entry (which resolves to prismjs's main *file*, not its
// directory) were checked first, its `startsWith` branch would swallow the
// subpath import too and splice the subpath onto that file's path instead
// of a real one (e.g. `.../prismjs/prism.js/components/prism-jsx`).
const DRY_DEP_IDS = [
  "prismjs/components/prism-jsx",
  "@preact/signals",
  "overlayscrollbars",
  "preact-iso",
  "prosemirror-commands",
  "prosemirror-history",
  "prosemirror-keymap",
  "prosemirror-model",
  "prosemirror-state",
  "prosemirror-view",
  "dayjs",
  "prismjs",
];

function dryDepAliases(): Record<string, string> {
  const alias: Record<string, string> = {};
  for (const id of DRY_DEP_IDS) {
    const resolved = resolveFromHere(id);
    if (resolved) alias[id] = resolved;
  }
  return alias;
}

type AddRenderer = Parameters<
  NonNullable<AstroIntegration["hooks"]["astro:config:setup"]>
>[0]["addRenderer"];

/**
 * Renderer entrypoints are imported by Astro's SSR runtime as external modules,
 * which bypasses Vite aliases - so they have to be absolute before they reach
 * `addRenderer`.
 */
function absolutizeRenderer(addRenderer: AddRenderer): AddRenderer {
  return (renderer) => {
    const patched = { ...renderer };
    for (const key of ["clientEntrypoint", "serverEntrypoint"] as const) {
      const value = patched[key];
      if (typeof value !== "string") continue;
      const resolved = resolveFromHere(value);
      if (resolved) patched[key] = resolved;
    }
    addRenderer(patched);
  };
}

/**
 * The drycms Astro integration.
 *
 * ```js
 * import dry from 'drycms';
 * export default defineConfig({ integrations: [dry()] });
 * ```
 */
export function dry(options: DryOption = {}): AstroIntegration {
  const resolved = resolveOptions(options);

  return {
    name: "drycms",
    hooks: {
      "astro:config:setup": (params) => {
        const { config, updateConfig, injectRoute, logger } = params;

        // Register the Preact renderer ourselves so consumers only need `dry()`.
        // Delegating to the real integration keeps the babel/prefresh setup in sync;
        // we skip it when the user already added `@astrojs/preact` to avoid a
        // duplicate renderer.
        const hasPreact = config.integrations.some(
          (i) => i.name === PREACT_INTEGRATION_NAME,
        );
        if (!hasPreact) {
          preactIntegration().hooks["astro:config:setup"]?.({
            ...params,
            addRenderer: absolutizeRenderer(params.addRenderer),
          });
        }

        const aliases = { ...(hasPreact ? {} : preactAliases()), ...dryDepAliases() };

        // The admin UI is routed entirely client-side by the Preact app, so
        // its single Astro entrypoint has to be rendered on demand rather
        // than statically (Astro's static output requires every dynamic
        // route to enumerate its paths up front via `getStaticPaths`, which
        // doesn't make sense for a route `preact-iso` owns).
        if (config.output !== "server") {
          // `warn`, not `info` - this silently overrides whatever the
          // consumer configured (including an intentional `"static"`/
          // `"hybrid"` choice), so it needs to be hard to miss in CI output.
          logger.warn(
            'overriding to `output: "server"` - the admin UI needs on-demand rendering. ' +
              "Add a server adapter (e.g. `@astrojs/node`) before running `astro build` for production.",
          );
        }

        updateConfig({
          output: "server",
          vite: {
            plugins: [
              dryVirtualConfig(resolved),
              dryVirtualStorageConfig(resolved.storage),
              dryVirtualIconsConfig(resolved.icons),
              dryVirtualContentConfig(resolved.content),
              // Only needed for drycms's OWN `preactAliases()` (`aliases`
              // is `{}` when the consumer supplies `@astrojs/preact`
              // themselves) - registering it unconditionally would strip
              // the CONSUMER's own legitimate `optimizeDeps` hints too,
              // since none of their entries are keys in an empty `aliases`.
              ...(hasPreact ? [] : [dryFixOptimizeDeps(aliases)]),
            ],
            resolve: { alias: aliases },
            // The package ships uncompiled `.astro`/`.css`, so it must go through
            // the Astro/Vite pipeline instead of being externalized.
            ssr: { noExternal: ["drycms"] },
            // The admin app is a single `client:only` SPA that code-splits
            // every route with `lazy(() => import(...))` (see App.tsx) for
            // production bundle size. In dev, that means Vite's crawler
            // never sees a route's own third-party deps until that route is
            // actually visited - discovering one mid-session forces a
            // dependency re-optimization + full page reload, which can land
            // mid-render (e.g. right after a click's state update) and throw
            // a Preact `insertBefore` DOM error before the reload lands.
            // Listing them here gets them all prebundled at server start
            // instead, so no route visit ever triggers a fresh optimize.
            optimizeDeps: {
              exclude: ["drycms"],
              include: DRY_DEP_IDS,
            },
          },
        });

        // A single catch-all route hands everything off to the Preact app;
        // `preact-iso` (not Astro) owns every path under it, including the
        // bare base path, which the app redirects to `/dashboard` client-side.
        injectRoute({
          pattern: `${resolved.path}/[...slug]`,
          entrypoint: APP_ENTRYPOINT,
        });

        // Server-rendered API endpoint (not client-routed like the app above)
        // backing the file manager - see `routes/storage.ts`.
        injectRoute({
          pattern: `${resolved.path}/api/storage/[...slug]`,
          entrypoint: STORAGE_ROUTE_ENTRYPOINT,
        });

        // Server-rendered API endpoint backing Icon Management's own file
        // storage (separate root from Media's `storage/`) - see `routes/icons.ts`.
        injectRoute({
          pattern: `${resolved.path}/api/icons/[...slug]`,
          entrypoint: ICONS_ROUTE_ENTRYPOINT,
        });

        // Stateless proxy for the public Iconify API - see `routes/iconify.ts`.
        // The browser never calls `api.iconify.design` directly.
        injectRoute({
          pattern: `${resolved.path}/api/iconify/[...slug]`,
          entrypoint: ICONIFY_ROUTE_ENTRYPOINT,
        });

        // Server-rendered API endpoint backing the Content-Type Builder -
        // see `routes/content-types.ts`.
        injectRoute({
          pattern: `${resolved.path}/api/content-types/[...slug]`,
          entrypoint: CONTENT_ROUTE_ENTRYPOINT,
        });

        // Server-rendered API endpoint backing content-ENTRY CRUD (the
        // actual rows inside a collection/singleton) - see
        // `routes/content-entries.ts`. Distinct from the content-TYPE
        // (schema) endpoint just above.
        injectRoute({
          pattern: `${resolved.path}/api/content/[...slug]`,
          entrypoint: CONTENT_ENTRIES_ROUTE_ENTRYPOINT,
        });

        injectRoute({
          pattern: `${resolved.path}/api/__debugtest123/[...slug]`,
          entrypoint: "drycms/routes/debugtest.ts",
        });

        logger.info(`admin UI mounted at ${resolved.path}`);
        if (resolved.storage.kind === "local") {
          logger.info(
            `storage: "local" files live under ${resolved.storage.root} - add "storage/" to .gitignore if this is a fresh project.`,
          );
        }
        if (resolved.icons.kind === "local") {
          logger.info(
            `icons: "local" files live under ${resolved.icons.root} - add "icons/" to .gitignore if this is a fresh project.`,
          );
        }
        if (resolved.content.engine === "sqlite") {
          logger.info(
            `content: "sqlite" database lives at ${resolved.content.file} - add it to .gitignore if this is a fresh project.`,
          );
        }
        if (resolved.content.engine === "file" && resolved.content.kind === "local") {
          logger.info(
            `content: "file" (local) records live under ${resolved.content.root} - add "content/" to .gitignore if this is a fresh project.`,
          );
        }
      },

      "astro:config:done": ({ injectTypes }) => {
        injectTypes({ filename: "types.d.ts", content: VIRTUAL_CONFIG_TYPES });
        injectTypes({
          filename: "storage-types.d.ts",
          content: VIRTUAL_STORAGE_CONFIG_TYPES,
        });
        injectTypes({
          filename: "icons-types.d.ts",
          content: VIRTUAL_ICONS_CONFIG_TYPES,
        });
        injectTypes({
          filename: "content-types-config-types.d.ts",
          content: VIRTUAL_CONTENT_CONFIG_TYPES,
        });
      },
    },
  };
}

export default dry;
