import { createRequire } from "node:module";
import preactIntegration from "@astrojs/preact";
import type { AstroIntegration } from "astro";
import { APP_ENTRYPOINT, type DryOption, resolveOptions } from "./options.js";
import {
  VIRTUAL_CONFIG_TYPES,
  dryFixOptimizeDeps,
  dryVirtualConfig,
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

        const aliases = hasPreact ? {} : preactAliases();

        // The admin UI is routed entirely client-side by the Preact app, so
        // its single Astro entrypoint has to be rendered on demand rather
        // than statically (Astro's static output requires every dynamic
        // route to enumerate its paths up front via `getStaticPaths`, which
        // doesn't make sense for a route `preact-iso` owns).
        if (config.output !== "server") {
          logger.info(
            'setting `output: "server"` - the admin UI needs on-demand rendering. ' +
              "Add a server adapter (e.g. `@astrojs/node`) before running `astro build` for production.",
          );
        }

        updateConfig({
          output: "server",
          vite: {
            plugins: [dryVirtualConfig(resolved), dryFixOptimizeDeps(aliases)],
            resolve: { alias: aliases },
            // The package ships uncompiled `.astro`/`.css`, so it must go through
            // the Astro/Vite pipeline instead of being externalized.
            ssr: { noExternal: ["drycms"] },
            optimizeDeps: { exclude: ["drycms"] },
          },
        });

        // A single catch-all route hands everything off to the Preact app;
        // `preact-iso` (not Astro) owns every path under it, including the
        // bare base path, which the app redirects to `/dashboard` client-side.
        injectRoute({
          pattern: `${resolved.path}/[...slug]`,
          entrypoint: APP_ENTRYPOINT,
        });

        logger.info(`admin UI mounted at ${resolved.path}`);
      },

      "astro:config:done": ({ injectTypes }) => {
        injectTypes({ filename: "types.d.ts", content: VIRTUAL_CONFIG_TYPES });
      },
    },
  };
}

export default dry;
