import preact from "@preact/preset-vite";
import { defineConfig } from "vite";
import dryUserOptions from "./dry.config.js";
import { resolveOptions } from "./src/server/options.js";

// Config-time only (this file is evaluated once, in Node, by Vite's own
// config loader) - `resolveOptions` validates `dry.config.ts` up front so a
// bad value fails at startup instead of on the first request. The full
// resolved config is re-read at runtime by `src/server/config.ts`; the two
// client-safe fields are exposed by `clientConfigPlugin` below.
const resolved = resolveOptions(dryUserOptions);

const clientConfigModule = "virtual:drycms/config";
const resolvedClientConfigModule = `\0${clientConfigModule}`;

/** Keep client config literal in both dev and production through one module. */
function clientConfigPlugin() {
  return {
    name: "drycms-client-config",
    resolveId(id: string) {
      return id === clientConfigModule ? resolvedClientConfigModule : undefined;
    },
    load(id: string) {
      if (id !== resolvedClientConfigModule) return undefined;
      return [
        `export const path = ${JSON.stringify(resolved.path)};`,
        `export const contentEngine = ${JSON.stringify(resolved.content.engine)};`,
        `export default { path, contentEngine };`,
      ].join("\n");
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
    chunkSizeWarningLimit: 3500,
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
