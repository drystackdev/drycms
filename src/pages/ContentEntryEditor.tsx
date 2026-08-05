import { useEffect, useMemo, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
const { path } = window.__DRY_CONFIG__;
import ConfirmDialog from "../components/ConfirmDialog.js";
import SlugField from "../components/fields/SlugField.js";
import { toast } from "../components/Toast.js";
import { ArrowLeftIcon, TrashIcon } from "../components/icons/index.js";
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
import { useParam } from "../hooks/useParam.js";
import { useDelayedLoading } from "../hooks/useDelayedLoading.js";
import { blankEntryValue } from "./content-entry-editor/blank-value.js";
import {
  dispatchFieldInput,
  FIELD_ANCHOR_ATTR,
  listenForFieldSet,
  scrollToField,
} from "./content-entry-editor/field-events.js";
import { setValueAtPath } from "./content-entry-editor/field-path.js";
import FieldRenderer, { type FieldRendererProps } from "./content-entry-editor/FieldRenderer.js";
import { useDocumentTitle } from "./page-common.js";
import { canAccess } from "../store/auth.js";

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
  checkSecretKey?: FieldRendererProps["checkSecretKey"],
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
        <div key={node.fieldName} data-field-name={node.fieldName}>
          <SlugField
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
          />
        </div>,
      );
      i++; // Slug node already rendered alongside Title above.
      continue;
    }
    elements.push(
      <div key={node.fieldName} data-field-name={node.fieldName}>
        <FieldRenderer
          node={node}
          value={value[node.fieldName]}
          onChange={(fieldValue) => onFieldChange(node.fieldName, fieldValue)}
          error={fieldErrors[node.fieldName]}
          allTypes={allTypes}
          checkSecretKey={node.kind === "column" && node.fieldName === "key" ? checkSecretKey : undefined}
        />
      </div>,
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
  const [checkingAiKey, setCheckingAiKey] = useState(false);
  const [aiKeyCheck, setAiKeyCheck] = useState<{ ok: boolean; message: string } | undefined>();

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
  const requiredAction = type ? (isSingleton ? "setting" : isNew ? "create" : "view") : null;
  const canEdit = !!type && canAccess(type.id, isSingleton ? "setting" : isNew ? "create" : "update");
  const canDelete = !!type && !isSingleton && !isNew && canAccess(type.id, "delete");
  const showLoading = useDelayedLoading(!type || value === null);

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
    if (!type || !entriesApi || !requiredAction || !canAccess(type.id, requiredAction)) return;
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
  }, [type, id, requiredAction]);

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
    if (typeSlug === "aiKey" && fieldName === "key") setAiKeyCheck(undefined);
    setValue((current) =>
      current ? { ...current, [fieldName]: fieldValue } : current,
    );
    // mục 6 (status/continue.md): a live "here's what the user is typing"
    // signal for an AI feature/plugin outside this bundle - see
    // `field-events.ts`'s own doc comment. Fires for every top-level field
    // change regardless of source (typing, `SlugField`'s derived slug, the
    // `dry:field-set` listener below) - a listener can't tell those apart,
    // same as it can't for a real user's own edit.
    dispatchFieldInput(fieldName, fieldValue, { typeSlug, entryId });
  }

  async function handleCheckAiKey() {
    if (typeSlug !== "aiKey" || !value) return;
    const key = typeof value.key === "string" ? value.key.trim() : "";
    const provider = typeof value.provider === "string" ? value.provider : "";
    const model = typeof value.model === "string" ? value.model.trim() : "";
    const url = typeof value.url === "string" ? value.url.trim() : "";
    if (!key || !provider || !model) {
      setAiKeyCheck({ ok: false, message: "Enter provider, model, and key first." });
      return;
    }
    setCheckingAiKey(true);
    setAiKeyCheck(undefined);
    try {
      const response = await fetch(`${path}/api/ai/check`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider, key, model, url }),
      });
      const body = await response.json() as { ok?: boolean; message?: string };
      setAiKeyCheck({
        ok: response.ok && body.ok === true,
        message: body.message ?? (response.ok ? "AI key is valid." : "AI key check failed."),
      });
    } catch (error) {
      setAiKeyCheck({ ok: false, message: error instanceof Error ? error.message : "AI key check failed." });
    } finally {
      setCheckingAiKey(false);
    }
  }

  // The other direction - an outside listener drives this form by
  // dispatching `dry:field-set`, applied exactly like the user typing into
  // that field would. `name` may be a plain top-level field name OR a
  // dotted/indexed path reaching into a `component-repeat` array item (see
  // `field-path.ts`'s own doc comment, e.g. `"data.0.name.label"`) -
  // `setValueAtPath` handles both the same way a plain name degenerates to
  // the exact top-level spread `updateFieldValue` itself still uses for
  // every real field's own `onChange` (which only ever passes a plain name,
  // never a path, so it's left as its own simpler function rather than
  // routed through path-parsing on every keystroke). The `dry:field-input`
  // echo reports the top-level field name either way, since that's the only
  // granularity `FieldInputEventDetail` (and `?_field=`/`scrollToField`)
  // understand - a nested write still surfaces as "this top-level field
  // changed" to an outside listener, just like a real user editing a nested
  // field through the UI would. Known limitation, same spirit as this
  // event system's original top-level-only scoping: if the targeted
  // `component-repeat` item is currently open in its own edit dialog
  // (`ComponentField.tsx`), the write lands in `value` correctly but the
  // dialog's own local draft won't pick it up live until closed/reopened.
  function applyFieldSet(path: string, fieldValue: unknown) {
    setValue((current) => (current ? setValueAtPath(current, path, fieldValue) : current));
    dispatchFieldInput(path.split(".", 1)[0]!, fieldValue, { typeSlug, entryId });
  }
  // Re-subscribes on `typeSlug`/`entryId` change (not just `[]`) so the
  // closure `applyFieldSet` dispatches through never reports a stale
  // `entryId` (e.g. right after a new entry's first save).
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `applyFieldSet` isn't memoized; typeSlug/entryId are its only free variables that matter here
  useEffect(() => listenForFieldSet(applyFieldSet), [typeSlug, entryId]);

  // `?_field=` deep link - once the fields have actually rendered
  // (`value !== null`), scroll straight to the one named in the URL and
  // flash its outline. `scrollField` itself never changes without a
  // navigation, but `value` flips from `null` exactly once per load - that's
  // the real "fields are on screen now" signal this effect waits for.
  const [scrollField] = useParam("_field");
  useEffect(() => {
    if (!scrollField || value === null) return;
    scrollToField(scrollField);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only when the field list actually (re)appears, not on every keystroke that changes `value`'s contents
  }, [scrollField, value === null]);

  async function handleSave() {
    if (!type || !entriesApi || !value) return;
    setFieldErrors({});

    // Confirm-password mismatches only ever exist client-side - `confirm` never
    // reaches the server - so this is the one pre-submit check the editor runs,
    // ahead of the usual "just submit and surface whatever the server rejects"
    // pattern below.
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
  if (!type) return showLoading ? <span class="hint">Loading…</span> : null;
  if (!requiredAction || !canAccess(type.id, requiredAction)) return <span class="error">You don't have permission to view this content.</span>;
  if (value === null) return showLoading ? <span class="hint">Loading…</span> : null;

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
  // `sortIndex` (see `system-fields.ts`'s `features.sortable`) is only ever
  // written by the List page's drag-reorder Save action, never manually
  // typed - same rationale as excluding `createdAt`/`updatedAt` above.
  const isSortIndexField = (node: EntryFieldNode) =>
    node.kind === "column" && node.fieldId === SYSTEM_FIELD_IDS.sortIndex;
  const editableNodes = nodes.filter((n) => !isTimestampField(n) && !isSortIndexField(n));
  const sideOf = (n: EntryFieldNode) =>
    resolveFieldSide(n.fieldId, n.kind !== "column", type.fieldSides);
  const leftFields = editableNodes.filter((n) => sideOf(n) === "left");
  const rightFields = editableNodes.filter((n) => sideOf(n) === "right");
  // If every field ends up on the right (none left), the wide `2fr` left
  // column would render empty and everything else would cram into the
  // narrow `1.75fr` right column - fall back to showing the right-side
  // fields in the left column instead, leaving the right column (danger
  // zone aside) empty rather than the reverse.
  const mainFields = leftFields.length > 0 ? leftFields : rightFields;
  const sideFields = leftFields.length > 0 ? rightFields : [];

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
          {canEdit && <button type="button" disabled={saving} aria-busy={saving} onClick={handleSave}>Save</button>}
        </div>
      </div>

      <fieldset disabled={!canEdit} class="content-entry-editor-form">
      <div class="content-entry-editor-grid">
        <div class="stack">
          {renderFieldNodes(
            mainFields,
            value,
            fieldErrors,
            updateFieldValue,
            allTypes,
            typeSlug === "aiKey" && isNew ? { onCheck: handleCheckAiKey, loading: checkingAiKey, result: aiKeyCheck } : undefined,
          )}
        </div>

        <div class="stack">
          {renderFieldNodes(
            sideFields,
            value,
            fieldErrors,
            updateFieldValue,
            allTypes,
            typeSlug === "aiKey" && isNew ? { onCheck: handleCheckAiKey, loading: checkingAiKey, result: aiKeyCheck } : undefined,
          )}

          {canDelete && (
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
      </fieldset>

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
