/**
 * Compiles one confirmed richtext component's real source file into a single,
 * self-contained ES module - Preact + `preact/hooks` + the component's own
 * code all inlined, nothing external - so the editor and the published site
 * can `import()` it directly without needing `componentsDir`'s raw source (or
 * a `preact` dependency of their own) in their own build graph.
 *
 * `vite`/`@preact/preset-vite` are dynamically imported so this dev-only
 * tooling is never pulled into any other module's import graph until a build
 * is actually requested (`routes/richtext-components.ts` gates the callers
 * behind `import.meta.env.DEV`).
 */
export async function buildComponentBundle(entryAbsPath: string): Promise<string> {
  const { build } = await import("vite");
  const { preact } = await import("@preact/preset-vite");

  const result = await build({
    configFile: false,
    logLevel: "silent",
    plugins: [preact()],
    build: {
      write: false,
      lib: {
        entry: entryAbsPath,
        formats: ["es"],
        fileName: () => "bundle.js",
      },
    },
  });

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
