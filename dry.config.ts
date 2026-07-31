import type { DryOption } from "./src/server/options.js";

/**
 * drycms's own configuration - see `src/server/options.ts`'s `DryOption` for
 * every field and its default. Values here mirror what used to be the
 * `dry({ ... })` call in `astro.config.mjs`.
 */
export default {
  // path: "/dry",
  // storage: { kind: "local", root: "storage" },
  // icons: { kind: "local", root: "icons" },
  // content: { engine: "sqlite", file: "content.sqlite" },
  // richtext: { componentsDir: "src/dry-components" },
} satisfies DryOption;
