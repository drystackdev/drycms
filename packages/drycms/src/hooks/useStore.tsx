import { useCallback, useState } from "preact/hooks";
import type { Dispatch, StateUpdater } from "preact/hooks";

const STORAGE_KEY = "__store";

function readAll(): Record<string, unknown> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeAll(store: Record<string, unknown>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Private mode / storage disabled - state still works for this session.
  }
}

/** Same signature/behavior as `useState`, but backed by the `key` entry of
 * a single `__store` object in `localStorage` instead of in-memory state.
 * If `key` isn't present yet, `initialValue` seeds it (and is persisted). */
export function useStore<T>(
  key: string,
  initialValue: T | (() => T),
): [T, Dispatch<StateUpdater<T>>];
export function useStore<T = undefined>(
  key: string,
): [T | undefined, Dispatch<StateUpdater<T | undefined>>];
export function useStore<T>(key: string, initialValue?: T | (() => T)) {
  const [value, setValue] = useState<T | undefined>(() => {
    const store = readAll();
    if (key in store) return store[key] as T;
    const initial =
      initialValue instanceof Function ? initialValue() : initialValue;
    if (initial !== undefined) writeAll({ ...readAll(), [key]: initial });
    return initial;
  });

  const setStoredValue = useCallback(
    (next: T | undefined | ((prev: T | undefined) => T | undefined)) => {
      setValue((prev) => {
        const resolved = next instanceof Function ? next(prev) : next;
        writeAll({ ...readAll(), [key]: resolved });
        return resolved;
      });
    },
    [key],
  );

  return [value, setStoredValue] as const;
}
