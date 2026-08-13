/**
 * Shrinks one already-compiled ESM source string - `page-build.ts`'s
 * `compileEsmAsset` output, whitespace/comments intact because sucrase only
 * strips types (`page-build.ts`'s own doc comment on `ESM_OPTIONS`).
 *
 * `buildPage()` runs in the ADMIN'S OWN BROWSER TAB (`page-build.ts`'s own
 * doc comment - "the browser build orchestrator"), not on the server -
 * `PageEditor.tsx`/`PageBuild.tsx` call it directly from client code. A first
 * attempt at this reused `build-component-bundle.ts`'s nested `vite build()`
 * trick, which pulls in `node:fs`/`node:path` - that one only works there
 * because those calls are only ever reached from a SERVER route handler
 * (`routes/richtext-components.ts`, behind `import.meta.env.DEV`); wired into
 * `page-build.ts` it crashed the moment Vite tried to bundle `node:fs` for
 * the client ("Module has been externalized for browser compatibility").
 * `terser` is pure JS with no Node built-ins anywhere in its `minify()` path
 * (confirmed against its own source) - the exact same call works identically
 * here, under `PageEditor`'s live browser tab, and under vitest's Node test
 * environment.
 *
 * Dynamically imported (not a top-level import) so terser's own weight is
 * only paid the first time a build/publish actually runs, not on every
 * `PageEditor`/`PageBuild` mount - same reasoning `Editer/format-code.ts`'s
 * `loadPlugins` already documents for Prettier's plugins.
 */
export async function minifyEsmSource(source: string): Promise<string> {
  const { minify } = await import("terser");
  // `module: true` - the input always uses ESM import/export syntax
  // (`compileEsmAsset` prepends a real `import` unconditionally). Import
  // BINDING names (`h`, `Fragment`, ...) still get mangled like any other
  // local identifier - harmless, since only the imported EXPORT name (never
  // touched) is what the browser resolves against.
  const result = await minify(source, { module: true, compress: true, mangle: true, format: { comments: false } });
  if (typeof result.code !== "string") {
    throw new Error("Failed to minify the compiled asset.");
  }
  return result.code;
}
