import { relative } from "node:path";
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
 *
 * `contentEngine` is just the `content.engine` tag ("sqlite"/"D1"/"file"),
 * not the full `ResolvedContentOption` - that's the only part of `content`
 * safe to ship to the browser (a `sqlite` config carries an absolute
 * filesystem path, see `dryVirtualContentConfig`). Client code uses it to
 * pick a search strategy: `ContentEntryList.tsx` does client-side
 * search/sort/pagination for `"file"` (its `listEntries` re-scans every
 * record on each request, so round-tripping per keystroke would be wasteful)
 * and leaves search to the server for `"sqlite"`/`"D1"` (SQL `LIKE`, one
 * query per request).
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
        `export const contentEngine = ${JSON.stringify(options.content.engine)};`,
        "export default { path, contentEngine };",
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

export const VIRTUAL_RICHTEXT_COMPONENTS_ID = "virtual:drycms/richtext-components";
const RESOLVED_RICHTEXT_COMPONENTS_ID = `\0${VIRTUAL_RICHTEXT_COMPONENTS_ID}`;

/**
 * `import.meta.glob` has to appear as literal source in a module Vite itself
 * transforms - it can't live inside `packages/drycms/dist` (prebuilt long
 * before the *consumer's* `componentsDir` exists), nor be passed around as a
 * runtime value. This virtual module's `load()` emits that literal, pointed
 * at the resolved `componentsDir` - Vite's glob-import transform runs on
 * generated/virtual module source the same as any real file (mục 2,
 * `status/register-compoennt.md`). Consumed both by the editor (lazy-loading
 * a component's real module for its `NodeView`) and the component
 * management admin page (listing/previewing every discovered file, not just
 * confirmed ones).
 */
export function dryVirtualRichtextComponents(componentsDir: string): Plugin {
  return {
    name: "drycms:virtual-richtext-components",
    resolveId(id) {
      if (id === VIRTUAL_RICHTEXT_COMPONENTS_ID) return RESOLVED_RICHTEXT_COMPONENTS_ID;
      return null;
    },
    load(id) {
      if (id !== RESOLVED_RICHTEXT_COMPONENTS_ID) return null;
      // A leading-`/` `import.meta.glob` pattern is resolved by Vite
      // relative to the *project root*, not as a real OS filesystem path -
      // passing `componentsDir` (already absolute, from `resolveOptions`)
      // straight through made Vite go looking for a literal `Users` folder
      // under the project root. `relative()` converts it back to a root-
      // relative path first (`componentsDir` is always inside the project
      // by construction, so this is always a plain forward path, never
      // `../`) - see `status/register-compoennt.md` mục 2.
      const relativeDir = relative(process.cwd(), componentsDir).replace(/\\/g, "/");
      const pattern = JSON.stringify(`/${relativeDir}/*/index.tsx`);
      return `export const components = import.meta.glob(${pattern});\n`;
    },
  };
}

export const VIRTUAL_RICHTEXT_COMPONENTS_CONFIG_ID = "virtual:drycms/richtext-components-config";
const RESOLVED_RICHTEXT_COMPONENTS_CONFIG_ID = `\0${VIRTUAL_RICHTEXT_COMPONENTS_CONFIG_ID}`;

/**
 * Exposes the resolved `richtext.storage` option to
 * `routes/richtext-components.ts` only - same rationale/shape as
 * `dryVirtualIconsConfig`, just a fourth independent root (confirmed
 * component records never mix with Media/Icons/file-content storage).
 */
export function dryVirtualRichtextComponentsConfig(storage: ResolvedStorageOption): Plugin {
  return {
    name: "drycms:virtual-richtext-components-config",
    resolveId(id) {
      if (id === VIRTUAL_RICHTEXT_COMPONENTS_CONFIG_ID) return RESOLVED_RICHTEXT_COMPONENTS_CONFIG_ID;
      return null;
    },
    load(id) {
      if (id !== RESOLVED_RICHTEXT_COMPONENTS_CONFIG_ID) return null;
      return [
        `export const richtextComponentsStorage = ${JSON.stringify(storage)};`,
        "export default { richtextComponentsStorage };",
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
	export const contentEngine: 'sqlite' | 'D1' | 'file';
	const config: { path: string; contentEngine: 'sqlite' | 'D1' | 'file' };
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

const CONTENT_CONFIG_TYPE = `{ engine: 'sqlite'; file: string } | { engine: 'D1'; binding: string } | ({ engine: 'file' } & ${STORAGE_CONFIG_TYPE})`;

export const VIRTUAL_CONTENT_CONFIG_TYPES = `declare module '${VIRTUAL_CONTENT_CONFIG_ID}' {
	export const content: ${CONTENT_CONFIG_TYPE};
	const config: { content: ${CONTENT_CONFIG_TYPE} };
	export default config;
}
`;

export const VIRTUAL_RICHTEXT_COMPONENTS_TYPES = `declare module '${VIRTUAL_RICHTEXT_COMPONENTS_ID}' {
	export const components: Record<string, () => Promise<{ default?: unknown }>>;
}
`;

export const VIRTUAL_RICHTEXT_COMPONENTS_CONFIG_TYPES = `declare module '${VIRTUAL_RICHTEXT_COMPONENTS_CONFIG_ID}' {
	export const richtextComponentsStorage: ${STORAGE_CONFIG_TYPE};
	const config: { richtextComponentsStorage: ${STORAGE_CONFIG_TYPE} };
	export default config;
}
`;
