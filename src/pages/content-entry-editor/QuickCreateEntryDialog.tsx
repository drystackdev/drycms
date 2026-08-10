import { useEffect, useMemo, useState } from "preact/hooks";
const { path } = window.__DRY_CONFIG__;
import { toast } from "../../components/Toast.js";
import { useDialogSync } from "../../hooks/list-nav.js";
import { useOverlayScrollbars } from "../../hooks/overlayscrollbars.js";
import {
  ContentEntriesApiError,
  createContentEntriesApi,
} from "../../content-types/entries-http-api.js";
import type { EntryValue } from "../../content-types/engine/entry-codec.js";
import { findPasswordChangeErrors } from "../../content-types/engine/entry-validate.js";
import {
  buildEntryFieldTree,
  type EntryFieldNode,
} from "../../content-types/engine/entry-tree.js";
import { SYSTEM_FIELD_IDS } from "../../content-types/system-fields.js";
import type { ContentTypeDefinition } from "../../content-types/types.js";
import { blankEntryValue } from "./blank-value.js";
import { renderFieldNodes } from "./entry-fields-form.js";

export interface QuickCreateEntryDialogProps {
  type: ContentTypeDefinition;
  allTypes: ContentTypeDefinition[];
  open: boolean;
  onCreated: (id: string) => void;
  onCancel: () => void;
}

/**
 * Cut-down entry-create form opened as a dialog NESTED inside a `relation`
 * field's own picker (`RelationField.tsx`'s `createTarget` -
 * `status/relation-quick-create.md`) - lets an admin add a brand-new row of
 * the related collection without leaving the entry they're editing. Native
 * `<dialog>` stacking ("last `showModal()` wins", see `status/magic-chat.md`)
 * puts this on top of the picker dialog that opened it, same precedent
 * `ImageField`'s own nested `FileManager` picker already relies on.
 *
 * Deliberately minimal next to `ContentEntryEditor`: no Magic Chat, no draft
 * autosave, no left/right column split, no Preview/Delete - just the fields
 * plus Save/Cancel, the same scope `ComponentField`'s own item dialog keeps
 * for a repeatable component's fields.
 */
export default function QuickCreateEntryDialog({
  type,
  allTypes,
  open,
  onCreated,
  onCancel,
}: QuickCreateEntryDialogProps) {
  const entriesApi = useMemo(
    () => createContentEntriesApi(`${path}/api/content`, type.name),
    [type],
  );
  const nodes: EntryFieldNode[] = useMemo(
    () => buildEntryFieldTree(type, allTypes),
    [type, allTypes],
  );
  // Same exclusions `ContentEntryEditor.tsx`'s `editableNodes` applies -
  // server-stamped/list-only fields have no business in a create form.
  const editableNodes = useMemo(
    () =>
      nodes.filter(
        (n) =>
          !(
            n.kind === "column" &&
            (n.fieldId === SYSTEM_FIELD_IDS.createdAt ||
              n.fieldId === SYSTEM_FIELD_IDS.updatedAt)
          ) && !(n.kind === "column" && n.fieldId === SYSTEM_FIELD_IDS.sortIndex),
      ),
    [nodes],
  );

  const [value, setValue] = useState<EntryValue>(() => blankEntryValue(nodes));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const dialogRef = useDialogSync(open, onCancel);
  const { ref: bodyScroll } = useOverlayScrollbars<HTMLDivElement>([open]);

  // Fresh blank draft every time this reopens - lets the same instance be
  // used to create several related entries in a row without carrying over
  // the previous one's values.
  useEffect(() => {
    if (open) {
      setValue(blankEntryValue(nodes));
      setFieldErrors({});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on open only, not on every `nodes` identity change
  }, [open]);

  function updateFieldValue(fieldName: string, fieldValue: unknown) {
    setValue((current) => ({ ...current, [fieldName]: fieldValue }));
  }

  async function handleSave() {
    setFieldErrors({});
    // Same one pre-submit check `ContentEntryEditor.tsx`'s own `handleSave`
    // runs ahead of "submit and surface whatever the server rejects" -
    // confirm-password mismatches only ever exist client-side.
    const passwordErrors = findPasswordChangeErrors(nodes, value);
    if (Object.keys(passwordErrors).length > 0) {
      setFieldErrors(passwordErrors);
      toast.add({ type: "error", title: "Fix the highlighted fields." });
      return;
    }
    setSaving(true);
    try {
      const entry = await entriesApi.create(value);
      toast.add({ type: "success", title: `Created "${type.label}" entry.` });
      onCreated(entry.id);
    } catch (error) {
      if (error instanceof ContentEntriesApiError && error.fieldErrors) {
        setFieldErrors(error.fieldErrors);
        toast.add({ type: "error", title: "Fix the highlighted fields." });
      } else {
        toast.add({
          type: "error",
          title: "Create failed",
          description: error instanceof Error ? error.message : undefined,
        });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      class="lg quick-create-entry-dialog"
      aria-label={`New ${type.label}`}
    >
      {open && (
        <>
          <header>
            <h3>New {type.label}</h3>
          </header>
          <div class="quick-create-entry-dialog-body" ref={bodyScroll}>
            <div class="stack">
              {renderFieldNodes(editableNodes, value, fieldErrors, updateFieldValue, allTypes)}
            </div>
          </div>
          <footer class="row justify-end">
            <button type="button" class="outline" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="button"
              disabled={saving}
              aria-busy={saving}
              onClick={handleSave}
            >
              Save
            </button>
          </footer>
        </>
      )}
    </dialog>
  );
}
