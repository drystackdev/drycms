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
