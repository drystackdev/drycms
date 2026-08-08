import { resolve } from "node:path";
import { withProductionNodeEnv } from "../components/RichTextField/build-component-bundle.js";

/**
 * Compiles `preact-runtime.ts` into one self-contained ES module - Preact +
 * `preact/hooks` + `preact-iso/hydrate`'s own code, all inlined, with a
 * FULL, stable export surface regardless of what (if anything) this same
 * Vite process's OTHER builds happen to use from it (`preact-runtime.ts`'s
 * own doc comment has the full story on why that requirement rules out a
 * normal `rollupOptions.input`). Vite's **library** mode is the tool
 * actually built for this shape of problem - unlike an app-mode chunk, a
 * lib build's whole contract is "every declared export survives, because
 * something outside this build is going to import it by name" - so nothing
 * here needs the elision workarounds `preact-runtime.ts` tried and
 * abandoned.
 *
 * Dev-only, same as `build-component-bundle.ts`'s two builders this
 * deliberately mirrors (a nested `vite.build()` needs live Vite tooling,
 * which has no place in a deployed Workers bundle) - but unlike a
 * richtext component's own source, `preact-runtime.ts`'s content never
 * changes per-project, so ONE build's output is good forever: the caller
 * (`routes/asset-hrefs.ts`) only ever runs this once per storage backend,
 * the same "stat, build only if missing" gate
 * `build-component-bundle.ts`'s `ensureSharedPreactBundle` already
 * established for its own, differently-shaped Preact vendor bundle.
 */
export async function buildPreactRuntimeBundle(): Promise<string> {
  const { build } = await import("vite");
  const entryAbsPath = resolve(process.cwd(), "src/apps/preact-runtime.ts");

  const result = await withProductionNodeEnv(() =>
    build({
      configFile: false,
      logLevel: "silent",
      mode: "production",
      build: {
        write: false,
        minify: "oxc",
        lib: {
          entry: entryAbsPath,
          formats: ["es"],
          fileName: () => "preact-runtime.js",
        },
        rollupOptions: {
          output: {
            comments: false,
            minify: { compress: true, mangle: true, codegen: true },
          },
        },
      },
    }),
  );

  // Same `RolldownWatcher`-has-no-`output` narrowing as
  // `buildComponentBundle`/`buildSharedPreactBundle` - never reachable here
  // since this call never sets `watch`.
  const first = Array.isArray(result) ? result[0] : result;
  const output = first && "output" in first ? first.output[0] : undefined;
  if (!output || output.type !== "chunk") {
    throw new Error("Failed to produce the Preact runtime bundle.");
  }
  return output.code;
}
