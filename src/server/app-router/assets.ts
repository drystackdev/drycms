import { readFileSync } from "node:fs";
import { join } from "node:path";

interface ManifestEntry {
  file: string;
}

/**
 * `render.ts`'s built-asset hrefs (`GLOBALS_CSS_HREF`/`HYDRATE_ENTRY_HREF`
 * below) - see `plans/app-router.md`'s Giai đoạn 3/2. In dev, Vite's own
 * middleware compiles+serves the source path directly. In production
 * there's no Vite server to do that, so this reads the client build's
 * `manifest.json` (`vite.config.ts`'s `isSsrBuild`-gated
 * `rollupOptions.input`/`manifest: true`) to find the real hashed asset
 * path instead - keyed by the SOURCE path relative to repo root (confirmed
 * against `vite`'s own manifest-plugin source, not the alias name used in
 * `rollupOptions.input`).
 *
 * `dev`/`manifestPath` are parameters (not read from `import.meta.env`/
 * `process.cwd()` internally) so this is testable the same way
 * `route-tree.ts`'s `buildRouteTree` is - a pure function, real
 * environment values supplied only at the real call sites below.
 */
function resolveBuiltAssetHref(dev: boolean, sourcePath: string, manifestPath: string): string {
  if (dev) return `/${sourcePath}`;

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, ManifestEntry>;
  const entry = manifest[sourcePath];
  if (!entry) {
    throw new Error(`[drycms] ${manifestPath} has no "${sourcePath}" entry - rebuild with \`bun run build\`.`);
  }
  return `/${entry.file}`;
}

export function resolveGlobalsCssHref(
  dev: boolean,
  manifestPath: string = join(process.cwd(), "dist/client/.vite/manifest.json"),
): string {
  return resolveBuiltAssetHref(dev, "src/apps/globals.css", manifestPath);
}

export function resolveHydrateEntryHref(
  dev: boolean,
  manifestPath: string = join(process.cwd(), "dist/client/.vite/manifest.json"),
): string {
  return resolveBuiltAssetHref(dev, "src/apps/hydrate-client.ts", manifestPath);
}

/** Resolved once at module load, same "resolve once, reuse for process
 * lifetime" contract `config.ts`'s `resolved` and `entry-node.ts`'s
 * `indexHtml` already use - the manifest's hashed filenames can't change
 * without a new process anyway. */
export const GLOBALS_CSS_HREF = resolveGlobalsCssHref(import.meta.env.DEV);
export const HYDRATE_ENTRY_HREF = resolveHydrateEntryHref(import.meta.env.DEV);
