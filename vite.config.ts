import preact from "@preact/preset-vite";
import { defineConfig } from "vite";
import { resolved } from "./src/server/config.js";

// Importing `resolved` (rather than calling `resolveOptions(dryUserOptions)`
// again here) both re-validates `dry.config.ts` at Vite-config-load time -
// this file is evaluated once, in Node, by Vite's own config loader, so a bad
// value fails at startup instead of on the first request - and keeps that
// validation to the one place (`src/server/config.ts`) instead of a second,
// redundant `resolveOptions` call. The two client-safe fields are exposed to
// the browser by `clientConfigPlugin` below.

const CLIENT_CONFIG_MODULE = "virtual:drycms/config";
const RESOLVED_CLIENT_CONFIG_MODULE = `\0${CLIENT_CONFIG_MODULE}`;

/** Keep client config literal in both dev and production through one module. */
function clientConfigPlugin() {
  return {
    name: "drycms-client-config",
    resolveId(id: string) {
      return id === CLIENT_CONFIG_MODULE ? RESOLVED_CLIENT_CONFIG_MODULE : undefined;
    },
    load(id: string) {
      if (id !== RESOLVED_CLIENT_CONFIG_MODULE) return undefined;
      return `
        export const path = ${JSON.stringify(resolved.path)};
        export const contentEngine = ${JSON.stringify(resolved.content.engine)};
        export default { path, contentEngine };
      `;
    },
  };
}

export default defineConfig({
  plugins: [clientConfigPlugin(), preact()],
  build: {
    // Showcase intentionally bundles every component demo into one route
    // chunk; it is lazy-loaded from the app shell, so this size is not part of
    // the initial path. Keep Vite's warning threshold above that deliberate
    // demo bundle while retaining the default warning for normal chunks.
    chunkSizeWarningLimit: 1024,
  },
  resolve: {
    // Keep `preact-iso` and the app on one Preact singleton.
    dedupe: ["preact", "preact/hooks", "preact/jsx-runtime", "preact/jsx-dev-runtime"],
  },
  optimizeDeps: {
    // Prebundling `preact-iso` embeds a second Preact module in Vite dev.
    exclude: ["preact-iso"],
  },
});
