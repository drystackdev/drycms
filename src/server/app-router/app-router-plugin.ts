import { dirname, join, relative } from "node:path";
import type { Plugin } from "vite";

const DRY_CALL = /\bdry\s*\(/;
const HAS_DRY_IMPORT = /import\s*\{[^}]*\bdry\b[^}]*\}\s*from\s*["'][^"']*dry-reader(\.js)?["']/;
const SOURCE_FILE = /\.(tsx?|jsx?)$/;
const RELOAD_TRIGGER = /\/src\/apps\/(pages\/|globals\.css$)/;

const DRY_READER_ABS_PATH = join(process.cwd(), "src/content-types/dry-reader.ts");

/**
 * Single Vite plugin for everything `src/apps/pages/**` needs that isn't
 * covered by Preact/Tailwind's own plugins:
 *
 * - `transform` (`enforce: "pre"`, runs before Preact's JSX transform):
 *   injects `import { dry } from ".../dry-reader.js"` into any page module
 *   that calls `dry(` without importing it itself - closes the gap
 *   `dry.generated.d.ts`'s header comment flags ("Calling the ambient
 *   global `dry()` ... requires the Vite plugin ... not implemented yet")
 *   that the same file's own `declare global { function dry(): ... }`
 *   promises. Same shape as `build-component-bundle.ts`'s
 *   `dryComponentFilenamePlugin` - a small, regex-gated hook keyed by file
 *   path, not a full parser.
 *
 * - `handleHotUpdate`: Page/layout render entirely server-side for now (no
 *   client bundle yet - Giai đoạn 1/2 of `plans/app-router.md`, hydration
 *   still pending), so Vite's own HMR client never builds a module-graph
 *   connection to them - nothing in the browser ever `import()`s a
 *   `page.tsx`, so Vite's default "walk up to an accept boundary" HMR logic
 *   has nothing to walk from. A blanket full-reload on any relevant file
 *   change is the standard fallback for this shape of SSR-only dev setup.
 *   `render.ts` injects the `/@vite/client` script (dev only) this reload
 *   signal needs a live WebSocket connection for.
 *
 *   Known v1 tradeoff: the reload broadcast is unscoped (no `path` filter),
 *   so a browser tab with the admin SPA open at the same time also reloads
 *   when an App Router page changes - minor, not scoping it now to avoid
 *   guessing at Vite's client-side path-matching semantics without a real
 *   need yet.
 */
export function appRouterPlugin(): Plugin {
  return {
    name: "app-router",
    enforce: "pre" as const,
    transform(code: string, id: string) {
      const file = id.split("?", 1)[0] ?? "";
      if (!file.includes("/src/apps/pages/")) return null;
      if (!SOURCE_FILE.test(file)) return null;
      if (!DRY_CALL.test(code)) return null;
      if (HAS_DRY_IMPORT.test(code)) return null;

      let specifier = relative(dirname(file), DRY_READER_ABS_PATH)
        .replace(/\.ts$/, ".js")
        .replace(/\\/g, "/");
      if (!specifier.startsWith(".")) specifier = `./${specifier}`;

      return {
        code: `import { dry } from ${JSON.stringify(specifier)};\n${code}`,
        map: null,
      };
    },
    handleHotUpdate({ file, server }) {
      if (!RELOAD_TRIGGER.test(file)) return;
      server.ws.send({ type: "full-reload" });
      return [];
    },
  };
}
