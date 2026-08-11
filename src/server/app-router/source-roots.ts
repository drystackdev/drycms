/**
 * The top-level folders `pagesSourceStorage` is split into (`plans/
 * component.md` mục 1). Before this, route files lived flat at the storage
 * root; now every file belongs to exactly one root folder, and adding a new
 * kind of source (a future `layout-block/`, `email/`, ...) means adding one
 * entry here rather than teaching each consumer a new special case.
 *
 * Consumed by route discovery (`route-tree.ts`/`route-manifest.ts` only ever
 * look inside `pages`), the browser build's import resolver
 * (`page-build.ts`), the editor's TS worker, `vite.config.ts`'s alias, and
 * `scripts/sync-pages-r2.ts`'s storage <-> git mapping - so it must stay
 * dependency-free (imported from a Vite config, a web worker, the server and
 * the client alike).
 */

export interface PagesSourceRoot {
  /** Folder name at the storage root - also the `src/apps/<id>` directory
   * `sync-pages-r2.ts` materializes it into for a build. */
  id: string;
  /** Tab label in the Page Editor sidebar. */
  label: string;
  /** Import alias page code can use to reach this root (`@component/Card` ->
   * `component/Card.tsx`). `undefined` = not importable by alias; `pages`
   * deliberately has none (a route file is never imported by another file). */
  alias?: string;
}

/** Route files (`page.tsx`/`layout.tsx`/`404.tsx`/`500.tsx`). */
export const PAGES_ROOT = "pages";

/** Reusable `.tsx` components, imported by pages through `@component/...`. */
export const COMPONENT_ROOT = "component";

export const COMPONENT_ALIAS = "@component";

/** The site's shared Tailwind entry (`globals.css`) plus its split-out
 * `.css` files (`theme.css`, `base.css`, ...) - live-edited from the Page
 * Editor's "Styles" tab exactly like `pages/`/`component/`. No `alias`: page
 * code never `import`s these by specifier, they're a fixed build entry
 * (`vite.config.ts`'s `appsGlobals`). */
export const STYLES_ROOT = "styles";

export const PAGES_SOURCE_ROOTS: readonly PagesSourceRoot[] = [
  { id: PAGES_ROOT, label: "Page" },
  { id: COMPONENT_ROOT, label: "Component", alias: COMPONENT_ALIAS },
  { id: STYLES_ROOT, label: "Styles" },
];

/** The root folder `path` belongs to, or `null` for a file sitting directly
 * at the storage root (only possible for a store predating this split - see
 * `plans/component.md`'s migration note). */
export function rootOf(path: string): PagesSourceRoot | null {
  const first = path.split("/")[0];
  return PAGES_SOURCE_ROOTS.find((root) => root.id === first) ?? null;
}

/** `styles/` filenames every project ships with and that back a hardcoded
 * dependency elsewhere - `globals.css` is `vite.config.ts`'s literal
 * Tailwind build entry, and it `@import`s the other two by exact relative
 * name. Deleting any of them silently breaks the build rather than failing
 * loudly, so both the Page Editor's tree UI and this route's own `DELETE`
 * refuse to remove them (`PageEditor.tsx` also recreates one from its
 * default content if it's ever found missing). */
export const CORE_STYLE_FILE_NAMES = ["globals.css", "theme.css", "base.css"] as const;

export function isCoreStyleFilePath(path: string): boolean {
  const prefix = `${STYLES_ROOT}/`;
  return path.startsWith(prefix) && (CORE_STYLE_FILE_NAMES as readonly string[]).includes(path.slice(prefix.length));
}

/** `"@component/Card"` -> `"component/Card"`; `null` for anything that isn't
 * an alias specifier. Extension resolution is the caller's job (each
 * consumer has its own file map to probe - see `page-build.ts`'s
 * `resolveModulePath` and `ts-worker.ts`'s `resolveModuleName`). */
export function resolveAliasSpecifier(specifier: string): string | null {
  for (const root of PAGES_SOURCE_ROOTS) {
    if (!root.alias) continue;
    if (specifier === root.alias) return root.id;
    if (specifier.startsWith(`${root.alias}/`)) return `${root.id}/${specifier.slice(root.alias.length + 1)}`;
  }
  return null;
}

/** True for any specifier this module can rewrite - used by the import
 * scanners that need to know a specifier is LOCAL (resolvable inside the
 * source tree) before following it. */
export function isAliasSpecifier(specifier: string): boolean {
  return resolveAliasSpecifier(specifier) !== null;
}
