import { useEffect } from "preact/hooks";
import type { JSX } from "preact/jsx-runtime";
import { useDebounce } from "../hooks/useDebounce.js";

export interface SearchProps {
  value: string;
  /** Fires on every keystroke - bind this to local state so the input and
   * any purely client-side filtering stay in sync immediately. */
  onChange: (value: string) => void;
  /** Fires `debounceMs` after typing settles, with the same value `onChange`
   * last received. Wire this to whatever's expensive (a server request) -
   * leave it unset for purely client-side filtering, which doesn't need it. */
  onDebouncedChange?: (value: string) => void;
  /** @default 300 */
  debounceMs?: number;
  /** @default "Search…" */
  placeholder?: string;
  ariaLabel?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  class?: string;
  style?: JSX.CSSProperties;
}

/** A search input with a leading icon (`input[type="search"]`'s own
 * light/dark-aware CSS glyph, see `forms.css`) and built-in debouncing via
 * `useDebounce` - the shared replacement for every hand-rolled
 * `setTimeout`/`useRef` search box in the app (`DataTable`, `IconSearchAdd`,
 * `FileManager`'s toolbar). */
export default function Search({
  value,
  onChange,
  onDebouncedChange,
  debounceMs = 300,
  placeholder = "Search…",
  ariaLabel,
  disabled = false,
  autoFocus = false,
  class: className,
  style,
}: SearchProps) {
  const debounced = useDebounce(value, debounceMs);

  useEffect(() => {
    onDebouncedChange?.(debounced);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `onDebouncedChange` identity intentionally ignored; only the debounced value should retrigger.
  }, [debounced]);

  return (
    <input
      type="search"
      class={className}
      style={style}
      value={value}
      placeholder={placeholder}
      aria-label={ariaLabel ?? placeholder}
      disabled={disabled}
      autoFocus={autoFocus}
      onInput={(event) =>
        onChange((event.target as HTMLInputElement).value)
      }
    />
  );
}
