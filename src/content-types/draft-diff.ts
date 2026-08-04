import type { DestructiveChange } from "./migration.js";
import { fieldTypes } from "./field-registry.js";
import { activeFields, effectiveFeatures } from "./system-fields.js";
import type { ContentTypeDefinition, ContentTypeFeatures } from "./types.js";

/** Human-readable line for one of `migration.ts`'s `DestructiveChange`s,
 * shared by every place that surfaces a migration's data-loss summary. */
export function describeDestructiveChange(change: DestructiveChange): string {
  switch (change.kind) {
    case "drop-column":
      return `Column "${change.columnName}" on "${change.tableName}" will be dropped - its data will be lost.`;
    case "drop-table":
      return `Table "${change.tableName}" will be dropped - every row in it will be lost.`;
    case "shape-changed":
      return `"${change.columnOrField}" on "${change.tableName}" changes from ${change.from} to ${change.to} - its existing data will be lost.`;
    case "lossy-retype":
      return `Column "${change.columnName}" on "${change.tableName}" changes type from ${change.from} to ${change.to} - values that don't convert cleanly will become 0/empty.`;
    default:
      return "This field will change.";
  }
}

export interface FieldChangeSummary {
  kind: "added" | "removed" | "changed";
  fieldId: string;
  label: string;
  typeLabel: string;
}

export interface FeatureChangeSummary {
  key: keyof ContentTypeFeatures;
  enabled: boolean;
}

/** Everything about a content type an admin would recognize as "I changed
 * something" - deliberately excludes `order`/`fieldOrder`/`fieldSides`
 * (pure display cosmetics, see `types.ts`) so drag-reordering fields doesn't
 * itself count as an edit. */
export interface ContentTypeDraftDiff {
  isNew: boolean;
  labelChanged: boolean;
  fieldChanges: FieldChangeSummary[];
  featureChanges: FeatureChangeSummary[];
  /** `fieldChanges.length + featureChanges.length` - the single number shown
   * as the list page's "Edited" badge. */
  editedCount: number;
}

/** Strips the purely-cosmetic `order` before comparing two fields for
 * equality - two fields that only moved position aren't "changed". */
function fieldSignature(field: ContentTypeDefinition["fields"][number]): string {
  const { order, ...rest } = field;
  return JSON.stringify(rest);
}

/** Pure. `live` is `undefined` for a draft that hasn't been created on the
 * server yet - every one of its active fields counts as "added". */
export function diffContentType(
  live: ContentTypeDefinition | undefined,
  draft: ContentTypeDefinition,
): ContentTypeDraftDiff {
  const liveFields = live ? activeFields(live) : [];
  const draftFields = activeFields(draft);
  const liveById = new Map(liveFields.map((f) => [f.id, f]));
  const draftById = new Map(draftFields.map((f) => [f.id, f]));
  const allIds = new Set([...liveById.keys(), ...draftById.keys()]);

  const fieldChanges: FieldChangeSummary[] = [];
  for (const id of allIds) {
    const liveField = liveById.get(id);
    const draftField = draftById.get(id);
    if (liveField && draftField) {
      if (fieldSignature(liveField) !== fieldSignature(draftField)) {
        fieldChanges.push({
          kind: "changed",
          fieldId: id,
          label: draftField.label || draftField.name,
          typeLabel: fieldTypes[draftField.type]?.label ?? draftField.type,
        });
      }
    } else if (draftField) {
      fieldChanges.push({
        kind: "added",
        fieldId: id,
        label: draftField.label || draftField.name,
        typeLabel: fieldTypes[draftField.type]?.label ?? draftField.type,
      });
    } else if (liveField) {
      fieldChanges.push({
        kind: "removed",
        fieldId: id,
        label: liveField.label || liveField.name,
        typeLabel: fieldTypes[liveField.type]?.label ?? liveField.type,
      });
    }
  }

  const liveFeatures = live ? effectiveFeatures(live) : {};
  const draftFeatures = effectiveFeatures(draft);
  const featureKeys = new Set([
    ...Object.keys(liveFeatures),
    ...Object.keys(draftFeatures),
  ]) as Set<keyof ContentTypeFeatures>;
  const featureChanges: FeatureChangeSummary[] = [];
  for (const key of featureKeys) {
    const wasOn = !!liveFeatures[key];
    const isOn = !!draftFeatures[key];
    if (wasOn !== isOn) featureChanges.push({ key, enabled: isOn });
  }

  const labelChanged = !live || live.label !== draft.label || live.name !== draft.name || (live.description ?? "") !== (draft.description ?? "");

  return {
    isNew: !live,
    labelChanged,
    fieldChanges,
    featureChanges,
    editedCount: fieldChanges.length + featureChanges.length,
  };
}
