import { useEffect, useMemo, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { path } from "virtual:drycms/config";
import ConfirmDialog from "../components/ConfirmDialog.js";
import SlugField from "../components/SlugField.js";
import { toast } from "../components/Toast.js";
import { ArrowLeftIcon, TrashIcon } from "../components/icons.js";
import {
  ContentEntriesApiError,
  createContentEntriesApi,
} from "../content-types/entries-http-api.js";
import type { EntryValue } from "../content-types/engine/entry-codec.js";
import { findPasswordChangeErrors } from "../content-types/engine/entry-validate.js";
import {
  buildEntryFieldTree,
  type EntryFieldNode,
} from "../content-types/engine/entry-tree.js";
import { createContentTypesApi } from "../content-types/http-api.js";
import {
  resolveFieldSide,
  SYSTEM_FIELD_IDS,
} from "../content-types/system-fields.js";
import type { ContentTypeDefinition } from "../content-types/types.js";
import { blankEntryValue } from "./content-entry-editor/blank-value.js";
import FieldRenderer from "./content-entry-editor/FieldRenderer.js";
import { useDocumentTitle } from "./page-common.js";

interface Props {
  typeSlug: string;
  /** Absent for a brand-new collection entry, or for a singleton (which has
   * no id of its own in the URL - see `ContentEntryList.tsx`). */
  id?: string;
}

/** Renders a run of field nodes for one side of the entry form, pairing the
 * `features.slug` system Title field with its immediately-following Slug
 * field into one `SlugField` control (label -> auto-derived, editable slug)
 * instead of two independent text inputs - mirrors the schema editor's single
 * "Title & Slug" row (see `ContentTypeEditor.tsx`'s `systemFieldsForUi`). */
function renderFieldNodes(
  nodes: EntryFieldNode[],
  value: EntryValue,
  fieldErrors: Record<string, string>,
  onFieldChange: (fieldName: string, fieldValue: unknown) => void,
  allTypes: ContentTypeDefinition[],
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
        <SlugField
          key={node.fieldName}
          label={node.label}
          slugLabel={next.label}
          value={typeof value[node.fieldName] === "string" ? (value[node.fieldName] as string) : ""}
          slug={typeof value[next.fieldName] === "string" ? (value[next.fieldName] as string) : ""}
          onChange={(titleValue, slugValue) => {
            onFieldChange(node.fieldName, titleValue);
            onFieldChange(next.fieldName, slugValue);
          }}
          required={!!node.validation.required}
          error={!!fieldErrors[node.fieldName] || !!fieldErrors[next.fieldName]}
          helperText={fieldErrors[node.fieldName] ?? fieldErrors[next.fieldName]}
        />,
      );
      i++; // Slug node already rendered alongside Title above.
      continue;
    }
    elements.push(
      <FieldRenderer
        key={node.fieldName}
        node={node}
        value={value[node.fieldName]}
        onChange={(fieldValue) => onFieldChange(node.fieldName, fieldValue)}
        error={fieldErrors[node.fieldName]}
        allTypes={allTypes}
      />,
    );
  }
  return elements;
}

export default function ContentEntryEditor({ typeSlug, id }: Props) {
  const { route } = useLocation();
  const typesApi = useMemo(
    () => createContentTypesApi(`${path}/api/content-types`),
    [],
  );

  const [allTypes, setAllTypes] = useState<ContentTypeDefinition[]>([]);
  const [type, setType] = useState<ContentTypeDefinition | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [value, setValue] = useState<EntryValue | null>(null);
  const [entryId, setEntryId] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  // Snapshot of `value` right after load, before any edits - see
  // `ContentTypeEditor.tsx`'s identical pattern for the rationale.
  const [initialSnapshot, setInitialSnapshot] = useState<string | null>(null);
  const [leaveTo, setLeaveTo] = useState<string | null>(null);
  const isDirty =
    initialSnapshot !== null &&
    value !== null &&
    JSON.stringify(value) !== initialSnapshot;

  const entriesApi = useMemo(
    () =>
      type ? createContentEntriesApi(`${path}/api/content`, type.name) : null,
    [type],
  );
  const nodes: EntryFieldNode[] = useMemo(
    () => (type ? buildEntryFieldTree(type, allTypes) : []),
    [type, allTypes],
  );

  const isSingleton = type?.kind === "singleton";
  const isNew = !isSingleton && !id;

  useEffect(() => {
    (async () => {
      try {
        const types = await typesApi.list();
        setAllTypes(types);
        const found = types.find(
          (t) => t.name === typeSlug && t.kind !== "component",
        );
        if (!found) {
          setLoadError(`Content type "${typeSlug}" not found.`);
          return;
        }
        setType(found);
      } catch (error) {
        setLoadError(
          error instanceof Error
            ? error.message
            : "Failed to load content type.",
        );
      }
    })();
  }, [typeSlug]);

  useEffect(() => {
    if (!type || !entriesApi) return;
    (async () => {
      try {
        const builtNodes = buildEntryFieldTree(type, allTypes);
        if (type.kind === "singleton") {
          const entry = await entriesApi.getSingleton();
          const loadedValue = entry?.value ?? blankEntryValue(builtNodes);
          setValue(loadedValue);
          setEntryId(entry?.id ?? null);
          setInitialSnapshot(JSON.stringify(loadedValue));
        } else if (id) {
          const entry = await entriesApi.get(id);
          setValue(entry.value);
          setEntryId(entry.id);
          setInitialSnapshot(JSON.stringify(entry.value));
        } else {
          const blank = blankEntryValue(builtNodes);
          setValue(blank);
          setEntryId(null);
          setInitialSnapshot(JSON.stringify(blank));
        }
      } catch (error) {
        setLoadError(
          error instanceof Error ? error.message : "Failed to load entry.",
        );
      }
    })();
    // `allTypes` deliberately excluded - it's only needed to resolve
    // `type` itself, re-fetching the ENTRY every time the (much larger)
    // schema list happens to get a new array identity would be wasteful.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, id]);

  useDocumentTitle(
    type ? (isNew ? `New ${type.label}` : type.label) : "Content",
  );

  // Same `beforeunload` + confirm-before-navigating pattern as
  // `ContentTypeEditor.tsx` - see its doc comment for why browser-level
  // navigation can only get the browser's own native prompt.
  useEffect(() => {
    if (!isDirty) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  function requestLeave(to: string) {
    if (isDirty) setLeaveTo(to);
    else route(to);
  }

  function updateFieldValue(fieldName: string, fieldValue: unknown) {
    setValue((current) =>
      current ? { ...current, [fieldName]: fieldValue } : current,
    );
  }

  async function handleSave() {
    if (!type || !entriesApi || !value) return;
    setFieldErrors({});

    // Confirm-password mismatches (and a missing "current password" when setting a
    // new one) only ever exist client-side - `confirm` never reaches the server - so
    // this is the one pre-submit check the editor runs, ahead of the usual "just
    // submit and surface whatever the server rejects" pattern below.
    const passwordErrors = findPasswordChangeErrors(nodes, value);
    if (Object.keys(passwordErrors).length > 0) {
      setFieldErrors(passwordErrors);
      toast.add({ type: "error", title: "Fix the highlighted fields." });
      return;
    }

    setSaving(true);
    try {
      if (isSingleton) {
        const entry = await entriesApi.saveSingleton(value);
        setValue(entry.value);
        setEntryId(entry.id);
        setInitialSnapshot(JSON.stringify(entry.value));
        toast.add({ type: "success", title: `Saved "${type.label}".` });
      } else if (isNew) {
        await entriesApi.create(value);
        toast.add({ type: "success", title: `Created "${type.label}" entry.` });
        route(`${path}/content/${type.name}`);
      } else if (entryId) {
        const entry = await entriesApi.update(entryId, value);
        setValue(entry.value);
        setInitialSnapshot(JSON.stringify(entry.value));
        toast.add({ type: "success", title: `Saved "${type.label}" entry.` });
        route(`${path}/content/${type.name}`);
      }
    } catch (error) {
      if (error instanceof ContentEntriesApiError && error.fieldErrors) {
        setFieldErrors(error.fieldErrors);
        toast.add({ type: "error", title: "Fix the highlighted fields." });
      } else {
        toast.add({
          type: "error",
          title: "Save failed",
          description: error instanceof Error ? error.message : undefined,
        });
      }
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!type || !entriesApi || !entryId) return;
    setDeleting(true);
    try {
      await entriesApi.remove(entryId);
      setShowDeleteConfirm(false);
      toast.add({ type: "success", title: `Deleted "${type.label}" entry.` });
      route(`${path}/content/${type.name}`);
    } catch (error) {
      toast.add({
        type: "error",
        title: "Delete failed",
        description: error instanceof Error ? error.message : undefined,
      });
    } finally {
      setDeleting(false);
    }
  }

  if (loadError) return <span class="error">{loadError}</span>;
  if (!type || value === null) return <span class="hint">Loading…</span>;

  const backTo = `${path}/content/${type.name}`;
  // `createdAt`/`updatedAt` are server-stamped on every save (see
  // `entry-codec.ts`'s `applyTimestamps`) regardless of what's submitted for
  // them - showing them as an editable date picker (especially pre-filled
  // with "now" on a not-yet-created entry) would be misleading, so they're
  // left out of the form entirely. The List page's columns already show them.
  const isTimestampField = (node: EntryFieldNode) =>
    node.kind === "column" &&
    (node.fieldId === SYSTEM_FIELD_IDS.createdAt ||
      node.fieldId === SYSTEM_FIELD_IDS.updatedAt);
  const editableNodes = nodes.filter((n) => !isTimestampField(n));
  const sideOf = (n: EntryFieldNode) =>
    resolveFieldSide(n.fieldId, n.kind !== "column", type.fieldSides);
  const leftFields = editableNodes.filter((n) => sideOf(n) === "left");
  const rightFields = editableNodes.filter((n) => sideOf(n) === "right");

  return (
    <>
      <div class="page-header">
        {!isSingleton && (
          <button
            type="button"
            class="icon ghost"
            onClick={() => requestLeave(backTo)}
          >
            <ArrowLeftIcon />
          </button>
        )}
        <div style={{ flex: 1 }}>
          <h1>{isNew ? `New ${type.label}` : type.label}</h1>
          <p>{type.description || `Edit this ${type.kind}'s content.`}</p>
        </div>
        <div class="row">
          {!isSingleton && (
            <button
              type="button"
              class="outline"
              onClick={() => requestLeave(backTo)}
            >
              Cancel
            </button>
          )}
          <button type="button" disabled={saving} aria-busy={saving} onClick={handleSave}>
            Save
          </button>
        </div>
      </div>

      <div class="content-entry-editor-grid">
        <div class="stack">
          {renderFieldNodes(
            leftFields,
            value,
            fieldErrors,
            updateFieldValue,
            allTypes,
          )}
        </div>

        <div class="stack">
          {renderFieldNodes(
            rightFields,
            value,
            fieldErrors,
            updateFieldValue,
            allTypes,
          )}

          {!isNew && !isSingleton && (
            <div class="content-type-editor-danger">
              <div>
                <h2>Danger zone</h2>
                <p>Delete this entry. This cannot be undone.</p>
              </div>
              <div>
                <button
                  type="button"
                  class="destructive"
                  onClick={() => setShowDeleteConfirm(true)}
                >
                  <TrashIcon /> Delete entry
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={showDeleteConfirm}
        title="Delete this entry?"
        message={
          <p>This permanently deletes the entry. This cannot be undone.</p>
        }
        confirmLabel="Delete"
        destructive
        busy={deleting}
        onConfirm={handleDelete}
        onCancel={() => setShowDeleteConfirm(false)}
      />

      <ConfirmDialog
        open={leaveTo !== null}
        title="Discard unsaved changes?"
        message={
          <p>
            You have unsaved changes to this entry. Leaving now will discard
            them.
          </p>
        }
        confirmLabel="Discard changes"
        destructive
        onConfirm={() => {
          const to = leaveTo!;
          setLeaveTo(null);
          route(to);
        }}
        onCancel={() => setLeaveTo(null)}
      />
    </>
  );
}
