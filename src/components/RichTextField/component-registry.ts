import { path as basePath } from "virtual:drycms/config";
import type { DryComponentRecord } from "./component-registry-types.js";

/** Shared registry request for toolbar pickers and the editor runtime. Kept
 * independent from the ProseMirror hook so rendering the toolbar does not
 * pull the editor engine into its initial chunk. */
let richtextComponentsPromise: Promise<DryComponentRecord[]> | null = null;

export function loadRichtextComponents(): Promise<DryComponentRecord[]> {
  richtextComponentsPromise ??= fetch(`${basePath}/api/richtext-components`)
    .then((res) => (res.ok ? res.json() : { records: [] }))
    .then((data) => (Array.isArray(data.records) ? (data.records as DryComponentRecord[]) : []))
    .catch(() => []);
  return richtextComponentsPromise;
}
