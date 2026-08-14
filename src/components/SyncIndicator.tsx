import { CheckCircleIcon } from "./icons/index.js";
import { globalRefreshing, publishStatus, syncSuccess } from "../store/sync.js";

/**
 * Small topbar indicator for `useFetch()`'s background sync (see
 * `status/build-cache.md`, mục 17) - purely informational, never the page's
 * own `loading` state (that's each `useFetch()` call's own `loading`/
 * `refreshing`, rendered by the page itself). Renders nothing while idle.
 *
 * Two states, never shown together (a sync finishing flips `globalRefreshing`
 * off and `syncSuccess` on in the same tick - see `store/sync.ts`):
 * spinner while a sync is in flight, then a success flash for a few seconds
 * once one finds new data. No toast for this anymore.
 */
export default function SyncIndicator() {
  if (publishStatus.value) {
    return (
      <span class="row" style={{ gap: "0.5rem" }} aria-live="polite">
        {publishStatus.value.loading
          ? <span class="spinner" aria-hidden="true" />
          : <CheckCircleIcon style={{ color: "var(--dry-primary)" }} />}
        <small class="hint">{publishStatus.value.message}</small>
      </span>
    );
  }
  if (globalRefreshing.value) {
    return (
      <span class="row" style={{ gap: "0.5rem" }}>
        <span class="spinner" aria-hidden="true" />
        <small class="hint">Syncing...</small>
      </span>
    );
  }
  if (syncSuccess.value) {
    return (
      <span class="row" style={{ gap: "0.5rem" }}>
        <CheckCircleIcon style={{ color: "var(--dry-primary)" }} />
        <small class="hint">Sync success</small>
      </span>
    );
  }
  return null;
}
