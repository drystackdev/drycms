import { randomUUID } from "../lib/uuid.js";
import { fieldTypes } from "./field-registry.js";
import { NamingError, validateContentTypeDefinition } from "./naming.js";
import type { ContentTypeDefinition, ContentTypeFeatures, FieldDefinition } from "./types.js";
import type { WizardProposedField, WizardProposedTable } from "./ai-wizard-protocol.js";

/** Only ever turns a feature ON, never off - the wizard can enable
 * something an existing table doesn't have yet, but never silently
 * disables a feature an admin already turned on for it. */
function mergeFeatures(existing: ContentTypeFeatures | undefined, proposed: WizardProposedTable["features"]): ContentTypeFeatures {
  const next = { ...(existing ?? {}) };
  for (const [key, value] of Object.entries(proposed ?? {})) {
    if (value === true) (next as Record<string, boolean>)[key] = true;
  }
  return next;
}

export interface WizardMapSuccess {
  ok: true;
  name: string;
  isNew: boolean;
  definition: ContentTypeDefinition;
}

export interface WizardMapFailure {
  ok: false;
  name: string;
  error: string;
}

export type WizardMapResult = WizardMapSuccess | WizardMapFailure;

function mapField(
  field: WizardProposedField,
  newIds: Map<string, string>,
  allTypes: ContentTypeDefinition[],
): FieldDefinition {
  const registryType = fieldTypes[field.type];
  let config: Record<string, unknown> = { ...(registryType?.defaultConfig ?? {}) };
  if (field.type === "select") {
    config = { options: field.options ?? [], multiple: false };
  } else if (field.type === "relation") {
    const targetKey = field.relationTarget?.trim().toLowerCase() ?? "";
    const target =
      newIds.get(targetKey) ??
      allTypes.find((type) => type.name.toLowerCase() === targetKey)?.id ??
      "";
    config = { target, cardinality: field.relationCardinality ?? "manyToOne" };
  }
  return {
    id: randomUUID(),
    name: field.name,
    label: field.label,
    description: field.description?.trim() || undefined,
    type: field.type,
    config,
    validation: { required: field.required === true },
    // Placeholder - `normalizeFieldOrder` (called by the dialog right before
    // `saveDraft`, same as `ContentTypeEditor.tsx`'s own save path) fixes
    // every field's real order from its position in `fields[]`.
    order: 0,
  };
}

function buildNewDefinition(
  table: WizardProposedTable,
  id: string,
  newIds: Map<string, string>,
  allTypes: ContentTypeDefinition[],
): ContentTypeDefinition {
  return {
    id,
    kind: table.kind,
    name: table.name,
    label: table.label,
    description: table.description?.trim() || undefined,
    features: mergeFeatures(undefined, table.features),
    fields: table.fields.map((field) => mapField(field, newIds, allTypes)),
    version: 0,
  };
}

function buildExtendedDefinition(
  table: WizardProposedTable,
  existing: ContentTypeDefinition,
  newIds: Map<string, string>,
  allTypes: ContentTypeDefinition[],
): ContentTypeDefinition {
  const activeNames = new Set(
    existing.fields
      .filter((field) => !(existing.deletedFieldIds ?? []).includes(field.id))
      .map((field) => field.name.toLowerCase()),
  );
  const newFields = table.fields
    .filter((field) => !activeNames.has(field.name.toLowerCase()))
    .map((field) => mapField(field, newIds, allTypes));

  let deletedFieldIds = existing.deletedFieldIds ?? [];
  if (table.removeFields?.length) {
    const removeNames = new Set(table.removeFields.map((name) => name.toLowerCase()));
    const removeIds = existing.fields
      .filter((field) => removeNames.has(field.name.toLowerCase()))
      .map((field) => field.id);
    deletedFieldIds = [...new Set([...deletedFieldIds, ...removeIds])];
  }

  return {
    ...existing,
    label: table.label?.trim() || existing.label,
    description: table.description?.trim() || existing.description,
    fields: [...existing.fields, ...newFields],
    deletedFieldIds,
    features: mergeFeatures(existing.features, table.features),
  };
}

/**
 * Pure mapping from the AI wizard's confirmed `proposal` tables
 * (`ai-wizard-protocol.ts`) onto real `ContentTypeDefinition` drafts - no
 * side effects, so it's independently testable. The caller (
 * `AiSchemaWizardDialog.tsx`) is responsible for actually calling
 * `saveDraft()`/`normalizeFieldOrder()` on each success.
 *
 * `allTypes` should be the merged live+draft type list (same overlay
 * `ContentTypeEditor.tsx` builds), so relation targets and name-collision
 * checks see any other in-progress edit too, not just what's live on the
 * server.
 */
export function mapWizardTables(
  tables: WizardProposedTable[],
  allTypes: ContentTypeDefinition[],
): WizardMapResult[] {
  const newIds = new Map<string, string>();
  for (const table of tables) {
    if (table.isNew) newIds.set(table.name.trim().toLowerCase(), randomUUID());
  }

  return tables.map((table): WizardMapResult => {
    try {
      if (table.isNew) {
        const id = newIds.get(table.name.trim().toLowerCase())!;
        const definition = buildNewDefinition(table, id, newIds, allTypes);
        validateContentTypeDefinition(definition, [...allTypes, definition]);
        return { ok: true, name: table.name, isNew: true, definition };
      }
      const existing = allTypes.find((type) => type.name.toLowerCase() === table.name.trim().toLowerCase());
      if (!existing) {
        return { ok: false, name: table.name, error: `"${table.name}" no longer exists - reopen the wizard and try again.` };
      }
      const definition = buildExtendedDefinition(table, existing, newIds, allTypes);
      validateContentTypeDefinition(definition, allTypes);
      return { ok: true, name: table.name, isNew: false, definition };
    } catch (error) {
      return {
        ok: false,
        name: table.name,
        error: error instanceof NamingError || error instanceof Error ? error.message : "Could not build this table.",
      };
    }
  });
}
