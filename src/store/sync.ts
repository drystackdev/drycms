import { computed, signal } from "@preact/signals";

/**
 * Global "at least one `useFetch()` background sync is in flight" signal (see
 * `status/build-cache.md`, mục 16-17) - a plain boolean can't work since
 * several `useFetch()` calls can be syncing concurrently across different
 * parts of the page; a count that only reaches 0 when every one of them has
 * finished can.
 */
export const refreshingCount = signal(0);

export const globalRefreshing = computed(() => refreshingCount.value > 0);

export function beginSync(): void {
  refreshingCount.value += 1;
}

export function endSync(): void {
  refreshingCount.value = Math.max(0, refreshingCount.value - 1);
}

/** "A `useFetch()` background sync just found new data" flash, shown in the
 * header next to the syncing spinner (see `SyncIndicator.tsx`) for a few
 * seconds instead of a toast - `flashSyncSuccess()` re-arms the same timer on
 * every call, so several syncs finishing close together just extend the one
 * visible flash rather than stacking. */
export const syncSuccess = signal(false);

let successTimer: ReturnType<typeof setTimeout> | undefined;
const SYNC_SUCCESS_DURATION_MS = 3000;

export function flashSyncSuccess(): void {
  syncSuccess.value = true;
  clearTimeout(successTimer);
  successTimer = setTimeout(() => {
    syncSuccess.value = false;
  }, SYNC_SUCCESS_DURATION_MS);
}

export interface PublishStatus {
  message: string;
  loading: boolean;
}

/** Background page-publish progress shares the topbar's transient status
 * area with cache sync instead of creating a second, unrelated toast stack. */
export const publishStatus = signal<PublishStatus | null>(null);

let publishTimer: ReturnType<typeof setTimeout> | undefined;
const PUBLISH_STATUS_DURATION_MS = 3000;

export function showPublishStatus(message: string, loading: boolean): void {
  clearTimeout(publishTimer);
  publishStatus.value = { message, loading };
  if (!loading) {
    publishTimer = setTimeout(() => {
      publishStatus.value = null;
    }, PUBLISH_STATUS_DURATION_MS);
  }
}
