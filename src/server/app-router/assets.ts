import {
  HYDRATE_ENTRY_HREF as GENERATED_HYDRATE_ENTRY_HREF,
  EDIT_LAUNCHER_HREF as GENERATED_EDIT_LAUNCHER_HREF,
  HYDRATE_BUILT_HREF as GENERATED_HYDRATE_BUILT_HREF,
} from "./generated-asset-hrefs.js";

import { resolveGlobalsCssHref } from "./resolve-asset-href.js";

export {
  resolveGlobalsCssHref,
  resolveHydrateEntryHref,
  resolveEditLauncherHref,
  resolveHydrateBuiltHref,
} from "./resolve-asset-href.js";

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
/** Dev SSR links the live stylesheet through Vite. Browser-built production
 * pages compile and inline the current pages-source stylesheet themselves. */
export const GLOBALS_CSS_HREF = import.meta.env.DEV ? resolveGlobalsCssHref(true) : "";
export const HYDRATE_ENTRY_HREF = import.meta.env.DEV ? "/src/apps/hydrate-client.ts" : GENERATED_HYDRATE_ENTRY_HREF;
/** See `src/apps/edit-launcher.ts` - the "Edit this page" button a signed-in
 * admin sees on the public site, which deep-links into Page Builder. */
export const EDIT_LAUNCHER_HREF = import.meta.env.DEV ? "/src/apps/edit-launcher.ts" : GENERATED_EDIT_LAUNCHER_HREF;
/** mục 7 - see `src/apps/hydrate-built.ts`'s doc comment. */
export const HYDRATE_BUILT_HREF = import.meta.env.DEV ? "/src/apps/hydrate-built.ts" : GENERATED_HYDRATE_BUILT_HREF;
