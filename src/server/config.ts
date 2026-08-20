import { setAdminPath } from "../storage/admin-path.js";
import { resolveOptions } from "./options.js";

/**
 * Resolved once at server startup (dev: when Vite's SSR module graph first
 * loads this module; prod: at process start) and reused for the lifetime of
 * the process - "resolve once, read everywhere".
 *
 * No project-level config file (there used to be a `dry.config.ts` here) -
 * `kind` is the only thing this app ever set, and it's now derived
 * automatically from which SSR entry is being built rather than hand-written:
 * `import.meta.env.DRYCMS_KIND` is baked in per-build by `vite.config.ts`'s
 * `define` (`"cloudflare"` only for the Workers build/dev - `build:worker`/
 * `deploy`/`dev:worker` - `"local"` for `bun run dev` and the Node build
 * alike). `import.meta.env.PROD` alone can't make this distinction: both the
 * Node and Workers SSR builds are plain `vite build --ssr`, so PROD is `true`
 * for both.
 */
export const resolved = resolveOptions({ kind: import.meta.env.DRYCMS_KIND ?? "local" });

export const { path, storage, icons, content, ai, kv, lang } = resolved;

// Hands the base path to the one module that needs it on BOTH sides -
// see `storage/admin-path.ts` for why it can't just import this file.
setAdminPath(resolved.path);
export const componentsStorage = resolved.components.storage;
export const pagesCacheStorage = resolved.pagesCache.storage;
export const pagesCacheEdgeTtl = resolved.pagesCache.edgeTtl;
export const typesCacheStorage = resolved.typesCache.storage;
export const pagesSourceStorage = resolved.pagesSource.storage;
