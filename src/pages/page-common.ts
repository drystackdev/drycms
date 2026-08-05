import type { ComponentChildren } from "preact";
import { useEffect } from "preact/hooks";
import { pageHeaderActions } from "../store/page-header.js";

/** Sets `document.title` for as long as the calling page is mounted -
 * shared by every page instead of each rolling its own `useEffect`. */
export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title;
  }, [title]);
}

/**
 * Hands `children` to `DryLayout`'s topbar (`pageHeaderActions`) for as long
 * as the calling page is mounted, and clears it on unmount so the next page
 * doesn't inherit stale actions. No dependency array on the sync effect -
 * `children` is a fresh vnode tree every render (a Save button's `disabled`/
 * `aria-busy` has to reach the topbar the same render it changes), so this
 * intentionally re-syncs every time rather than trying to memoize a vnode.
 */
export function usePageHeaderActions(children: ComponentChildren | null): void {
  useEffect(() => {
    pageHeaderActions.value = children;
  });
  useEffect(() => () => {
    pageHeaderActions.value = null;
  }, []);
}
