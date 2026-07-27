import { useEffect, useState } from "preact/hooks";
import { useDialogSync } from "../../components/list-nav.js";
import { useOverlayScrollbars } from "../../components/overlayscrollbars.js";
import type { EntryValue } from "../../content-types/engine/entry-codec.js";
import type { EntryFieldNode } from "../../content-types/engine/entry-tree.js";
import type { ContentTypeDefinition } from "../../content-types/types.js";
import { blankEntryValue } from "./blank-value.js";
import FieldRenderer from "./FieldRenderer.js";

interface Props {
  open: boolean;
  title: string;
  itemFields: EntryFieldNode[];
  /** `null` when adding a brand-new item. */
  initialValue: EntryValue | null;
  allTypes: ContentTypeDefinition[];
  onCancel: () => void;
  onSave: (value: EntryValue) => void;
}

/** Add/edit dialog for one row of a repeatable-component field
 * (`ComponentRepeatField` in `FieldRenderer.tsx`) - same structural chrome as
 * `content-type-editor/FieldDialog.tsx` (header/scrollable body/footer), but
 * renders the component's own fields (recursing through `FieldRenderer`)
 * instead of a field-type picker. */
export default function ComponentItemDialog({ open, title, itemFields, initialValue, allTypes, onCancel, onSave }: Props) {
  const dialogRef = useDialogSync(open, onCancel);
  const { ref: bodyScroll } = useOverlayScrollbars<HTMLDivElement>([open]);
  const [draft, setDraft] = useState<EntryValue>({});

  useEffect(() => {
    if (open) setDraft(initialValue ?? blankEntryValue(itemFields));
  }, [open, initialValue, itemFields]);

  function updateField(fieldName: string, value: unknown) {
    setDraft((current) => ({ ...current, [fieldName]: value }));
  }

  return (
    <dialog ref={dialogRef} aria-label={title} class="xl component-item-dialog">
      {open && (
        <>
          <header>
            <h3>{title}</h3>
          </header>
          <div class="component-item-dialog-body" ref={bodyScroll}>
            <div class="stack">
              {itemFields.map((node) => (
                <FieldRenderer
                  key={node.fieldName}
                  node={node}
                  value={draft[node.fieldName]}
                  onChange={(value) => updateField(node.fieldName, value)}
                  allTypes={allTypes}
                />
              ))}
            </div>
          </div>
          <footer class="row justify-end">
            <button type="button" class="outline" onClick={onCancel}>
              Cancel
            </button>
            <button type="button" onClick={() => onSave(draft)}>
              Save
            </button>
          </footer>
        </>
      )}
    </dialog>
  );
}
