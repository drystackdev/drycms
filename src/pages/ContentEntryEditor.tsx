import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
const { path, aiMode } = window.__DRY_CONFIG__;
import ConfirmDialog from "../components/ConfirmDialog.js";
import SlugField from "../components/fields/SlugField.js";
import { toast } from "../components/Toast.js";
import {
  ArrowLeftIcon,
  EraserIcon,
  PreviewIcon,
  TrashIcon,
} from "../components/icons/index.js";
import MagicChat from "./content-entry-editor/MagicChat.js";
import { useAiKeySelection } from "../components/AiKeyPicker.js";
import { RichTextRewriteContext } from "../components/RichTextField/ai-rewrite-context.js";
import type { RichTextRewriteFn } from "../components/RichTextField/ai-rewrite-context.js";
import { createHttpFileSource } from "../storage/http-source.js";
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
import { diffEntryValue } from "../content-types/entry-draft-diff.js";
import {
  discardEntryDraft,
  loadEntryDraft,
  saveEntryDraft,
} from "../content-types/entry-draft-store.js";
import EntryPreviewDialog from "./content-entry-editor/EntryPreviewDialog.js";
import {
  dispatchEntrySaved,
  dispatchFieldInput,
  FIELD_ANCHOR_ATTR,
  listenForEntrySave,
  listenForFieldSet,
  scrollToField,
} from "./content-entry-editor/field-events.js";
import { closeVeiDialog, isVeiFrame } from "./vei/bridge.js";
import { setValueAtPath } from "./content-entry-editor/field-path.js";
import FieldRenderer, {
  type FieldRendererProps,
} from "./content-entry-editor/FieldRenderer.js";
import { useDocumentTitle, usePageHeaderActions } from "./page-common.js";
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
 * "Title & Slug" row (see `ContentTypeEditor.tsx`'s `systemFieldsForUi`). Per-
 * field reset lives in the Preview dialog instead of here - see
 * `status/entry-drafts.md`. */
function renderFieldNodes(
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
   * it mid-write. `null`/`undefined` outside a Magic Write run. */
  streamingFieldName?: string | null,
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
        disabled={streamingFieldName === node.fieldName}
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
        />
      </fieldset>,
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
  const magicChatImageSource = useMemo(
    () => createHttpFileSource(`${path}/api/storage`),
    [],
  );
  // `status/richtext-rewrite-shared-chat.md` - lifted out of `MagicChat.tsx`
  // so a RichText field's "Rewrite selection" button can see a live `ready`
  // answer (`rewriteApi.ready` below) as soon as this editor mounts, not
  // only after the admin has opened the Magic Chat bubble at least once.
  const aiKey = useAiKeySelection(aiMode === "server");
  const rewriteFnRef = useRef<RichTextRewriteFn | null>(null);

  const [allTypes, setAllTypes] = useState<ContentTypeDefinition[]>([]);
  const [type, setType] = useState<ContentTypeDefinition | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [value, setValue] = useState<EntryValue | null>(null);
  const [entryId, setEntryId] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showResetAllConfirm, setShowResetAllConfirm] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  // Magic (status/magic-chat.md, formerly Magic Write): the top-level field
  // name currently being streamed into, or `null` when no run is active -
  // `renderFieldNodes` disables that one field's `<fieldset>` while it's set.
  const [streamingFieldName, setStreamingFieldName] = useState<string | null>(
    null,
  );

  // Snapshot of `value` right after load, before any edits - see
  // `ContentTypeEditor.tsx`'s identical pattern for the rationale.
  const [initialSnapshot, setInitialSnapshot] = useState<string | null>(null);
  const originalValue: EntryValue | null =
    initialSnapshot !== null
      ? (JSON.parse(initialSnapshot) as EntryValue)
      : null;
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
  // `createdAt`/`updatedAt` are server-stamped on every save (see
  // `entry-codec.ts`'s `applyTimestamps`) regardless of what's submitted for
  // them - showing them as an editable date picker (especially pre-filled
  // with "now" on a not-yet-created entry) would be misleading, so they're
  // left out of the form entirely. The List page's columns already show
  // them. `sortIndex` (see `system-fields.ts`'s `features.sortable`) is only
  // ever written by the List page's drag-reorder Save action, never manually
  // typed - same rationale. Computed here (rather than after the loading
  // guards below, where the field-layout split further down still lives) so
  // `previewDiffs` - needed by `usePageHeaderActions` right below, a hook
  // that must run on every render - has something to diff against even
  // before `type`/`value` are confirmed loaded.
  const editableNodes = useMemo(
    () =>
      nodes.filter(
        (n) =>
          !(
            n.kind === "column" &&
            (n.fieldId === SYSTEM_FIELD_IDS.createdAt ||
              n.fieldId === SYSTEM_FIELD_IDS.updatedAt)
          ) &&
          !(n.kind === "column" && n.fieldId === SYSTEM_FIELD_IDS.sortIndex),
      ),
    [nodes],
  );
  const previewDiffs =
    originalValue && value
      ? diffEntryValue(originalValue, value, editableNodes)
      : [];

  const veiFrame = isVeiFrame();
  const isSingleton = type?.kind === "singleton";
  // IndexedDB draft key (see `content-types/entry-draft-store.ts`) - a
  // singleton and a brand-new not-yet-created entry both key off `null`
  // (there's exactly one draft slot for either), an existing entry off its
  // real `id`. Deliberately independent of the async-loaded `entryId` state
  // so it's stable from the very first render.
  const draftEntryId = isSingleton ? null : (id ?? null);
  const isNew = !isSingleton && !id;
  const requiredAction = type
    ? isSingleton
      ? "setting"
      : isNew
        ? "create"
        : "view"
    : null;
  const canEdit =
    !!type &&
    canAccess(type.id, isSingleton ? "setting" : isNew ? "create" : "update");
  // Magic's own gate, separate from `canEdit` above: an explicit, stored
  // `magic` grant (`content-types/permissions.ts`), not derived from
  // create/update/setting at request time - the Role editor only lets an
  // admin turn `magic` on once Create-or-Update (collection) / Setting
  // (singleton) is already granted, but the grant itself is what's checked
  // here and, authoritatively, server-side in `ai-magic-write.ts`.
  // Deliberately not folded into `canEdit` itself - that would also gate the
  // Save button/field editability. See `status/role-system-permissions.md`.
  const canUseMagic = !!type && canAccess(type.id, "magic");
  // The RichText "Rewrite selection" button is a second entry point into
  // Magic, separate from the `<MagicChat>` bubble below - same `magic` grant
  // gates both, so `ready` (read by `AiRewriteButton` wherever it renders)
  // requires it too, not just a configured/reachable AI key. Declared here
  // (rather than up next to `aiKey`/`rewriteFnRef`) because it needs
  // `canUseMagic`, which needs `type` - see `status/role-system-permissions.md`.
  const rewriteApi = useMemo(
    () =>
      aiMode === "server"
        ? {
            ready: aiKey.ready && canUseMagic,
            requestRewrite: ((passage, instruction, inline, onDelta, signal) => {
              if (!rewriteFnRef.current) return Promise.reject(new Error("Magic is not ready yet."));
              return rewriteFnRef.current(passage, instruction, inline, onDelta, signal);
            }) as RichTextRewriteFn,
          }
        : null,
    [aiKey.ready, canUseMagic],
  );
  const canDelete =
    !!type && !isSingleton && !isNew && canAccess(type.id, "delete");
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
    if (
      !type ||
      !entriesApi ||
      !requiredAction ||
      !canAccess(type.id, requiredAction)
    )
      return;
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
        // `initialSnapshot` above always reflects the server's own value -
        // a pending IndexedDB draft (if any) only overrides `value` itself,
        // so `isDirty`/reset/diff all keep comparing against the real
        // last-saved state, not the draft. See `status/entry-drafts.md`.
        const draft = await loadEntryDraft(
          typeSlug,
          type.kind === "singleton" ? null : (id ?? null),
        );
        if (draft) setValue(draft);
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

  // Autosaves every edit to IndexedDB (debounced inside `saveEntryDraft`)
  // while the entry is dirty, so a reload/crash/accidental-close doesn't
  // lose typed edits - see `status/entry-drafts.md`. Deliberately gated on
  // `isDirty` (not just `value !== null`): once the value matches what was
  // last saved again (Save succeeded, or Reset All), there's nothing left
  // to autosave and any earlier draft has already been discarded below.
  useEffect(() => {
    if (!isDirty || value === null) return;
    saveEntryDraft(typeSlug, draftEntryId, value);
  }, [value, isDirty, typeSlug, draftEntryId]);

  useDocumentTitle(
    type ? (isNew ? `New ${type.label}` : type.label) : "Content",
  );

  // Outside the VEI dialog, this entry's title/Cancel/Preview/Save move into
  // DryLayout's shared topbar instead of a local `.page-header` - see
  // `usePageHeaderActions`. Inside the dialog (`veiFrame`), there's no
  // topbar to move them to (`VeiFrame.tsx` skips `DryLayout` entirely), so
  // this stays `null` and the `.page-header` block further down (unchanged)
  // renders them locally exactly as before. `handleSave`/`saving` are
  // referenced before their own declarations below - safe, `function
  // handleSave` is hoisted, and `saving` is a `useState` declared near the
  // top of this component.
  usePageHeaderActions(
    !veiFrame && type ? (
      <>
        {!isSingleton && (
          <button
            type="button"
            class="icon ghost"
            onClick={() => route(`${path}/content/${type.name}`)}
          >
            <ArrowLeftIcon />
          </button>
        )}
        <div class="topbar-page-title">
          <strong>{isNew ? `New ${type.label}` : type.label}</strong>
          {type.description && <span class="hint"> - {type.description}</span>}
        </div>
        <span class="spacer" />
        {!isSingleton && (
          <button
            type="button"
            class="outline"
            onClick={() => route(`${path}/content/${type.name}`)}
          >
            Cancel
          </button>
        )}
        {!isNew && isDirty && (
          <button
            type="button"
            class="outline"
            onClick={() => setShowPreview(true)}
          >
            <PreviewIcon /> Preview
            <span class="badge sm secondary">{previewDiffs.length}</span>
          </button>
        )}
        {isNew && isDirty && (
          // A new, not-yet-saved entry has no "last saved value" for
          // `EntryPreviewDialog`'s diff to compare against (and that
          // dialog is unreachable here anyway - the Preview button right
          // above is hidden for `isNew`) - this reuses the SAME
          // `showResetAllConfirm`/`handleResetAll` plumbing that dialog's
          // own "Reset all" button drives, just from a standalone trigger
          // instead. `originalValue` is already the blank value computed
          // at mount for a new entry, so `handleResetAll` clears every
          // field back to empty, same effect a "Clear all" needs.
          <button
            type="button"
            class="outline"
            onClick={() => setShowResetAllConfirm(true)}
          >
            <EraserIcon /> Clear all
          </button>
        )}
        {canEdit && (
          <button
            type="button"
            disabled={saving}
            aria-busy={saving}
            onClick={handleSave}
          >
            Save
          </button>
        )}
      </>
    ) : null,
  );

  function updateFieldValue(fieldName: string, fieldValue: unknown) {
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
    setValue((current) =>
      current ? setValueAtPath(current, path, fieldValue) : current,
    );
    dispatchFieldInput(path.split(".", 1)[0]!, fieldValue, {
      typeSlug,
      entryId,
    });
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
  //
  // `?_path=` (`overlay.ts`'s `editorUrl`, only ever set alongside `_field`
  // and only when the click landed past a top-level field) reaches further
  // than a top-level field can highlight on its own - `revealPath` below
  // threads it through `renderFieldNodes` -> `FieldRenderer`, which now gives
  // every nested `flatten` child its own composite `data-field-name`
  // (`"hero.title"`, `FieldRenderer.tsx`'s `pathPrefix`), and separately into
  // `ComponentField.tsx`'s `revealIndex`/`revealField`, which opens a
  // `component-repeat` item's own dialog (otherwise unreachable - its fields
  // don't exist in the DOM until then) and flashes the field inside it.
  //
  // This effect always flashes the top-level field first, then - if
  // `scrollPath` is more specific - flashes again at the deeper anchor,
  // which wins by running last (`highlightAnchor` cancels the previous
  // box). The second call is a no-op wherever the deeper anchor doesn't
  // exist yet (a `component-repeat` item, whose fields only render once
  // `ComponentField.tsx` opens its dialog), leaving the top-level flash as
  // the only highlight there, same as before.
  const [scrollField] = useParam("_field");
  const [scrollPath] = useParam("_path");
  const revealPath = scrollPath
    ? scrollPath.split(".")
    : scrollField
      ? [scrollField]
      : undefined;
  useEffect(() => {
    if (!scrollField || value === null) return;
    scrollToField(scrollField);
    if (scrollPath && scrollPath !== scrollField) scrollToField(scrollPath);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run only when the field list actually (re)appears, not on every keystroke that changes `value`'s contents
  }, [scrollField, scrollPath, value === null]);

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
    let saved = false;
    try {
      if (isSingleton) {
        const entry = await entriesApi.saveSingleton(value);
        setValue(entry.value);
        setEntryId(entry.id);
        setInitialSnapshot(JSON.stringify(entry.value));
        await discardEntryDraft(typeSlug, draftEntryId);
        toast.add({ type: "success", title: `Saved "${type.label}".` });
      } else if (isNew) {
        await entriesApi.create(value);
        await discardEntryDraft(typeSlug, draftEntryId);
        toast.add({ type: "success", title: `Created "${type.label}" entry.` });
        route(`${path}/content/${type.name}`);
      } else if (entryId) {
        const entry = await entriesApi.update(entryId, value);
        setValue(entry.value);
        setInitialSnapshot(JSON.stringify(entry.value));
        await discardEntryDraft(typeSlug, draftEntryId);
        toast.add({ type: "success", title: `Saved "${type.label}" entry.` });
        // Inside the VEI dialog there's no list to go back to - the frame is
        // about to be reused for the next entry (or closed).
        if (!veiFrame) route(`${path}/content/${type.name}`);
      }
      saved = true;
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
      dispatchEntrySaved(saved);
    }
  }

  // Lets the Visual Editing Interface run this editor's own Save from
  // outside the frame (`plans/vei.md`). No dependency array on purpose:
  // `handleSave` closes over `value`/`entryId`/`type`, so re-subscribing
  // each render is what keeps the handler from saving a stale snapshot.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- see above: the latest closure is the point
  useEffect(() => listenForEntrySave(() => void handleSave()));

  // Both reset actions live inside the Preview dialog (`EntryPreviewDialog`),
  // not on the field rows themselves - see `status/entry-drafts.md`.
  function handleResetField(fieldName: string) {
    if (!originalValue) return;
    updateFieldValue(fieldName, originalValue[fieldName]);
    // Nothing left to review once this was the last remaining change - close
    // the dialog instead of leaving it open on an empty list. `previewDiffs`
    // here is the PRE-reset diff (this render's closure), so `<= 1` means
    // this field was the only one left.
    if (previewDiffs.length <= 1) {
      setShowPreview(false);
      // The value is about to match what's last saved again, so `isDirty`
      // goes false and the autosave effect above never fires to update the
      // draft - discard it here instead, same as `handleResetAll` already
      // does, or the stale pre-reset draft lingers in IndexedDB forever.
      void discardEntryDraft(typeSlug, draftEntryId);
    }
  }

  function handleResetAll() {
    if (!originalValue) return;
    setValue(originalValue);
    setFieldErrors({});
    setShowResetAllConfirm(false);
    // Nothing left to review once every field is back to its saved value -
    // close the Preview dialog too instead of leaving it open on its empty
    // state.
    setShowPreview(false);
    // The value now matches what's last saved, so there's nothing left to
    // recover from a draft - discard it rather than leave a no-op draft
    // behind (this is also what clears the nav dot/badge and table dot
    // right away, without waiting for the autosave effect to notice).
    void discardEntryDraft(typeSlug, draftEntryId);
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
  if (!requiredAction || !canAccess(type.id, requiredAction))
    return (
      <span class="error">You don't have permission to view this content.</span>
    );
  if (value === null)
    return showLoading ? <span class="hint">Loading…</span> : null;

  const backTo = `${path}/content/${type.name}`;
  const sideOf = (n: EntryFieldNode) =>
    resolveFieldSide(n.fieldId, n.kind !== "column", type.fieldSides);
  const leftFields = editableNodes.filter((n) => sideOf(n) === "left");
  const rightFields = editableNodes.filter((n) => sideOf(n) === "right");
  // If every field ends up on the right (none left), the wide `2fr` left
  // column would render empty and everything else would cram into the
  // narrow `1.25fr` right column - fall back to showing the right-side
  // fields in the left column instead, leaving the right column (danger
  // zone aside) empty rather than the reverse.
  const mainFields = leftFields.length > 0 ? leftFields : rightFields;
  const sideFields = leftFields.length > 0 ? rightFields : [];

  return (
    <RichTextRewriteContext.Provider value={rewriteApi}>
      {/* Outside the dialog, this same title/Cancel/Preview/Save row is
       * handed to DryLayout's topbar instead (`usePageHeaderActions` above)
       * - `VeiFrame.tsx` skips `DryLayout` (and its topbar) entirely, so the
       * dialog keeps its own local header exactly as it always has. */}
      {veiFrame && (
        <div class="page-header">
          {/* No list to go back to inside the VEI dialog - same reasoning as
           * the Cancel button below not navigating there either. */}
          {!isSingleton && !veiFrame && (
            <button
              type="button"
              class="icon ghost"
              onClick={() => route(backTo)}
            >
              <ArrowLeftIcon />
            </button>
          )}
          <div style={{ flex: 1 }}>
            <h1>{isNew ? `New ${type.label}` : type.label}</h1>
            <p>{type.description || `Edit this ${type.kind}'s content.`}</p>
          </div>
          <div class="row">
            {/* A singleton has no list to go "back" to, so this button was
             * previously collection-only - the Visual Editing Interface
             * changes what Cancel MEANS (close the dialog, not navigate) and
             * that applies just as much to a singleton opened from the public
             * site (`plans/vei.md`), so it's shown for both there. */}
            {(!isSingleton || veiFrame) && (
              <button
                type="button"
                class="outline"
                onClick={() => (veiFrame ? closeVeiDialog() : route(backTo))}
              >
                Cancel
              </button>
            )}
            {!isNew && isDirty && (
              <button
                type="button"
                class="outline"
                onClick={() => setShowPreview(true)}
              >
                <PreviewIcon /> Preview
                <span class="badge sm secondary">{previewDiffs.length}</span>
              </button>
            )}
            {isNew && isDirty && (
              <button
                type="button"
                class="outline"
                onClick={() => setShowResetAllConfirm(true)}
              >
                <EraserIcon /> Clear all
              </button>
            )}
            {/* Redundant inside the VEI dialog - the overlay's own dock Save
             * button drives this entry's `handleSave` too (via `dry:entry-save`,
             * `listenForEntrySave` above), but scoped across every marked entry
             * on the page rather than just this one. */}
            {canEdit && !veiFrame && (
              <button
                type="button"
                disabled={saving}
                aria-busy={saving}
                onClick={handleSave}
              >
                Save
              </button>
            )}
          </div>
        </div>
      )}

      <fieldset disabled={!canEdit} class="content-entry-editor-form">
        <div class="content-entry-editor-grid">
          <div class="stack">
            {renderFieldNodes(
              mainFields,
              value,
              fieldErrors,
              updateFieldValue,
              allTypes,
              revealPath,
              streamingFieldName,
            )}
          </div>

          <div class="stack">
            {renderFieldNodes(
              sideFields,
              value,
              fieldErrors,
              updateFieldValue,
              allTypes,
              revealPath,
              streamingFieldName,
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
        open={showResetAllConfirm}
        title={isNew ? "Clear all fields?" : "Reset all changes?"}
        message={
          <p>
            {isNew
              ? "This clears every field back to empty. Everything you've typed will be lost."
              : "This reverts every field back to the last saved value. Unsaved edits will be lost."}
          </p>
        }
        confirmLabel={isNew ? "Clear all" : "Reset all"}
        destructive
        onConfirm={handleResetAll}
        onCancel={() => setShowResetAllConfirm(false)}
      />

      <EntryPreviewDialog
        open={showPreview}
        diffs={previewDiffs}
        onClose={() => setShowPreview(false)}
        onResetField={handleResetField}
        onRequestResetAll={() => setShowResetAllConfirm(true)}
      />

      {aiMode === "server" && (
        <MagicChat
          typeSlug={typeSlug}
          entryId={entryId}
          nodes={editableNodes}
          value={value}
          updateFieldValue={updateFieldValue}
          onStreamingFieldChange={setStreamingFieldName}
          source={magicChatImageSource}
          canUse={canUseMagic}
          veiFrame={veiFrame}
          aiKey={aiKey}
          rewriteFnRef={rewriteFnRef}
        />
      )}
    </RichTextRewriteContext.Provider>
  );
}
