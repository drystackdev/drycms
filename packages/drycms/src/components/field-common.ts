/** Shared controlled-field contract for the FIELD INPUT showcase group. */
export interface FieldProps<V> {
  value: V;
  onChange: (value: V) => void;
  label: string;
  helperText?: string;
  error?: boolean;
}
