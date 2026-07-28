import { useEffect, useState } from "preact/hooks";

/** Returns `value`, delayed by `delayMs` after it last changed - the timer
 * resets on every change, so only a value that stays put for the full delay
 * is ever returned. Used to debounce search-as-you-type input before firing
 * an expensive (usually server) query; see `Search`. */
export function useDebounce<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);

  return debounced;
}
