import { fieldTypes } from "../field-registry.js";
import { encryptSecret } from "../../lib/secret-crypto.js";
import { hashPassword } from "../../lib/password-hash.js";
import { SYSTEM_FIELD_IDS } from "../system-fields.js";
import type { EntryFieldNode } from "./entry-tree.js";
import { isMaskedValue, type MaskedValue } from "./entry-validate.js";

export type EntryValue = Record<string, unknown>;

// `MaskedValue`/`validateEntryValue` now live in `./entry-validate.js`, which
// is deliberately free of this file's server-only deps (`secret-crypto.js`/
// `password-hash.js` -> `integration/options.js`'s `process.env` read) so the
// client can import validation directly for the `ComponentField` item
// dialog's own Save button - re-exported here so this module stays the one
// entry-CRUD engine adapters (`entries-sqlite.ts`/`entries-d1.ts`) import.
export type { FieldErrors } from "./entry-validate.js";
export { validateEntryValue } from "./entry-validate.js";
export type { MaskedValue };

/** `password`/`secretkey` columns never round-trip their real value to the
 * client (see `entry-tree.ts`'s doc comments) - `rowToValue` represents them
 * with a `MaskedValue` marker instead of the underlying hash/ciphertext, so
 * the UI can show "a value is already set" without ever receiving it. Typing
 * a *new* value replaces this marker with a plain string in the client's
 * local form state; leaving it untouched on an update means "keep the
 * current value". */
const MASKED_FIELD_TYPES = new Set(["password", "secretkey"]);

/** Converts one root (or child-table) row into the nested value shape the UI
 * works with - column nodes are deserialized (or masked, for `password`/
 * `secretkey`), `flatten` nodes recurse into a nested object, and a
 * `manyToOne` relation's `target_id` column comes through as a plain number
 * (hashing into a UI-facing id string happens only at the HTTP boundary).
 * Doesn't touch `oneToMany`/`manyToMany` relation or `component-repeat`
 * fields - those need separate child-table queries, which only the adapter
 * (with a live DB handle) can run. */
export function rowToValue(nodes: EntryFieldNode[], row: Record<string, unknown>): EntryValue {
  const value: EntryValue = {};
  for (const node of nodes) {
    if (node.kind === "flatten") {
      value[node.fieldName] = rowToValue(node.children, row);
      continue;
    }
    if (node.kind === "relation") {
      if (node.columnName) {
        const raw = row[node.columnName];
        value[node.fieldName] = raw === null || raw === undefined ? null : Number(raw);
      }
      continue; // oneToMany/manyToMany: filled in by the adapter from the child table.
    }
    if (node.kind !== "column") continue; // component-repeat: filled in by the adapter.

    const raw = row[node.columnName];
    if (MASKED_FIELD_TYPES.has(node.fieldType)) {
      value[node.fieldName] = { hasExisting: raw !== null && raw !== undefined && raw !== "" } satisfies MaskedValue;
      continue;
    }
    if (raw === null || raw === undefined) {
      value[node.fieldName] = null;
      continue;
    }
    const deserialize = fieldTypes[node.fieldType]?.deserialize;
    value[node.fieldName] = deserialize ? deserialize(raw) : raw;
  }
  return value;
}

/** Inverse of `rowToValue`, for the columns a create/update statement should
 * set on this row - `flatten` fields recurse and their columns are merged in
 * at the same level (they physically live on the same table). A
 * `password`/`secretkey` column is only included when the incoming value is
 * a non-empty *string* (a newly staged value to hash/encrypt); anything else
 * (the untouched `MaskedValue` marker, or an empty string) is omitted
 * entirely so an UPDATE leaves the existing hash/ciphertext alone. */
export async function valueToRow(nodes: EntryFieldNode[], value: EntryValue): Promise<Record<string, unknown>> {
  const row: Record<string, unknown> = {};
  for (const node of nodes) {
    if (node.kind === "flatten") {
      const nested = (value[node.fieldName] as EntryValue | undefined) ?? {};
      Object.assign(row, await valueToRow(node.children, nested));
      continue;
    }
    if (node.kind === "relation") {
      if (node.columnName) {
        const incoming = value[node.fieldName];
        row[node.columnName] = typeof incoming === "number" ? incoming : null;
      }
      continue; // oneToMany/manyToMany: written separately by the adapter as child-table rows.
    }
    if (node.kind !== "column") continue;

    const incoming = value[node.fieldName];
    if (node.fieldType === "password") {
      const newPlain = isMaskedValue(incoming) ? incoming.new : undefined;
      if (typeof newPlain === "string" && newPlain.length > 0) row[node.columnName] = await hashPassword(newPlain);
      continue;
    }
    if (node.fieldType === "secretkey") {
      if (typeof incoming === "string" && incoming.length > 0) row[node.columnName] = await encryptSecret(incoming);
      continue;
    }

    if (incoming === null || incoming === undefined || incoming === "") {
      row[node.columnName] = node.default ?? null;
      continue;
    }
    const serialize = fieldTypes[node.fieldType]?.serialize;
    row[node.columnName] = serialize ? serialize(incoming) : incoming;
  }
  return row;
}

/**
 * Server-enforced `features.timestamps` columns (see `system-fields.ts`) -
 * neither the client's `ScalarField`/`DatePickerField` nor `valueToRow` above
 * auto-populates these, since there's nothing date-specific in the generic
 * write path that knows "this particular date column means *now*, not
 * whatever the form happens to hold." On create, both `createdAt` and
 * `updatedAt` are stamped to the current time; on update, only `updatedAt`
 * is - and `createdAt` is deleted from the row entirely (not just left
 * alone) so the `UPDATE ... SET` statement never touches it, immune to
 * whatever a client happens to submit for it. Matched by `fieldId` against
 * `SYSTEM_FIELD_IDS`, not by `fieldName` - see `EntryColumnNode.fieldId`'s
 * doc comment for why a name match alone isn't safe here.
 */
export function applyTimestamps(
  nodes: EntryFieldNode[],
  row: Record<string, unknown>,
  mode: "create" | "update",
): Record<string, unknown> {
  const out = { ...row };
  const nowIso = new Date().toISOString();
  for (const node of nodes) {
    if (node.kind === "flatten") {
      Object.assign(out, applyTimestamps(node.children, out, mode));
      continue;
    }
    if (node.kind !== "column") continue;
    if (node.fieldId === SYSTEM_FIELD_IDS.updatedAt) {
      out[node.columnName] = nowIso;
    } else if (node.fieldId === SYSTEM_FIELD_IDS.createdAt) {
      if (mode === "create") out[node.columnName] = nowIso;
      else delete out[node.columnName];
    }
  }
  return out;
}
