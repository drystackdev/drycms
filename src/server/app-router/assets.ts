import { GLOBALS_CSS_HREF as GENERATED_GLOBALS_CSS_HREF, HYDRATE_ENTRY_HREF as GENERATED_HYDRATE_ENTRY_HREF } from "./generated-asset-hrefs.js";

export { resolveGlobalsCssHref, resolveHydrateEntryHref } from "./resolve-asset-href.js";

/**
 * Resolved once at module load, same "resolve once, reuse for process
 * lifetime" contract `config.ts`'s `resolved` and `entry-node.ts`'s
 * `indexHtml` already use. Production reads `generated-asset-hrefs.ts`
 * instead of `manifest.json` off disk directly (`resolve-asset-href.ts`'s
 * functions are still real, tested, pure functions - `asset-hrefs-plugin.ts`
 * calls them at CLIENT BUILD time and bakes the result into that generated
 * file) - a runtime `readFileSync` here would work fine on Node, but
 * Cloudflare Workers has no filesystem to read at all, so the hrefs have to
 * already be plain strings by the time this module is evaluated on any
 * runtime.
 */
export const GLOBALS_CSS_HREF = import.meta.env.DEV ? "/src/apps/globals.css" : GENERATED_GLOBALS_CSS_HREF;
export const HYDRATE_ENTRY_HREF = import.meta.env.DEV ? "/src/apps/hydrate-client.ts" : GENERATED_HYDRATE_ENTRY_HREF;
