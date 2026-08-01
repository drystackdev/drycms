import type { FieldValidation } from "../types.js";
import type { EntryColumnNode, EntryFieldNode } from "./entry-tree.js";

export type FieldErrors = Record<string, string>;

/** Mirrors `entry-codec.ts`'s `MaskedValue` marker (a `password`/`secretkey`
 * field's untouched "keep the current value" placeholder) - duplicated here
 * rather than imported so this module stays free of `entry-codec.ts`'s
 * server-only deps (`lib/password-hash.js` -> `lib/secret-crypto.js` ->
 * `server/options.js`'s `process.env` read), which would otherwise break
 * a client bundle importing `validateEntryValue` for live in-dialog checks. */
export interface MaskedValue {
  hasExisting: boolean;
  /** `password` only - staged new plaintext value; hashed server-side, never sent
   * anywhere else. Absent/empty means "keep the current value", same as `secretkey`'s
   * untouched-marker behavior. */
  new?: string;
  /** `password` only - client-side repeat-of-`new` for the confirm field. Never read
   * past `findPasswordChangeErrors`/the UI layer - `valueToRow` only ever reads `.new`. */
  confirm?: string;
}

export function isMaskedValue(value: unknown): value is MaskedValue {
  return typeof value === "object" && value !== null && "hasExisting" in (value as Record<string, unknown>);
}

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  if (isMaskedValue(value)) return !value.hasExisting && !value.new;
  return false;
}

function isEmptyRichText(value: unknown, inline: boolean): boolean {
  if (typeof value !== "string") return isEmptyValue(value);
  if (value.trim() === "") return true;
  return !inline && /^<p>(?:\s|&nbsp;|<br\s*\/?>(?:\s|&nbsp;)*)*<\/p>$/i.test(value.trim());
}

/** `confirm` never reaches the server (see `MaskedValue.confirm`'s doc comment) - a
 * mismatch can only ever be caught here, client-side. */
export function passwordConfirmError(value: MaskedValue): string | undefined {
  return value.new && value.new !== value.confirm ? "Passwords do not match." : undefined;
}

/** Pre-submit gate for `password` fields specifically (not a general client-side
 * validation pass - everything else still relies on the server's response, see
 * `ContentEntryEditor.tsx`'s `handleSave`). Same `column`/`flatten` recursion shape as
 * `validateEntryValue` below, dotted-path-keyed the same way. */
export function findPasswordChangeErrors(nodes: EntryFieldNode[], value: Record<string, unknown>, pathPrefix = ""): FieldErrors {
  const errors: FieldErrors = {};
  for (const node of nodes) {
    const path = pathPrefix ? `${pathPrefix}.${node.fieldName}` : node.fieldName;
    if (node.kind === "flatten") {
      Object.assign(errors, findPasswordChangeErrors(node.children, (value[node.fieldName] as Record<string, unknown>) ?? {}, path));
      continue;
    }
    if (node.kind !== "column" || node.fieldType !== "password") continue;
    const incoming = value[node.fieldName];
    if (!isMaskedValue(incoming)) continue;
    const issue = passwordConfirmError(incoming);
    if (issue) errors[path] = issue;
  }
  return errors;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function checkFormat(validation: FieldValidation, value: string): string | undefined {
  if (validation.regex) {
    try {
      if (!new RegExp(validation.regex).test(value)) return "Invalid format.";
    } catch {
      return undefined; // A malformed stored regex shouldn't fail every save - schema editor's problem, not entry data's.
    }
  }
  if (validation.format === "email" && !EMAIL_RE.test(value)) return "Must be a valid email address.";
  if (validation.format === "url") {
    try {
      new URL(value);
    } catch {
      return "Must be a valid URL.";
    }
  }
  if (validation.format === "slug" && !SLUG_RE.test(value)) return "Must be a lowercase, hyphen-separated slug.";
  return undefined;
}

function validateColumn(node: EntryColumnNode, value: unknown, path: string, errors: FieldErrors): void {
  const { validation } = node;
  const empty = node.fieldType === "richtext"
    ? isEmptyRichText(value, !!(node.fieldConfig as { inline?: boolean } | undefined)?.inline)
    : isEmptyValue(value);
  if (validation.required && empty) {
    errors[path] = `${node.label} is required.`;
    return;
  }
  if (empty) return;

  if (typeof value === "string") {
    if (validation.minLength !== undefined && value.length < validation.minLength) {
      errors[path] = `${node.label} must be at least ${validation.minLength} characters.`;
      return;
    }
    if (validation.maxLength !== undefined && value.length > validation.maxLength) {
      errors[path] = `${node.label} must be at most ${validation.maxLength} characters.`;
      return;
    }
    const formatError = checkFormat(validation, value);
    if (formatError) errors[path] = formatError;
    return;
  }

  if (typeof value === "number") {
    if (validation.min !== undefined && value < Number(validation.min)) {
      errors[path] = `${node.label} must be at least ${validation.min}.`;
    } else if (validation.max !== undefined && value > Number(validation.max)) {
      errors[path] = `${node.label} must be at most ${validation.max}.`;
    }
  }
}

/** Item-count check for multi-valued `relation` (non-`manyToOne`) and
 * `component-repeat` fields - `validation.min`/`max` mean "number of items"
 * there instead of the numeric-value bounds `validateColumn` above checks
 * (see `field-registry.ts`'s conditional `validationFields`, shown only once
 * the field is actually multi-valued). */
function validateItemCount(validation: FieldValidation, value: unknown, label: string, path: string, errors: FieldErrors): void {
  const count = Array.isArray(value) ? value.length : 0;
  if (validation.min !== undefined && count < Number(validation.min)) {
    errors[path] = `${label} must have at least ${validation.min} item${Number(validation.min) === 1 ? "" : "s"}.`;
  } else if (validation.max !== undefined && count > Number(validation.max)) {
    errors[path] = `${label} must have at most ${validation.max} item${Number(validation.max) === 1 ? "" : "s"}.`;
  }
}

/** Validates one root (or repeatable-component-item) value against its
 * fields' `FieldValidation` rules. `unique` isn't checked here - it's an SQL
 * unique index already, surfaced as a field error when the adapter's insert/
 * update statement throws a constraint violation. Relation fields have no
 * `FieldValidation` of their own (`field-registry.ts` declares
 * `validationFields: []` for `relation`), so nothing to check there. Returns
 * dotted paths for nested `flatten` fields (e.g. `"seo.metaTitle"`) and
 * bracketed paths for `component-repeat` items (e.g. `"blocks[0].title"`).
 *
 * Deliberately free of server-only imports (see `MaskedValue`'s doc comment
 * above) so both the entry-CRUD engine adapters (`entries-sqlite.ts`/
 * `entries-d1.ts`, via `entry-codec.ts`'s re-export) AND the client's
 * `ComponentField` item dialog (`FieldRenderer.tsx`'s
 * `ComponentRepeatFieldAdapter`) can run the exact same rules - the dialog's
 * own Save button blocks on the same errors the server would otherwise
 * reject the whole entry save for. */
export function validateEntryValue(nodes: EntryFieldNode[], value: Record<string, unknown>, pathPrefix = ""): FieldErrors {
  const errors: FieldErrors = {};
  for (const node of nodes) {
    const path = pathPrefix ? `${pathPrefix}.${node.fieldName}` : node.fieldName;
    if (node.kind === "column") {
      validateColumn(node, value[node.fieldName], path, errors);
    } else if (node.kind === "flatten") {
      Object.assign(errors, validateEntryValue(node.children, (value[node.fieldName] as Record<string, unknown>) ?? {}, path));
    } else if (node.kind === "component-repeat") {
      validateItemCount(node.validation, value[node.fieldName], node.label, path, errors);
      const items = Array.isArray(value[node.fieldName]) ? (value[node.fieldName] as Record<string, unknown>[]) : [];
      items.forEach((item, index) => {
        Object.assign(errors, validateEntryValue(node.itemFields, item, `${path}[${index}]`));
      });
    } else if (node.kind === "relation" && node.cardinality !== "manyToOne") {
      // `manyToOne` stores a single target (or none) - nothing to
      // count-limit, and `field-registry.ts` never surfaces min/max for it.
      validateItemCount(node.validation, value[node.fieldName], node.label, path, errors);
    }
    // Existence of the referenced target row(s) isn't verified here, same as
    // every other generated table's lack of real `FOREIGN KEY` constraints.
  }
  return errors;
}
