import type { JSX } from "preact/jsx-runtime";

/** Shared controlled-field contract for the FIELD INPUT showcase group. */
export interface FieldProps<V> {
  value: V;
  onChange: (value: V) => void;
  label: string;
  helperText?: string;
  error?: boolean;
  /** Extra class(es) for the outer `.field` wrapper, on top of the base class. */
  class?: string;
  /** Inline style for the outer `.field` wrapper. */
  style?: JSX.CSSProperties;
}
