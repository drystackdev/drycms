import type { Plugin } from "vite";
import type { ResolvedDryOption, ResolvedStorageOption } from "./options.js";

export const VIRTUAL_CONFIG_ID = "virtual:drycms/config";
const RESOLVED_CONFIG_ID = `\0${VIRTUAL_CONFIG_ID}`;

/**
 * Exposes the resolved integration options to the injected `.astro` routes,
 * which cannot receive props from the integration any other way.
 */
export function dryVirtualConfig(options: ResolvedDryOption): Plugin {
  return {
    name: "drycms:virtual-config",
    resolveId(id) {
      if (id === VIRTUAL_CONFIG_ID) return RESOLVED_CONFIG_ID;
      return null;
    },
    load(id) {
      if (id !== RESOLVED_CONFIG_ID) return null;
      return [
        `export const path = ${JSON.stringify(options.path)};`,
        "export default { path };",
      ].join("\n");
    },
  };
}

export const VIRTUAL_STORAGE_CONFIG_ID = "virtual:drycms/storage-config";
const RESOLVED_STORAGE_CONFIG_ID = `\0${VIRTUAL_STORAGE_CONFIG_ID}`;

/**
 * Exposes the resolved `storage` option to `routes/storage.ts` only. Kept
 * separate from `virtual:drycms/config` on purpose: that module is imported
 * by client-shipped code (`app.astro`, `App.tsx`, `DryLayout.tsx`), and an
 * absolute filesystem path has no business ending up in a browser bundle.
 */
export function dryVirtualStorageConfig(storage: ResolvedStorageOption): Plugin {
  return {
    name: "drycms:virtual-storage-config",
    resolveId(id) {
      if (id === VIRTUAL_STORAGE_CONFIG_ID) return RESOLVED_STORAGE_CONFIG_ID;
      return null;
    },
    load(id) {
      if (id !== RESOLVED_STORAGE_CONFIG_ID) return null;
      return [
        `export const storage = ${JSON.stringify(storage)};`,
        "export default { storage };",
      ].join("\n");
    },
  };
}

/**
 * `@astrojs/preact` seeds `optimizeDeps.include` with `@astrojs/preact > …`
 * dependency chains that only resolve when the integration is a direct
 * dependency of the host project. Ours is nested, so Vite cannot walk them and
 * warns on startup. Entries we alias to an absolute path are kept; the rest are
 * dropped - they are prebundling hints, not requirements.
 */
export function dryFixOptimizeDeps(aliases: Record<string, string>): Plugin {
  const rewrite = (include: string[] | undefined) => {
    if (!include) return include;
    return include.filter(
      (entry) => !entry.includes("@astrojs/preact") || entry in aliases,
    );
  };

  return {
    name: "drycms:fix-optimize-deps",
    configEnvironment(_name, options) {
      if (options.optimizeDeps?.include) {
        options.optimizeDeps.include = rewrite(options.optimizeDeps.include);
      }
    },
    config(config) {
      if (config.optimizeDeps?.include) {
        config.optimizeDeps.include = rewrite(config.optimizeDeps.include);
      }
    },
  };
}

export const VIRTUAL_CONFIG_TYPES = `declare module '${VIRTUAL_CONFIG_ID}' {
	export const path: string;
	const config: { path: string };
	export default config;
}
`;

export const VIRTUAL_STORAGE_CONFIG_TYPES = `declare module '${VIRTUAL_STORAGE_CONFIG_ID}' {
	export const storage: { kind: 'local'; root: string };
	const config: { storage: { kind: 'local'; root: string } };
	export default config;
}
`;
