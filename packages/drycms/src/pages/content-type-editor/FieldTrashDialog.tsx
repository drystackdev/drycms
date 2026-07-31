import { useEffect, useState } from "preact/hooks";
import ConfirmDialog from "../../components/ConfirmDialog.js";
import { fieldTypes } from "../../content-types/field-registry.js";
import type { ContentTypeFeatures, FieldDefinition } from "../../content-types/types.js";
import { useDialogSync } from "../../components/list-nav.js";
import { TrashIcon, UndoIcon, XIcon } from "../../components/icons.js";

export interface TrashedFeature {
  key: keyof ContentTypeFeatures;
  label: string;
}

export interface FieldTrashDialogProps {
  open: boolean;
  fields: FieldDefinition[];
  features: TrashedFeature[];
  onClose: () => void;
  onRestoreField: (id: string) => void;
  onPurgeField: (id: string) => void;
  onRestoreFeature: (key: keyof ContentTypeFeatures) => void;
  onPurgeFeature: (key: keyof ContentTypeFeatures) => void;
}

type PendingPurge =
  | { kind: "field"; id: string; label: string }
  | { kind: "feature"; key: keyof ContentTypeFeatures; label: string };

/**
 * Lists everything currently archived (see `types.ts`'s
 * `deletedFieldIds`/`deletedFeatureKeys`) - opened from `FieldsList.tsx`'s
 * footer button. Restore is instant (it's just un-hiding something whose
 * column already still exists); "delete forever" is the actually destructive
 * action here (drops the real column on the next save), so it goes through
 * the same `ConfirmDialog` pattern the rest of this editor already uses.
 * Auto-closes the moment the last item is restored/deleted forever - the
 * footer button that opens this is itself only shown while there's at least
 * one item to manage (see `FieldsList.tsx`), so an empty dialog would just
 * be dead air with nothing left to do.
 */
export default function FieldTrashDialog({
  open,
  fields,
  features,
  onClose,
  onRestoreField,
  onPurgeField,
  onRestoreFeature,
  onPurgeFeature,
}: FieldTrashDialogProps) {
  const ref = useDialogSync(open, onClose);
  const [pendingPurge, setPendingPurge] = useState<PendingPurge | null>(null);

  const empty = fields.length === 0 && features.length === 0;

  useEffect(() => {
    if (open && empty) onClose();
  }, [open, empty]);

  return (
    <>
      <dialog ref={ref} class="md" aria-label="Archive">
        {open && (
          <>
            <header class="row justify-between" style={{ flexWrap: "nowrap" }}>
              <div class="spacer" style={{ minWidth: 0 }}>
                <h3>Archive</h3>
                <p>
                  Removed fields and features stay here, columns intact, until
                  restored or deleted forever.
                </p>
              </div>
              <button type="button" class="icon ghost" onClick={onClose}>
                <XIcon />
              </button>
            </header>
            <ul class="content-type-list">
              {empty && (
                <li class="hint empty" style={{ marginInline: "1rem" }}>
                  Archive is empty.
                </li>
              )}
              {features.map(({ key, label }) => (
                <li key={`feature-${key}`} class="content-type-list-item row justify-between">
                  <div class="stack spacer" style={{ gap: "0.125rem" }}>
                    <span class="row align-center" style={{ gap: "0.25rem" }}>
                      {label}
                      <span class="badge sm outline">Feature</span>
                    </span>
                  </div>
                  <div class="row">
                    <button
                      type="button"
                      class="ghost sm"
                      aria-label={`Restore ${label}`}
                      onClick={() => onRestoreFeature(key)}
                    >
                      <UndoIcon />
                    </button>
                    <button
                      type="button"
                      class="ghost sm"
                      aria-label={`Delete ${label} forever`}
                      onClick={() => setPendingPurge({ kind: "feature", key, label })}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </li>
              ))}
              {fields.map((field) => (
                <li key={field.id} class="content-type-list-item row justify-between">
                  <div class="stack spacer" style={{ gap: "0.125rem" }}>
                    <span class="row align-center" style={{ gap: "0.25rem" }}>
                      {field.label}
                      <span class="badge sm secondary">
                        {fieldTypes[field.type]?.label ?? field.type}
                      </span>
                    </span>
                    <small class="hint">{field.name}</small>
                  </div>
                  <div class="row">
                    <button
                      type="button"
                      class="ghost sm"
                      aria-label={`Restore ${field.label}`}
                      onClick={() => onRestoreField(field.id)}
                    >
                      <UndoIcon />
                    </button>
                    <button
                      type="button"
                      class="ghost sm"
                      aria-label={`Delete ${field.label} forever`}
                      onClick={() => setPendingPurge({ kind: "field", id: field.id, label: field.label })}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <footer>
              <button type="button" onClick={onClose}>
                Close
              </button>
            </footer>
          </>
        )}
      </dialog>
      <ConfirmDialog
        open={pendingPurge !== null}
        title={`Delete "${pendingPurge?.label ?? ""}" forever?`}
        message={
          <p>
            This permanently removes it from the schema - saving afterwards
            will drop its column, and any data in it. This cannot be undone.
          </p>
        }
        confirmLabel="Delete forever"
        destructive
        onConfirm={() => {
          if (pendingPurge?.kind === "field") onPurgeField(pendingPurge.id);
          if (pendingPurge?.kind === "feature") onPurgeFeature(pendingPurge.key);
          setPendingPurge(null);
        }}
        onCancel={() => setPendingPurge(null)}
      />
    </>
  );
}
