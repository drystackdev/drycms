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
  minCount?: number;
  maxCount?: number;
  minLength?: number;
  maxLength?: number;
  description?: string;
}

/**
 * A confirmed component, as persisted to the `components` storage
 * root (mục 3) - `${name}.json`. `props`/`defaults` are already-resolved
 * plain data (see `DryComponent`), never the builder function.
 */
export interface DryComponentRecord {
  name: string;
  label: string;
  description: string;
  /** Whether importing this record should open the props dialog. */
  requiredInput: boolean;
  type: "inline" | "block";
  shadow: boolean;
  children: boolean;
  /** Default light-DOM HTML for `children: true` components - preview-only,
   * see `DryComponentConfig.children`'s own doc comment. */
  childrenDefaultHtml?: string;
  /** Names of nested components referenced by this component. The actual
   * component functions stay in the built module; this is the JSON-safe index
   * used by the registry and tooling. */
  refs?: string[];
  /** JSON-safe records for referenced components that are not confirmed as
   * top-level toolbar components. Used to extend the editor schema without
   * exposing those children in the global insert picker. */
  refRecords?: DryComponentRecord[];
  props: Record<string, PlainFieldDef>;
  defaults: Record<string, unknown>;
  /** The glob key (`import.meta.glob`'s map key) this record was confirmed
   * from - shown in the admin UI, not otherwise load-bearing. */
  sourcePath: string;
  enabled: true;
}

/** Flattens nested refs for ProseMirror's schema and node-view maps while
 * keeping the original top-level list intact for the toolbar picker. */
export function flattenDryComponentRecords(records: DryComponentRecord[]): DryComponentRecord[] {
  const result: DryComponentRecord[] = [];
  const seen = new Set<string>();
  const visit = (record: DryComponentRecord, nested: boolean) => {
    if (seen.has(record.name)) return;
    seen.add(record.name);
    // Records written before `requiredInput` existed have no value. Preserve
    // the top-level default (`true`) while applying the child-ref default
    // (`false`) when flattening the nested metadata used by the ref picker.
    const normalized = nested && record.requiredInput === undefined
      ? { ...record, requiredInput: false }
      : record;
    result.push(normalized);
    for (const child of normalized.refRecords ?? []) visit(child, true);
  };
  for (const record of records) visit(record, false);
  return result;
}
