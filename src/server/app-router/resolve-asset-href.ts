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
 *
 */
function resolveBuiltAssetHref(dev: boolean, sourcePath: string, manifestPath: string): string {
  if (dev) return `/${sourcePath}`;

  let manifest: Record<string, ManifestEntry>;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, ManifestEntry>;
  } catch (error) {
    throw error;
  }
  const entry = manifest[sourcePath];
  if (!entry) {
    throw new Error(`[drycms] ${manifestPath} has no "${sourcePath}" entry - rebuild with \`bun run build\`.`);
  }
  return `/${entry.file}`;
}

/**
 * Unlike the sibling `resolve*Href` functions below, `globals.css`'s LIVE
 * source in dev is `pagesSourceStorage`'s
 * `styles/` root (`source-roots.ts`), the same live-storage `pages/`/
 * `component/` already edit through the Page Editor with no separate build
 * step. The dev branch points straight at the live
 * file on disk via Vite's `/@fs/<absolute-path>` mechanism (same
 * `resolveOptions({ kind: "local" })` call `app-router-plugin.ts`'s own
 * `pagesSourceRoot` constant already uses, for the same reason: this only
 * ever runs inside a local Vite dev process, so a local storage root always
 * resolves). Forward slashes only - `/@fs/` is a literal URL path, and a
 * Windows backslash would round-trip as `%5C` instead of a path separator.
 * Production pages compile and inline the current stylesheet, so their href
 * is deliberately empty.
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
  return "";
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

/** See `src/apps/vei-live-refresh.ts`'s doc comment. */
export function resolveVeiLiveRefreshHref(
  dev: boolean,
  manifestPath: string = join(process.cwd(), "dist/client/.vite/manifest.json"),
): string {
  return resolveBuiltAssetHref(dev, "src/apps/vei-live-refresh.ts", manifestPath);
}
