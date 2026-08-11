import { readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveOptions } from "../options.js";

interface ManifestEntry {
  file: string;
}

/**
 * Pure - no `import.meta.env`/module-scope side effects - so both
 * `assets.ts` (runtime, dev vs. production) and `asset-hrefs-plugin.ts`
 * (build time, always production) can call it directly. Kept in its own
 * module rather than `assets.ts` itself: `vite.config.ts` loads
 * `asset-hrefs-plugin.ts` directly (outside any real Vite build pass), and
 * a module with a top-level `import.meta.env.DEV` read - `assets.ts` has
 * one - throws in that context (`import.meta.env` is only populated inside
 * an actual Vite dev/build run).
 *
 * `render.ts`'s built-asset hrefs (`GLOBALS_CSS_HREF`/`HYDRATE_ENTRY_HREF`
 * in `assets.ts`) - see `plans/app-router.md`'s Giai đoạn 3/2. In dev,
 * Vite's own middleware compiles+serves the source path directly. In
 * production there's no Vite server to do that, so this reads the client
 * build's `manifest.json` (`vite.config.ts`'s `isSsrBuild`-gated
 * `rollupOptions.input`/`manifest: true`) to find the real hashed asset
 * path instead - keyed by the SOURCE path relative to repo root (confirmed
 * against `vite`'s own manifest-plugin source, not the alias name used in
 * `rollupOptions.input`).
 *
 * `dev`/`manifestPath` are parameters (not read from `import.meta.env`/
 * `process.cwd()` internally) so this is testable the same way
 * `route-tree.ts`'s `buildRouteTree` is - a pure function, real
 * environment values supplied only at the real call sites.
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

/**
 * Unlike the sibling `resolve*Href` functions below, `globals.css`'s LIVE
 * source in dev isn't `src/apps/**` at all - it's `pagesSourceStorage`'s
 * `styles/` root (`source-roots.ts`), the same live-storage `pages/`/
 * `component/` already edit through the Page Editor with no separate build
 * step. `src/apps/styles/globals.css` (this function's `dev: false` branch)
 * is only the BUILD-TIME materialized copy `sync-pages-r2.ts` produces right
 * before `vite build` - in dev that path is never written to at all, so
 * serving it would 404. Instead the dev branch points straight at the live
 * file on disk via Vite's `/@fs/<absolute-path>` mechanism (same
 * `resolveOptions({ kind: "local" })` call `app-router-plugin.ts`'s own
 * `pagesSourceRoot` constant already uses, for the same reason: this only
 * ever runs inside a local Vite dev process, so a local storage root always
 * resolves). Forward slashes only - `/@fs/` is a literal URL path, and a
 * Windows backslash would round-trip as `%5C` instead of a path separator.
 */
export function resolveGlobalsCssHref(
  dev: boolean,
  manifestPath: string = join(process.cwd(), "dist/client/.vite/manifest.json"),
): string {
  if (dev) {
    const storage = resolveOptions({ kind: "local" }).pagesSource.storage;
    if (storage.kind === "local") {
      return `/@fs/${join(storage.root, "styles/globals.css").replace(/\\/g, "/")}`;
    }
  }
  return resolveBuiltAssetHref(dev, "src/apps/styles/globals.css", manifestPath);
}

export function resolveHydrateEntryHref(
  dev: boolean,
  manifestPath: string = join(process.cwd(), "dist/client/.vite/manifest.json"),
): string {
  return resolveBuiltAssetHref(dev, "src/apps/hydrate-client.ts", manifestPath);
}

export function resolveVeiOverlayHref(
  dev: boolean,
  manifestPath: string = join(process.cwd(), "dist/client/.vite/manifest.json"),
): string {
  return resolveBuiltAssetHref(dev, "src/apps/vei/overlay.ts", manifestPath);
}

/** mục 7 - see `src/apps/hydrate-built.ts`'s doc comment. */
export function resolveHydrateBuiltHref(
  dev: boolean,
  manifestPath: string = join(process.cwd(), "dist/client/.vite/manifest.json"),
): string {
  return resolveBuiltAssetHref(dev, "src/apps/hydrate-built.ts", manifestPath);
}
