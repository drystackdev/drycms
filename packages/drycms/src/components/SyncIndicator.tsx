import { globalRefreshing } from "../store/sync.js";

/**
 * Small topbar indicator for `useFetch()`'s background sync (see
 * `status/build-cache.md`, mục 17) - purely informational, never the page's
 * own `loading` state (that's each `useFetch()` call's own `loading`/
 * `refreshing`, rendered by the page itself). Renders nothing while idle.
 */
export default function SyncIndicator() {
  if (!globalRefreshing.value) return null;
  return (
    <span class="row" style={{ gap: "0.5rem" }}>
      <span class="spinner" aria-hidden="true" />
      <small class="hint">Đang đồng bộ…</small>
    </span>
  );
}
