import type { FieldKind } from "./register-component.js";

/**
 * JSON-safe mirror of `FieldDef` (`register-component.ts`) - what actually
 * survives `JSON.stringify`/`JSON.parse` once a component's `schema` is
 * persisted to storage (mục 3, `status/register-compoennt.md`). `FieldDef`'s
 * `required`/`default` chain *methods* drop out for free (`JSON.stringify`
 * skips function-valued properties) - this type just names the shape of
 * what's left, so route/admin/dialog code isn't typed against `unknown`.
 */
export interface PlainFieldDef {
  kind: FieldKind;
  req: boolean;
  defaultValue?: unknown;
  inner?: PlainFieldDef;
  shape?: Record<string, PlainFieldDef>;
}

/**
 * A confirmed richtext component, as persisted to the `richtext` storage
 * root (mục 3) - `${name}.json`. `props`/`defaults` are already-resolved
 * plain data (see `DryEditerComponent`), never the builder function.
 */
export interface DryComponentRecord {
  name: string;
  label: string;
  description: string;
  type: "inline" | "block";
  shadow: boolean;
  children: boolean;
  props: Record<string, PlainFieldDef>;
  defaults: Record<string, unknown>;
  /** The glob key (`import.meta.glob`'s map key) this record was confirmed
   * from - shown in the admin UI, not otherwise load-bearing. */
  sourcePath: string;
  enabled: true;
}
