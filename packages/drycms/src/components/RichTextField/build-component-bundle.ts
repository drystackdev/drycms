import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "../../lib/uuid.js";

/** Left external by `buildComponentBundle` below (rewritten to `./preact.js`
 * instead of inlined) - the same 3 specifiers `buildSharedPreactBundle`
 * re-exports everything from, so between the two, nothing a component's own
 * source imports from Preact ever goes unresolved. */
const PREACT_EXTERNALS = ["preact", "preact/hooks", "preact/jsx-runtime"];

/**
 * Both `build()` calls below only ever run from inside the astro *dev*
 * server (`import.meta.env.DEV` guard in `routes/richtext-components.ts`'s
 * `buildAndStore`) - there's no separate production build step, so whatever
 * these produce is what actually ships. Left alone, they'd inherit that dev
 * server's own `NODE_ENV=development`: passing `mode: "production"` to
 * `build()` is NOT enough to fix that on its own - Vite derives
 * `config.isProduction` (which `@preact/preset-vite` reads to choose its
 * dev-vs-prod JSX transform, among other things) straight from
 * `process.env.NODE_ENV`, not from the resolved `mode`. Nested/concurrent
 * calls (two confirms in flight at once) are handled with a simple in-flight
 * counter - only the *first* caller's original value is restored once every
 * caller sees production, not each individual call's own (already-
 * overridden) snapshot.
 */
let productionBuildsInFlight = 0;
let originalNodeEnv: string | undefined;
async function withProductionNodeEnv<T>(fn: () => Promise<T>): Promise<T> {
  if (productionBuildsInFlight === 0) originalNodeEnv = process.env.NODE_ENV;
  productionBuildsInFlight++;
  process.env.NODE_ENV = "production";
  try {
    return await fn();
  } finally {
    productionBuildsInFlight--;
    if (productionBuildsInFlight === 0) {
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
    }
  }
}

/**
 * Builds the one shared Preact + `preact/hooks` + `preact/jsx-runtime`
 * vendor bundle every confirmed component's own bundle (`buildComponentBundle`
 * below) imports as `./preact.js` rather than inlining its own copy -
 * `routes/richtext-components.ts` writes this once, as a sibling of every
 * `{slug}.js`/`{slug}.json` pair in the same storage root, and only rebuilds
 * it if it's missing. A relative sibling import still resolves the same
 * regardless of where that whole directory ends up hosted, so components
 * stay just as portable as when each one inlined its own copy - N confirmed
 * components now share one Preact download+parse (the browser caches an ES
 * module per URL) instead of each shipping and re-parsing its own.
 *
 * Built from a throwaway temp-file entry (a plain 3-line re-export barrel) -
 * written inside `process.cwd()` itself (not the OS temp dir) specifically
 * so it has the project's own `node_modules` as an ancestor: Rollup/Rolldown's
 * bare-specifier resolution walks up from the *importing file's own
 * directory*, not from `build.root`, so an entry under e.g. `/tmp` would
 * never find "preact" no matter what `root` says - `buildComponentBundle`'s
 * own entry never needed this workaround only because it already lives
 * inside the real project tree.
 */
export async function buildSharedPreactBundle(): Promise<string> {
  const { build } = await import("vite");
  const entryPath = join(process.cwd(), `.drycms-preact-vendor-${randomUUID()}.mjs`);
  try {
    await writeFile(
      entryPath,
      PREACT_EXTERNALS.map((specifier) => `export * from ${JSON.stringify(specifier)};`).join("\n") + "\n",
      "utf8",
    );

    const result = await withProductionNodeEnv(() =>
      build({
        configFile: false,
        logLevel: "silent",
        mode: "production",
        build: {
          write: false,
          // Explicit rather than relying on the default: Vite's own
          // (unexported) resolution for this falls back to `false` when it
          // detects it's bundling from *inside* a running dev server - which
          // this always is (see `withProductionNodeEnv`'s own comment). Spelled
          // out here so this stays minified even if that inference ever
          // changes out from under this call.
          minify: "oxc",
          lib: {
            entry: entryPath,
            formats: ["es"],
            fileName: () => "preact.js",
          },
          rollupOptions: {
            output: {
              // Vite's own "oxc" lib+es default leaves `codegen` off (keeps
              // newlines/indentation) and `comments` on (keeps //#region
              // markers) so consumers can still read a lib build's source -
              // irrelevant here since nothing but the browser ever loads
              // these, so both are overridden to shrink the output further.
              comments: false,
              minify: { compress: true, mangle: true, codegen: true },
            },
          },
        },
      }),
    );

    // Same `RolldownWatcher`-has-no-`output` narrowing as `buildComponentBundle`
    // below - never reachable here since this call never sets `watch`.
    const first = Array.isArray(result) ? result[0] : result;
    const output = first && "output" in first ? first.output[0] : undefined;
    if (!output || output.type !== "chunk") {
      throw new Error("Failed to produce the shared Preact vendor bundle.");
    }
    return output.code;
  } finally {
    await rm(entryPath, { force: true });
  }
}

/**
 * Compiles one confirmed richtext component's real source file into a
 * self-contained ES module - the component's own code, fully inlined, plus
 * everything it imports *except* `preact`/`preact/hooks`/`preact/jsx-runtime`
 * (see `PREACT_EXTERNALS`), which are left as external imports rewritten to
 * `./preact.js` (`buildSharedPreactBundle` above) instead of inlined again
 * per component - so the editor and the published site can still `import()`
 * this directly without needing `componentsDir`'s raw source (or a `preact`
 * dependency of their own) in their own build graph, just without paying for
 * a fresh copy of Preact on every single confirmed component.
 *
 * `vite`/`@preact/preset-vite` are dynamically imported so this dev-only
 * tooling is never pulled into any other module's import graph until a build
 * is actually requested (`routes/richtext-components.ts` gates the callers
 * behind `import.meta.env.DEV`).
 */
export async function buildComponentBundle(entryAbsPath: string): Promise<string> {
  const { build } = await import("vite");
  const { preact } = await import("@preact/preset-vite");

  const result = await withProductionNodeEnv(() =>
    build({
      configFile: false,
      logLevel: "silent",
      mode: "production",
      // Explicit even with `NODE_ENV`/`mode` both forced to production -
      // belt and suspenders against a future `@preact/preset-vite` version
      // changing how it derives these two defaults.
      plugins: [preact({ devToolsEnabled: false, prefreshEnabled: false })],
      build: {
        write: false,
        // See `buildSharedPreactBundle`'s own comment on this.
        minify: "oxc",
        lib: {
          entry: entryAbsPath,
          formats: ["es"],
          fileName: () => "bundle.js",
        },
        rollupOptions: {
          external: PREACT_EXTERNALS,
          output: {
            paths: Object.fromEntries(PREACT_EXTERNALS.map((specifier) => [specifier, "./preact.js"])),
            // See `buildSharedPreactBundle`'s matching comment on this.
            comments: false,
            minify: { compress: true, mangle: true, codegen: true },
          },
        },
      },
    }),
  );

  // `build()`'s return type also covers the `watch: true` case (a
  // `RolldownWatcher`, which has no `output`) - never reachable here since
  // this call never sets `watch`, but TS still needs it narrowed away.
  const first = Array.isArray(result) ? result[0] : result;
  const output = first && "output" in first ? first.output[0] : undefined;
  if (!output || output.type !== "chunk") {
    throw new Error(`Failed to produce a JS bundle for "${entryAbsPath}".`);
  }
  return output.code;
}
