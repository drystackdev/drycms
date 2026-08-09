import type { Ref, RefCallback } from "preact";

/**
 * Combines multiple refs (object or callback - Preact's `ref` prop accepts
 * either) onto a single element. Needed wherever 2 independent hooks each
 * want their own ref on the SAME node - e.g. the page/component preview
 * viewport, where `useScaledPreview`'s `ResizeObserver`-tracking callback
 * ref and `useOverlayScrollbars`'s host ref both need to observe/manage the
 * exact same element.
 */
export function mergeRefs<T>(...refs: Array<Ref<T> | undefined>): RefCallback<T> {
  return (node: T | null) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(node);
      else if (ref) ref.current = node;
    }
  };
}
