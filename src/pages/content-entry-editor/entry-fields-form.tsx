import type { EntryValue } from "../../content-types/engine/entry-codec.js";
import type { EntryFieldNode } from "../../content-types/engine/entry-tree.js";
import { SYSTEM_FIELD_IDS } from "../../content-types/system-fields.js";
import type { ContentTypeDefinition } from "../../content-types/types.js";
import SlugField from "../../components/fields/SlugField.js";
import FieldRenderer from "./FieldRenderer.js";

/** Renders a run of field nodes for one side of the entry form, pairing the
 * `features.slug` system Title field with its immediately-following Slug
 * field into one `SlugField` control (label -> auto-derived, editable slug)
 * instead of two independent text inputs - mirrors the schema editor's single
 * "Title & Slug" row (see `ContentTypeEditor.tsx`'s `systemFieldsForUi`). Per-
 * field reset lives in the Preview dialog instead of here - see
 * `status/entry-drafts.md`. Shared between `ContentEntryEditor.tsx` (the full
 * editor) and `QuickCreateEntryDialog.tsx` (the cut-down nested create form
 * opened from a `relation` field's own picker, `status/relation-quick-create.md`)
 * - both walk the exact same node-to-fieldset shape. */
export function renderFieldNodes(
  nodes: EntryFieldNode[],
  value: EntryValue,
  fieldErrors: Record<string, string>,
  onFieldChange: (fieldName: string, fieldValue: unknown) => void,
  allTypes: ContentTypeDefinition[],
  revealPath?: string[],
  /** Magic Write (status/magic-write.md decision #4): the field currently
   * being streamed into locks its own `<fieldset>` (native `disabled`
   * cascades to every control inside it, including a `flatten`/
   * `component-repeat` field's nested children) so the admin can't type over
   * it mid-write. `null`/`undefined` outside a Magic Write run - always
   * `undefined` for `QuickCreateEntryDialog`, which has no Magic of its own. */
  streamingFieldName?: string | null,
  /** `status/relation-quick-create.md` - locks (disables) one top-level
   * field's `<fieldset>` same as `streamingFieldName` does, but WITHOUT its
   * "AI is writing…" banner semantics (that banner only ever triggers for a
   * `column` node anyway, and this is always a `relation` node in practice).
   * Used by `QuickCreateEntryDialog` to lock a relation field it has
   * pre-filled to point back at the entry the create dialog was opened from
   * (a `relationmirror` field's own "+ New" - `RelationMirrorFieldAdapter`).
   * `null`/`undefined` everywhere else. */
  lockedFieldName?: string | null,
  /** `status/relation-quick-create.md` - the entry currently being edited's
   * own id (already hash-encoded, same shape a relation field's own value
   * uses), threaded down to `FieldRenderer`'s `relation-mirror` branch so it
   * can pre-fill+lock the mirrored relation's own field on a newly created
   * related entry. `null`/`undefined` for a not-yet-saved entry -
   * `QuickCreateEntryDialog`'s own form always passes `null` here, since
   * nothing can reference an entry that doesn't exist yet. */
  currentEntryId?: string | null,
) {
  const elements = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    const next = nodes[i + 1];
    if (
      node.kind === "column" &&
      node.fieldId === SYSTEM_FIELD_IDS.title &&
      next?.kind === "column" &&
      next.fieldId === SYSTEM_FIELD_IDS.slug
    ) {
      elements.push(
        // `data-field-name` (mục 6, status/continue.md): identifies this
        // top-level field for the `dry:field-input`/`dry:field-set` events
        // and `?_field=` deep link (`field-events.ts`) - the SlugField pair
        // is addressed by the Title field's own name, since it's really one
        // control on screen.
        <fieldset
          key={node.fieldName}
          data-field-name={node.fieldName}
          disabled={streamingFieldName === node.fieldName}
          class="content-entry-editor-field"
        >
          <SlugField
            label={node.label}
            slugLabel={next.label}
            value={
              typeof value[node.fieldName] === "string"
                ? (value[node.fieldName] as string)
                : ""
            }
            slug={
              typeof value[next.fieldName] === "string"
                ? (value[next.fieldName] as string)
                : ""
            }
            onChange={(titleValue, slugValue) => {
              onFieldChange(node.fieldName, titleValue);
              onFieldChange(next.fieldName, slugValue);
            }}
            required={!!node.validation.required}
            error={
              !!fieldErrors[node.fieldName] || !!fieldErrors[next.fieldName]
            }
            helperText={
              fieldErrors[node.fieldName] ?? fieldErrors[next.fieldName]
            }
          />
        </fieldset>,
      );
      i++; // Slug node already rendered alongside Title above.
      continue;
    }
    elements.push(
      <fieldset
        key={node.fieldName}
        data-field-name={node.fieldName}
        disabled={streamingFieldName === node.fieldName || lockedFieldName === node.fieldName}
        class="content-entry-editor-field"
      >
        {streamingFieldName === node.fieldName && node.kind === "column" && node.fieldType !== "richtext" && (
          // Magic Write (status/magic-write.md decision #4, update 2): the
          // real growing value is only ever live-fed into a plain "text"
          // field - everything else sits disabled with no visible change
          // while it streams, which reads as frozen/broken without this.
          // RichText is excluded (update 3, user: "UI của Richtext sẽ phải
          // không hiện status") - it already shows the AI's live growing
          // content directly in its own editor (`useRichTextEditor.ts`'s
          // external-value sync), so this extra banner is redundant clutter
          // on top of it, not a helpful signal the way it still is for a
          // field with no live view of its own (number/boolean/date/select/
          // image/flatten/component-repeat).
          <div class="content-entry-editor-field-writing">
            <span class="spinner" /> AI is writing…
          </div>
        )}
        <FieldRenderer
          node={node}
          value={value[node.fieldName]}
          onChange={(fieldValue) => onFieldChange(node.fieldName, fieldValue)}
          error={fieldErrors[node.fieldName]}
          allTypes={allTypes}
          revealPath={
            revealPath?.[0] === node.fieldName ? revealPath : undefined
          }
          currentEntryId={currentEntryId}
        />
      </fieldset>,
    );
  }
  return elements;
}
