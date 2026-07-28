import type { Plugin } from "vite";
import type {
  ResolvedContentOption,
  ResolvedDryOption,
  ResolvedIconsOption,
  ResolvedStorageOption,
} from "./options.js";

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
        `export const experimentalClientSearch = ${JSON.stringify(options.experimentalClientSearch)};`,
        "export default { path, experimentalClientSearch };",
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

export const VIRTUAL_ICONS_CONFIG_ID = "virtual:drycms/icons-config";
const RESOLVED_ICONS_CONFIG_ID = `\0${VIRTUAL_ICONS_CONFIG_ID}`;

/**
 * Exposes the resolved `icons` option to `routes/icons.ts` only. Kept as its
 * own virtual module rather than folded into `virtual:drycms/storage-config` -
 * Icon Management's storage root is deliberately independent of Media's, and
 * this keeps `routes/icons.ts` from having to import Media's config just to
 * get its own absolute path.
 */
export function dryVirtualIconsConfig(icons: ResolvedIconsOption): Plugin {
  return {
    name: "drycms:virtual-icons-config",
    resolveId(id) {
      if (id === VIRTUAL_ICONS_CONFIG_ID) return RESOLVED_ICONS_CONFIG_ID;
      return null;
    },
    load(id) {
      if (id !== RESOLVED_ICONS_CONFIG_ID) return null;
      return [
        `export const icons = ${JSON.stringify(icons)};`,
        "export default { icons };",
      ].join("\n");
    },
  };
}

export const VIRTUAL_CONTENT_CONFIG_ID = "virtual:drycms/content-config";
const RESOLVED_CONTENT_CONFIG_ID = `\0${VIRTUAL_CONTENT_CONFIG_ID}`;

/**
 * Exposes the resolved `content` option to `routes/content-types.ts` only -
 * same rationale as `dryVirtualStorageConfig`: kept out of the client-facing
 * `virtual:drycms/config` module since a `sqlite` config carries an absolute
 * filesystem path. Note this never carries a live `D1Database` binding
 * itself (that isn't a JSON-serializable value) - only the binding *name*
 * for `engine: "D1"`; the route resolves the actual binding per-request.
 */
export function dryVirtualContentConfig(content: ResolvedContentOption): Plugin {
  return {
    name: "drycms:virtual-content-config",
    resolveId(id) {
      if (id === VIRTUAL_CONTENT_CONFIG_ID) return RESOLVED_CONTENT_CONFIG_ID;
      return null;
    },
    load(id) {
      if (id !== RESOLVED_CONTENT_CONFIG_ID) return null;
      return [
        `export const content = ${JSON.stringify(content)};`,
        "export default { content };",
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
	export const experimentalClientSearch: boolean;
	const config: { path: string; experimentalClientSearch: boolean };
	export default config;
}
`;

const STORAGE_CONFIG_TYPE =
  "{ kind: 'local'; root: string } | { kind: 'github'; owner: string; repo: string; branch: string; token: string; root: string } | { kind: 'gitlab'; host: string; project: string; branch: string; token: string; root: string }";

export const VIRTUAL_STORAGE_CONFIG_TYPES = `declare module '${VIRTUAL_STORAGE_CONFIG_ID}' {
	export const storage: ${STORAGE_CONFIG_TYPE};
	const config: { storage: ${STORAGE_CONFIG_TYPE} };
	export default config;
}
`;

export const VIRTUAL_ICONS_CONFIG_TYPES = `declare module '${VIRTUAL_ICONS_CONFIG_ID}' {
	export const icons: ${STORAGE_CONFIG_TYPE};
	const config: { icons: ${STORAGE_CONFIG_TYPE} };
	export default config;
}
`;

const CONTENT_CONFIG_TYPE = "{ engine: 'sqlite'; file: string } | { engine: 'D1'; binding: string }";

export const VIRTUAL_CONTENT_CONFIG_TYPES = `declare module '${VIRTUAL_CONTENT_CONFIG_ID}' {
	export const content: ${CONTENT_CONFIG_TYPE};
	const config: { content: ${CONTENT_CONFIG_TYPE} };
	export default config;
}
`;
