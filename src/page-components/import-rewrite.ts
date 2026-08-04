/** Matches a relative `from "..."` specifier in an `import`/`export ... from`
 * statement - the only import shape Component Builder's eval (`sucrase-eval.ts`)
 * and `Editer`'s `extraFiles` resolution both support. Regex-based (not a
 * real AST edit) - good enough for hand-authored component source, and
 * avoids round-tripping through Sucrase's transpile-only output (which
 * doesn't preserve original formatting) just to rename one string literal.
 * Only ever rewrites specifiers starting with "." - a bare/npm specifier is
 * left untouched (there's nothing to recompute; it doesn't move). */
const IMPORT_SPECIFIER_RE = /(\bfrom\s*["'])(\.[^"']*)(["'])/g;

function dirOf(path: string): string {
  const index = path.lastIndexOf("/");
  return index === -1 ? "" : path.slice(0, index);
}

/** Resolves a relative specifier against the directory of the file it
 * appears in, into a normalized tree-root-relative path - same algorithm
 * `sucrase-eval.ts`'s `resolveModulePath` uses for the reverse direction. */
function resolveSpecifier(fromDir: string, specifier: string): string {
  const segments = (fromDir ? fromDir.split("/") : []).concat(specifier.split("/"));
  const resolved: string[] = [];
  for (const segment of segments) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") resolved.pop();
    else resolved.push(segment);
  }
  return resolved.join("/");
}

/** Inverse of `resolveSpecifier`: the relative specifier `fromPath` would
 * need to reach `targetPath`, always `./`- or `../`-prefixed (never a bare
 * sibling name) so it round-trips through `resolveSpecifier` unchanged. */
function relativeSpecifier(fromPath: string, targetPath: string): string {
  const fromParts = dirOf(fromPath).split("/").filter(Boolean);
  const targetParts = targetPath.split("/").filter(Boolean);
  let common = 0;
  while (common < fromParts.length && common < targetParts.length - 1 && fromParts[common] === targetParts[common]) {
    common += 1;
  }
  const ups = fromParts.length - common;
  const down = targetParts.slice(common);
  const path = [...Array(ups).fill(".."), ...down].join("/");
  return path.startsWith(".") ? path : `./${path}`;
}

function rewriteSpecifiersInSource(source: string, map: (specifier: string) => string): string {
  return source.replace(IMPORT_SPECIFIER_RE, (match, prefix, specifier, suffix) => `${prefix}${map(specifier)}${suffix}`);
}

/**
 * After moving `fromPath` -> `toPath` in `sourceByPath` (the move itself -
 * updating the map's key - is the caller's job), returns the source updates
 * needed to keep every relative import pointed at the right file:
 *
 * - The moved file's own relative imports get recomputed (its directory
 *   changed, so `./Sibling.tsx` may now need to become `../old-folder/Sibling.tsx`).
 * - Every OTHER file that imported `fromPath` gets its specifier rewritten
 *   to `toPath`'s new relative path.
 *
 * Scoped to single-FILE moves - a folder move (recursive) keeps every
 * relative import *within* that folder correct for free (their relative
 * positions to each other don't change), and cross-boundary imports in/out
 * of a moved folder are a rarer edge case left unhandled here, same
 * trade-off `plans/component-builder.md`'s drag-drop note accepts.
 *
 * Returns only the paths whose source actually changed, keyed by their
 * (possibly new, for `fromPath` itself) path - caller applies these on top
 * of its already-moved `sourceByPath`.
 */
export function rewriteImportsAfterMove(
  sourceByPath: Record<string, string>,
  fromPath: string,
  toPath: string,
): Record<string, string> {
  const updates: Record<string, string> = {};

  const movedSource = sourceByPath[fromPath];
  if (movedSource !== undefined) {
    const rewritten = rewriteSpecifiersInSource(movedSource, (specifier) => {
      const target = resolveSpecifier(dirOf(fromPath), specifier);
      return relativeSpecifier(toPath, target);
    });
    if (rewritten !== movedSource) updates[toPath] = rewritten;
  }

  for (const [path, source] of Object.entries(sourceByPath)) {
    if (path === fromPath) continue;
    const rewritten = rewriteSpecifiersInSource(source, (specifier) => {
      const target = resolveSpecifier(dirOf(path), specifier);
      return target === fromPath ? relativeSpecifier(path, toPath) : specifier;
    });
    if (rewritten !== source) updates[path] = rewritten;
  }

  return updates;
}
