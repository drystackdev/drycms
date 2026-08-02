import { fileURLToPath } from "node:url";
import preact from "@preact/preset-vite";
import { defineConfig } from "vite";
import dryUserOptions from "./dry.config.js";
import { resolveOptions } from "./src/server/options.js";

// Config-time only (this file is evaluated once, in Node, by Vite's own
// config loader) - `resolveOptions` validates `dry.config.ts` up front so a
// bad value fails at startup instead of on the first request. The full
// resolved config is re-read at runtime by `src/server/config.ts`; only the
// two client-safe fields below (see `src/dry-config.client.ts`) get baked
// into the client bundle via `define`.
const resolved = resolveOptions(dryUserOptions);

export default defineConfig({
  plugins: [preact()],
  build: {
    // Showcase intentionally bundles every component demo into one route
    // chunk; it is lazy-loaded from the app shell, so this size is not part of
    // the initial path. Keep Vite's warning threshold above that deliberate
    // demo bundle while retaining the default warning for normal chunks.
    chunkSizeWarningLimit: 3500,
  },
  resolve: {
    alias: {
      // Every client file still imports the old virtual-module specifier
      // (see `status/remove-astro.md`) - aliasing it to a real file keeps
      // every one of those imports working unchanged.
      "virtual:drycms/config": fileURLToPath(new URL("./src/dry-config.client.ts", import.meta.url)),
    },
  },
  define: {
    __DRY_PATH__: JSON.stringify(resolved.path),
    __DRY_CONTENT_ENGINE__: JSON.stringify(resolved.content.engine),
  },
});
