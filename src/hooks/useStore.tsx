import { useCallback, useState } from "preact/hooks";
import type { Dispatch, StateUpdater } from "preact/hooks";

export const STORAGE_KEY = "drycms:store";

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

/** Reads the `key` entry of the shared `drycms:store` object, or `undefined` if
 * it isn't set yet. For state that isn't owned by a single component (and so
 * can't use the `useStore` hook below) - e.g. a `@preact/signals` signal
 * shared across components, like `collapsed` in `store/dashboard.ts`. */
export function readStoreValue<T>(key: string): T | undefined {
  return readAll()[key] as T | undefined;
}

/** Writes `value` into the `key` entry of the shared `drycms:store` object. See
 * `readStoreValue`. */
export function writeStoreValue<T>(key: string, value: T): void {
  writeAll({ ...readAll(), [key]: value });
}

/** Same signature/behavior as `useState`, but backed by the `key` entry of
 * a single `drycms:store` object in `localStorage` instead of in-memory state.
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
    const existing = readStoreValue<T>(key);
    if (existing !== undefined) return existing;
    const initial =
      initialValue instanceof Function ? initialValue() : initialValue;
    if (initial !== undefined) writeStoreValue(key, initial);
    return initial;
  });

  const setStoredValue = useCallback(
    (next: T | undefined | ((prev: T | undefined) => T | undefined)) => {
      setValue((prev) => {
        const resolved = next instanceof Function ? next(prev) : next;
        writeStoreValue(key, resolved);
        return resolved;
      });
    },
    [key],
  );

  return [value, setStoredValue] as const;
}
