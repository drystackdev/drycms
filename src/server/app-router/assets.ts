import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * `render.ts`'s `<link rel="stylesheet">` href for `src/apps/globals.css` -
 * see `plans/app-router.md`'s Giai đoạn 3. In dev, Vite's own middleware
 * compiles+serves the source path directly (`render.ts`'s previous
 * behavior, unchanged). In production there's no Vite server to do that, so
 * this reads the client build's `manifest.json` (`vite.config.ts`'s
 * `isSsrBuild`-gated `rollupOptions.input`/`manifest: true`) to find the
 * real hashed asset path instead.
 *
 * `dev`/`manifestPath` are parameters (not read from `import.meta.env`/
 * `process.cwd()` internally) so this is testable the same way
 * `route-tree.ts`'s `buildRouteTree` is - a pure function, real
 * environment values supplied only at the real call site below.
 */
export function resolveGlobalsCssHref(
  dev: boolean,
  manifestPath: string = join(process.cwd(), "dist/client/.vite/manifest.json"),
): string {
  if (dev) return "/src/apps/globals.css";

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, { file: string }>;
  const entry = manifest["src/apps/globals.css"];
  if (!entry) {
    throw new Error(
      `[drycms] ${manifestPath} has no "src/apps/globals.css" entry - rebuild with \`bun run build\`.`,
    );
  }
  return `/${entry.file}`;
}

/** Resolved once at module load, same "resolve once, reuse for process
 * lifetime" contract `config.ts`'s `resolved` and `entry-node.ts`'s
 * `indexHtml` already use - the manifest's hashed filename can't change
 * without a new process anyway. */
export const GLOBALS_CSS_HREF = resolveGlobalsCssHref(import.meta.env.DEV);
