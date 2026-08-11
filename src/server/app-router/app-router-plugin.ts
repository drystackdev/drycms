import { dirname, join, relative } from "node:path";
import type { Plugin } from "vite";
import { resolveOptions } from "../options.js";

const SOURCE_FILE = /\.(tsx?|jsx?)$/;
// `globals.css` used to have its own alternative here (`src/apps/globals.css`
// was a real, directly-served dev file) - it now lives in `pagesSourceStorage`'s
// `styles/` root instead (`source-roots.ts`), so its hot-reload is already
// covered by `isPagesSourceFile()` below like any other live-storage file.
const RELOAD_TRIGGER = /\/src\/apps\/pages\//;

const CONTENT_TYPES_DIR = join(process.cwd(), "src/content-types");

/** `pagesSourceStorage`'s local root (`.dry/pages-source` by default) - the
 * dev-only live source `route-tree.ts`'s `DevPagesSource` branch reads from
 * (see that file's own doc comment). A file loaded from there needs the
 * SAME ambient-global injection as one under `src/apps/pages` (real page/
 * layout source calls `dry()`/`params()`/etc with no import statement
 * either way), so this plugin's path gate below has to recognize both
 * roots. Resolved directly via `resolveOptions({ kind: "local" })`, NOT
 * `../config.js` - that module's `resolved` branches on
 * `import.meta.env.PROD`, unverified/untested territory for something read
 * while Vite is still loading ITS OWN config/plugins; `resolveOptions`
 * called explicitly is the same proven-safe pattern `scripts/sync-pages-r2.ts`/
 * `scripts/r2-sync-assets.ts` already use at their own module scope. `null`
 * under `kind: "cloudflare"` (R2-backed, no local root to gate on) - fine,
 * this plugin only ever runs inside a local Vite process anyway. */
const pagesSourceRoot = (() => {
  const storage = resolveOptions({ kind: "local" }).pagesSource.storage;
  return storage.kind === "local" ? storage.root.replace(/\\/g, "/") : null;
})();

function isPagesSourceFile(file: string): boolean {
  return !!pagesSourceRoot && (file === pagesSourceRoot || file.startsWith(`${pagesSourceRoot}/`));
}

/** One ambient global `src/apps/pages/**` can call without importing it
 * itself - `transform` below injects the right import (server vs client
 * module, matched to whichever build is compiling the file) the first time
 * it sees a bare call and no existing import already covers it. */
interface AmbientGlobal {
  name: string;
  /** Matches a bare call, e.g. `dry(`. */
  callPattern: RegExp;
  /** Matches an import the file ALREADY has for this global (either
   * module - server or client) - skips injecting a duplicate. */
  importPattern: RegExp;
  serverPath: string;
  clientPath: string;
}

const AMBIENT_GLOBALS: AmbientGlobal[] = [
  {
    name: "dry",
    callPattern: /\bdry\s*\(/,
    importPattern: /import\s*\{[^}]*\bdry\b[^}]*\}\s*from\s*["'][^"']*dry-reader(-client)?(\.js)?["']/,
    serverPath: join(CONTENT_TYPES_DIR, "dry-reader.ts"),
    clientPath: join(CONTENT_TYPES_DIR, "dry-reader-client.ts"),
  },
  {
    name: "params",
    callPattern: /\bparams\s*\(/,
    importPattern: /import\s*\{[^}]*\bparams\b[^}]*\}\s*from\s*["'][^"']*params-reader(-client)?(\.js)?["']/,
    serverPath: join(CONTENT_TYPES_DIR, "params-reader.ts"),
    clientPath: join(CONTENT_TYPES_DIR, "params-reader-client.ts"),
  },
  {
    // Same module on both sides, unlike the three above: `dryBind` reads a
    // ref off a value it's handed and returns an attribute object - no DB
    // access, nothing to swap out for the browser.
    name: "dryBind",
    callPattern: /\bdryBind\s*\(/,
    importPattern: /import\s*\{[^}]*\bdryBind\b[^}]*\}\s*from\s*["'][^"']*dry-vei(\.js)?["']/,
    serverPath: join(CONTENT_TYPES_DIR, "dry-vei.ts"),
    clientPath: join(CONTENT_TYPES_DIR, "dry-vei.ts"),
  },
  {
    name: "setTitle",
    callPattern: /\bsetTitle\s*\(/,
    importPattern: /import\s*\{[^}]*\bsetTitle\b[^}]*\}\s*from\s*["'][^"']*dry-title(-client)?(\.js)?["']/,
    serverPath: join(CONTENT_TYPES_DIR, "dry-title.ts"),
    clientPath: join(CONTENT_TYPES_DIR, "dry-title-client.ts"),
  },
];

/**
 * Single Vite plugin for everything `src/apps/pages/**` needs (and, in dev,
 * `pagesSourceStorage`'s files too - `isPagesSourceFile`, since
 * `route-tree.ts`'s `DevPagesSource` branch loads real page/layout modules
 * from `.dry/pages-source` through this same Vite instance) that isn't
 * covered by Preact/Tailwind's own plugins:
 *
 * - `transform` (`enforce: "pre"`, runs before Preact's JSX transform):
 *   injects `import { <name> } from "..."` into any page module (under
 *   EITHER root) that calls one of `AMBIENT_GLOBALS` (`dry`/`params`/
 *   `setTitle`) without importing it itself - closes the gap
 *   `dry.generated.d.ts`'s header comment flags ("Calling the ambient
 *   global `dry()` ... requires the Vite plugin ... not implemented yet")
 *   that the same file's own `declare global { ... }` promises. Same shape
 *   as `build-component-bundle.ts`'s `dryComponentFilenamePlugin` - a small,
 *   regex-gated hook keyed by file path, not a full parser.
 *
 *   Which module gets injected depends on WHICH build is compiling this
 *   file - `this.environment.config.consumer` (`"server"` for the SSR
 *   build/dev's `ssrLoadModule`, `"client"` for the browser bundle, the
 *   idiom this exact Vite version uses internally too) - the real,
 *   DB-backed/`AsyncLocalStorage`-backed server module for the server, or
 *   its client counterpart (replays/re-derives the SSR run's state instead
 *   of needing a DB or per-request storage that doesn't exist in the
 *   browser) for the client - see `plans/app-router.md`'s Giai đoạn 2. A
 *   file needing more than one global gets one injected `import` line per
 *   global actually called.
 *
 * - `handleHotUpdate`: Page/layout render server-side (streamed HTML) and
 *   client hydration (`hydrate-client.ts`) is a SEPARATE bundle Vite's HMR
 *   graph doesn't connect to a `page.tsx`/`layout.tsx` edit either (the
 *   server-rendered HTML it hydrates against would go stale otherwise) - a
 *   blanket full-reload on any relevant file change is the standard
 *   fallback for this shape of SSR+hydrate dev setup. `render.ts` injects
 *   the `/@vite/client` script (dev only) this reload signal needs a live
 *   WebSocket connection for.
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
      if (!file.includes("/src/apps/pages/") && !isPagesSourceFile(file)) return null;
      if (!SOURCE_FILE.test(file)) return null;

      const isServer = this.environment?.config.consumer === "server";
      const imports: string[] = [];
      for (const global of AMBIENT_GLOBALS) {
        if (!global.callPattern.test(code)) continue;
        if (global.importPattern.test(code)) continue;
        const target = isServer ? global.serverPath : global.clientPath;
        let specifier = relative(dirname(file), target)
          .replace(/\.ts$/, ".js")
          .replace(/\\/g, "/");
        if (!specifier.startsWith(".")) specifier = `./${specifier}`;
        imports.push(`import { ${global.name} } from ${JSON.stringify(specifier)};`);
      }
      if (imports.length === 0) return null;

      return {
        code: `${imports.join("\n")}\n${code}`,
        map: null,
      };
    },
    handleHotUpdate({ file, server }) {
      if (!RELOAD_TRIGGER.test(file) && !isPagesSourceFile(file)) return;
      server.ws.send({ type: "full-reload" });
      return [];
    },
  };
}
