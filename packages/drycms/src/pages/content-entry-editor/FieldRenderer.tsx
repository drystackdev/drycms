import { useEffect, useMemo, useState } from "preact/hooks";
import { path } from "virtual:drycms/config";
import { PlusIcon, TrashIcon, XIcon } from "../../components/icons.js";
import { createContentEntriesApi } from "../../content-types/entries-http-api.js";
import type { EntryValue } from "../../content-types/engine/entry-codec.js";
import {
  buildEntryFieldTree,
  flattenQueryableColumns,
  type EntryComponentRepeatNode,
  type EntryFieldNode,
  type EntryRelationNode,
} from "../../content-types/engine/entry-tree.js";
import type { ContentTypeDefinition } from "../../content-types/types.js";
import ComponentItemDialog from "./ComponentItemDialog.js";
import RefPickerDialog from "./RefPickerDialog.js";
import ScalarField from "./ScalarField.js";

export interface FieldRendererProps {
  node: EntryFieldNode;
  value: unknown;
  onChange: (value: unknown) => void;
  error?: string;
  allTypes: ContentTypeDefinition[];
}

/**
 * Renders one field of an entry, dispatching on `EntryFieldNode.kind`:
 * `column` -> `ScalarField` (the registry `Editor`s); `flatten` -> a nested
 * fieldset recursing back into this same component; `relation`/
 * `component-repeat` -> the bespoke controls below (`field-registry.ts` has
 * no `Editor` for either type - they're schema-definition-only there).
 */
export default function FieldRenderer({ node, value, onChange, error, allTypes }: FieldRendererProps) {
  if (node.kind === "column") {
    return <ScalarField node={node} value={value} onChange={onChange} error={error} />;
  }

  if (node.kind === "flatten") {
    const nested = (value as EntryValue) ?? {};
    return (
      <fieldset>
        <legend>{node.label}</legend>
        <div class="stack">
          {node.children.map((child) => (
            <FieldRenderer
              key={child.fieldName}
              node={child}
              value={nested[child.fieldName]}
              onChange={(childValue) => onChange({ ...nested, [child.fieldName]: childValue })}
              allTypes={allTypes}
            />
          ))}
        </div>
      </fieldset>
    );
  }

  if (node.kind === "relation") {
    return <RelationField node={node} value={value} onChange={onChange} allTypes={allTypes} />;
  }

  return <ComponentRepeatField node={node} value={(value as EntryValue[]) ?? []} onChange={onChange} allTypes={allTypes} />;
}

function RelationField({
  node,
  value,
  onChange,
  allTypes,
}: {
  node: EntryRelationNode;
  value: unknown;
  onChange: (value: unknown) => void;
  allTypes: ContentTypeDefinition[];
}) {
  const targetType = allTypes.find((t) => t.id === node.targetTypeId);
  const multiple = node.cardinality !== "manyToOne";
  const selectedIds: string[] = multiple
    ? Array.isArray(value)
      ? (value as string[])
      : []
    : value
      ? [value as string]
      : [];

  const [dialogOpen, setDialogOpen] = useState(false);
  const [labels, setLabels] = useState<Record<string, string>>({});

  const entriesApi = useMemo(
    () => (targetType ? createContentEntriesApi(`${path}/api/content`, targetType.name) : null),
    [targetType],
  );
  const labelField = useMemo(
    () => (targetType ? flattenQueryableColumns(buildEntryFieldTree(targetType, allTypes))[0]?.fieldName : undefined),
    [targetType, allTypes],
  );

  useEffect(() => {
    const missing = selectedIds.filter((id) => !(id in labels));
    if (!entriesApi || missing.length === 0) return;
    let cancelled = false;
    Promise.all(
      missing.map((id) =>
        entriesApi
          .get(id)
          .then((entry): [string, string] => [id, labelField ? String(entry.value[labelField] ?? id) : id])
          .catch((): [string, string] => [id, id]),
      ),
    ).then((pairs) => {
      if (cancelled) return;
      setLabels((current) => ({ ...current, ...Object.fromEntries(pairs) }));
    });
    return () => {
      cancelled = true;
    };
    // Only re-resolve when the selected id SET changes, not on every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entriesApi, selectedIds.join(","), labelField]);

  if (!targetType) {
    return (
      <div class="field">
        <label>{node.label}</label>
        <span class="hint">Target collection not found.</span>
      </div>
    );
  }

  function removeId(id: string) {
    onChange(multiple ? selectedIds.filter((existing) => existing !== id) : null);
  }

  return (
    <div class="field entry-relation-field">
      <label>{node.label}</label>
      <div class="entry-relation-chips">
        {selectedIds.length === 0 && <span class="hint">None selected.</span>}
        {selectedIds.map((id) => (
          <span key={id} class="badge outline entry-relation-chip">
            {labels[id] ?? "…"}
            <button type="button" class="ghost icon sm" aria-label={`Remove ${labels[id] ?? id}`} onClick={() => removeId(id)}>
              <XIcon />
            </button>
          </span>
        ))}
      </div>
      <button type="button" class="outline sm" onClick={() => setDialogOpen(true)}>
        Choose {targetType.label}
      </button>

      <RefPickerDialog
        open={dialogOpen}
        multiple={multiple}
        targetType={targetType}
        allTypes={allTypes}
        selectedIds={selectedIds}
        onCancel={() => setDialogOpen(false)}
        onSave={(ids) => {
          setDialogOpen(false);
          onChange(multiple ? ids : (ids[0] ?? null));
        }}
      />
    </div>
  );
}

function ComponentRepeatField({
  node,
  value,
  onChange,
  allTypes,
}: {
  node: EntryComponentRepeatNode;
  value: EntryValue[];
  onChange: (value: unknown) => void;
  allTypes: ContentTypeDefinition[];
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const summaryField = node.itemFields.find((f) => f.kind === "column")?.fieldName;

  function removeItem(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  function handleSave(item: EntryValue) {
    onChange(editingIndex === null ? [...value, item] : value.map((existing, i) => (i === editingIndex ? item : existing)));
    setDialogOpen(false);
    setEditingIndex(null);
  }

  return (
    <div class="field entry-component-repeat">
      <label>{node.label}</label>
      <ul class="entry-component-repeat-list">
        {value.length === 0 && <li class="hint">No items yet.</li>}
        {value.map((item, index) => (
          // eslint-disable-next-line react/no-array-index-key -- items have no stable id of their own until saved
          <li key={index} class="row justify-between">
            <button
              type="button"
              class="link"
              onClick={() => {
                setEditingIndex(index);
                setDialogOpen(true);
              }}
            >
              {summaryField ? String(item[summaryField] ?? `Item ${index + 1}`) : `Item ${index + 1}`}
            </button>
            <button type="button" class="ghost icon sm" aria-label="Remove item" onClick={() => removeItem(index)}>
              <TrashIcon />
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        class="outline sm"
        onClick={() => {
          setEditingIndex(null);
          setDialogOpen(true);
        }}
      >
        <PlusIcon /> Add item
      </button>

      <ComponentItemDialog
        open={dialogOpen}
        title={editingIndex === null ? `Add ${node.label}` : `Edit ${node.label}`}
        itemFields={node.itemFields}
        initialValue={editingIndex !== null ? (value[editingIndex] ?? null) : null}
        allTypes={allTypes}
        onCancel={() => {
          setDialogOpen(false);
          setEditingIndex(null);
        }}
        onSave={handleSave}
      />
    </div>
  );
}
