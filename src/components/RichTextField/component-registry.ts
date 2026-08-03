const { path: basePath } = window.__DRY_CONFIG__;
import type { DryComponentRecord } from "./component-registry-types.js";

/** Shared registry request for toolbar pickers and the editor runtime. Kept
 * independent from the ProseMirror hook so rendering the toolbar does not
 * pull the editor engine into its initial chunk. */
let richtextComponentsPromise: Promise<DryComponentRecord[]> | null = null;

/**
 * The admin page can change the registry while the SPA stays alive. Clear the
 * shared request so the next editor/picker mount observes that change instead
 * of reusing the list that was loaded before the toggle.
 */
export function invalidateRichtextComponents(): void {
  richtextComponentsPromise = null;
}

export function loadRichtextComponents(): Promise<DryComponentRecord[]> {
  if (richtextComponentsPromise) return richtextComponentsPromise;

  richtextComponentsPromise = fetch(`${basePath}/api/richtext-components`)
    .then((res) => {
      if (!res.ok) throw new Error(`Unable to load richtext components (${res.status})`);
      return res.json();
    })
    .then((data) => (Array.isArray(data.records) ? (data.records as DryComponentRecord[]) : []))
    .catch(() => {
      // Do not permanently cache an unauthenticated/temporary failure. The
      // editor can mount before the session cookie is ready, and a later
      // toolbar open should be allowed to retry the registry request.
      richtextComponentsPromise = null;
      return [];
    });
  return richtextComponentsPromise;
}
