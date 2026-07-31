import { signal } from "@preact/signals";

/**
 * Bumped whenever a content type is created/updated/deleted (see
 * `ContentTypeEditor.tsx`'s `submit`/`handleDelete`) - the one signal shared
 * between that editor and the sidebar's "Content" submenu in
 * `DryLayout.tsx`. The sidebar can't rely on remounting to pick up the
 * change the way a route component does (it deliberately lives outside
 * `<Router>` so it survives navigation - see `App.tsx`), so it watches this
 * signal and calls its own `useFetch()`'s `reload()` when it changes.
 */
export const contentTypesVersion = signal(0);

export function bumpContentTypesVersion(): void {
  contentTypesVersion.value += 1;
}
