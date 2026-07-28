import type { FieldValidation } from "../types.js";
import type { EntryColumnNode, EntryFieldNode } from "./entry-tree.js";

export type FieldErrors = Record<string, string>;

/** Mirrors `entry-codec.ts`'s `MaskedValue` marker (a `password`/`secretkey`
 * field's untouched "keep the current value" placeholder) - duplicated here
 * rather than imported so this module stays free of `entry-codec.ts`'s
 * server-only deps (`lib/password-hash.js` -> `lib/secret-crypto.js` ->
 * `integration/options.js`'s `process.env` read), which would otherwise break
 * a client bundle importing `validateEntryValue` for live in-dialog checks. */
export interface MaskedValue {
  hasExisting: boolean;
}

function isMaskedValue(value: unknown): value is MaskedValue {
  return typeof value === "object" && value !== null && "hasExisting" in (value as Record<string, unknown>);
}

function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return true;
  if (isMaskedValue(value)) return !value.hasExisting;
  return false;
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
  if (validation.required && isEmptyValue(value)) {
    errors[path] = `${node.label} is required.`;
    return;
  }
  if (isEmptyValue(value)) return;

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
      const items = Array.isArray(value[node.fieldName]) ? (value[node.fieldName] as Record<string, unknown>[]) : [];
      items.forEach((item, index) => {
        Object.assign(errors, validateEntryValue(node.itemFields, item, `${path}[${index}]`));
      });
    }
    // `relation` has no `FieldValidation` of its own to check either way
    // (`field-registry.ts` declares `validationFields: []`) - existence of
    // the referenced target row(s) isn't verified here, same as every other
    // generated table's lack of real `FOREIGN KEY` constraints.
  }
  return errors;
}
