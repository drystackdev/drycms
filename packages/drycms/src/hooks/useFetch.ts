import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { getCacheEntry, setCacheEntry } from "../lib/idb-cache.js";
import { beginSync, endSync, flashSyncSuccess } from "../store/sync.js";

/** Same envelope shape `entries-http-api.ts`'s `listVersioned`/`getVersioned`/
 * `getSingletonVersioned` return - `useFetch()` is deliberately written
 * against this shape rather than those specific functions, so any fetcher
 * (schema API, a future resource) can plug in as long as it speaks the
 * data-version protocol (see `status/build-cache.md`). */
export interface VersionedFetchResult<T> {
  changed: boolean;
  version: number;
  data?: T;
}

export type Fetcher<T> = (ifVersion: number | undefined, signal: AbortSignal) => Promise<VersionedFetchResult<T>>;

export interface UseFetchOptions {
  /** Delay before the debounced background/network fetch actually fires -
   * only the LAST of several rapid `key` changes (e.g. clicking through
   * pages) results in a real request; every one still renders instantly from
   * IndexedDB. `0` disables debouncing. Defaults to 150ms. */
  debounceMs?: number;
  /** Whether a background sync or `reload()` finding changed data flashes the
   * header's sync-success indicator (see `store/sync.ts`'s `flashSyncSuccess`)
   * - `false` disables it for this `useFetch()` call. @default true */
  notify?: boolean;
}

export interface UseFetchResult<T> {
  data: T | undefined;
  loading: boolean;
  refreshing: boolean;
  error: unknown;
  reload: () => Promise<void>;
}

const DEFAULT_DEBOUNCE_MS = 150;

interface State<T> {
  data: T | undefined;
  loading: boolean;
  refreshing: boolean;
  error: unknown;
}

/**
 * IndexedDB-cache-first data hook (see `status/build-cache.md`) - `key` must
 * uniquely identify the request (same convention as an HTTP cache key: two
 * different queries against the same resource need two different keys, see
 * the plan doc's mục 24). On every `key` change:
 *
 * 1. Reads IndexedDB for `key` - if present, renders it INSTANTLY
 *    (`loading: false`, `refreshing: true`), no debounce.
 * 2. After `debounceMs` (reset on every further `key` change), calls
 *    `fetcher` with the cached version (or `undefined` if there was no
 *    cache) - the server decides whether anything actually changed.
 * 3. `changed: false` → nothing to do (cache/UI already correct).
 *    `changed: true` → writes IndexedDB, updates the rendered `data`, and
 *    (only if there WAS a prior cache - a cold first load isn't "new data
 *    available") flashes the header's sync-success indicator.
 *
 * A response only ever applies if it's still the most recent request for the
 * current `key` - guards against page-1's request resolving after page-3's
 * (`AbortController` cancels the in-flight fetch too, best-effort on top).
 */
export function useFetch<T>(key: string, fetcher: Fetcher<T>, options: UseFetchOptions = {}): UseFetchResult<T> {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const notify = options.notify ?? true;

  const [state, setState] = useState<State<T>>({ data: undefined, loading: true, refreshing: false, error: undefined });

  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const keyRef = useRef(key);
  keyRef.current = key;

  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const versionRef = useRef<number | undefined>(undefined);

  const runFetch = useCallback(
    async (requestId: number, ifVersion: number | undefined, notifyOnChange: boolean) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      beginSync();
      try {
        const result = await fetcherRef.current(ifVersion, controller.signal);
        if (requestId !== requestIdRef.current) return; // superseded by a newer `key`/`reload()`
        versionRef.current = result.version;
        if (result.changed) {
          await setCacheEntry(keyRef.current, result.data, result.version);
          setState({ data: result.data, loading: false, refreshing: false, error: undefined });
          if (notifyOnChange && notify) flashSyncSuccess();
        } else {
          setState((current) => ({ ...current, loading: false, refreshing: false }));
        }
      } catch (error) {
        if (requestId !== requestIdRef.current) return;
        if (error instanceof DOMException && error.name === "AbortError") return;
        setState((current) => ({ ...current, loading: false, refreshing: false, error }));
      } finally {
        endSync();
      }
    },
    [notify],
  );

  useEffect(() => {
    let cancelled = false;
    const requestId = ++requestIdRef.current;
    versionRef.current = undefined;

    getCacheEntry<T>(key).then((cached) => {
      if (cancelled || requestId !== requestIdRef.current) return;

      const hadCache = cached !== undefined;
      if (cached) {
        versionRef.current = cached.version;
        setState({ data: cached.data, loading: false, refreshing: true, error: undefined });
      } else {
        setState({ data: undefined, loading: true, refreshing: false, error: undefined });
      }

      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        void runFetch(requestId, cached?.version, hadCache);
      }, debounceMs);
    });

    return () => {
      cancelled = true;
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      abortRef.current?.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `runFetch`/`debounceMs` intentionally excluded: re-running this effect on every fetcher-identity change would defeat the whole "only `key` triggers a re-fetch" contract.
  }, [key]);

  const reload = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    await runFetch(requestId, versionRef.current, true);
  }, [runFetch]);

  return { data: state.data, loading: state.loading, refreshing: state.refreshing, error: state.error, reload };
}
