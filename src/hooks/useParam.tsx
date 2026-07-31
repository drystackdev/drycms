import { useCallback } from "preact/hooks";
import type { Dispatch, StateUpdater } from "preact/hooks";
import { useLocation } from "preact-iso";

/** Same usage as `useStore`, but backed by the `key` entry of the current
 * URL's search query instead of `localStorage`. Values are plain strings
 * (query strings can't hold anything richer) so the URL stays readable and
 * shareable. If `key` isn't present in the query yet, `initialValue` is
 * returned but not written to the URL until `setValue` is called.
 *
 * Updates replace the current history entry rather than pushing a new one,
 * so e.g. switching tabs doesn't flood the back button with entries.
 * Setting the value to `undefined` removes the key from the query string. */
export function useParam<T extends string = string>(
  key: string,
  initialValue: T,
): [T, Dispatch<StateUpdater<T>>];
export function useParam<T extends string = string>(
  key: string,
): [T | undefined, Dispatch<StateUpdater<T | undefined>>];
export function useParam<T extends string>(key: string, initialValue?: T) {
  const { path, query, route } = useLocation();

  const value = (query[key] ?? initialValue) as T | undefined;

  const setValue = useCallback(
    (next: T | undefined | ((prev: T | undefined) => T | undefined)) => {
      const resolved =
        next instanceof Function
          ? next((query[key] ?? initialValue) as T | undefined)
          : next;
      const params = new URLSearchParams(query);
      if (resolved === undefined) params.delete(key);
      else params.set(key, resolved);
      const search = params.toString();
      route(search ? `${path}?${search}` : path, true);
    },
    [key, path, query, route, initialValue],
  );

  return [value, setValue] as const;
}
