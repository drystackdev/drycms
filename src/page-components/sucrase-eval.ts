import { transform, type Options as SucraseOptions } from "sucrase";
import { h, Fragment, type ComponentType } from "preact";

export class ComponentEvalError extends Error {}

const SUCRASE_OPTIONS: SucraseOptions = {
  transforms: ["jsx", "typescript", "imports"],
  jsxPragma: "h",
  jsxFragmentPragma: "Fragment",
  production: true,
};

/** Resolves a relative `import`/`require` specifier against `fromPath`
 * (both POSIX, relative to the component tree root) - `.tsx`/`.ts` is tried
 * when the specifier omits it, matching how `Editer`'s `ts-worker.ts`
 * resolves `extraFiles`. Only relative specifiers are ever accepted - a
 * bare specifier (an npm package) throws, since Component Builder's whole
 * point is "only file imports" (see `plans/component-builder.md`). */
function resolveModulePath(fromPath: string, specifier: string, sourceByPath: Record<string, string>): string {
  if (!specifier.startsWith(".")) {
    throw new ComponentEvalError(
      `Cannot import "${specifier}" - only relative imports of other components in this tree are allowed.`,
    );
  }
  const fromDir = fromPath.includes("/") ? fromPath.slice(0, fromPath.lastIndexOf("/")) : "";
  const segments = (fromDir ? fromDir.split("/") : []).concat(specifier.split("/"));
  const resolved: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") resolved.pop();
    else resolved.push(segment);
  }
  const base = resolved.join("/");
  for (const candidate of [base, `${base}.tsx`, `${base}.ts`]) {
    if (candidate in sourceByPath) return candidate;
  }
  throw new ComponentEvalError(`Cannot find "${specifier}" imported from "${fromPath}".`);
}

/** Transforms and evaluates one module's source, memoized in `moduleCache`
 * so a component imported by multiple files only runs once - same
 * single-evaluation contract a real module system gives you, needed here
 * since evaluating twice would produce two distinct component identities. */
function evalModule(
  path: string,
  sourceByPath: Record<string, string>,
  moduleCache: Map<string, { exports: any }>,
): { exports: any } {
  const cached = moduleCache.get(path);
  if (cached) return cached;

  const moduleObj = { exports: {} as any };
  moduleCache.set(path, moduleObj);

  let transformed: string;
  try {
    transformed = transform(sourceByPath[path]!, SUCRASE_OPTIONS).code;
  } catch (error) {
    moduleCache.delete(path);
    throw new ComponentEvalError(error instanceof Error ? error.message : String(error));
  }

  const require = (specifier: string) => evalModule(resolveModulePath(path, specifier, sourceByPath), sourceByPath, moduleCache).exports;

  try {
    // eslint-disable-next-line no-new-func
    const fn = new Function("module", "exports", "require", "h", "Fragment", transformed);
    fn(moduleObj, moduleObj.exports, require, h, Fragment);
  } catch (error) {
    moduleCache.delete(path);
    throw error instanceof ComponentEvalError ? error : new ComponentEvalError(error instanceof Error ? error.message : String(error));
  }

  return moduleObj;
}

/**
 * Transpiles (Sucrase) + evaluates `entryPath`'s default export as a Preact
 * component, resolving any relative imports against the other files in
 * `sourceByPath` - a tiny CommonJS-shaped module system (Sucrase's `imports`
 * transform already emits `require(...)` calls, this just supplies one).
 * Re-evaluates the whole subtree fresh on every call (no cross-call cache) -
 * the caller is expected to only call this after code changes settle
 * (debounced), same as `EditableDemo.tsx`'s Babel path.
 */
export function evalPageComponent(entryPath: string, sourceByPath: Record<string, string>): ComponentType<any> {
  if (!(entryPath in sourceByPath)) {
    throw new ComponentEvalError(`"${entryPath}" is not loaded.`);
  }
  const moduleCache = new Map<string, { exports: any }>();
  const mod = evalModule(entryPath, sourceByPath, moduleCache);
  const exported = mod.exports?.default ?? mod.exports;
  if (typeof exported !== "function") {
    throw new ComponentEvalError(`"${entryPath}" has no default export function.`);
  }
  return exported;
}
