import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
const { path } = window.__DRY_CONFIG__;
import ConfirmDialog from "../components/ConfirmDialog.js";
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
import { EntryMediaContext } from "./content-entry-editor/entry-media-context.js";
import { createHttpFileSource } from "../storage/http-source.js";
import { commitPendingAvatar, isPendingAvatarValue } from "../components/fields/AvatarField.js";
import { randomUUID } from "../lib/uuid.js";
import {
  ContentEntriesApiError,
  createContentEntriesApi,
} from "../content-types/entries-http-api.js";
import type { EntryValue } from "../content-types/engine/entry-codec.js";
import { findPasswordChangeErrors } from "../content-types/engine/entry-validate.js";
import {
  buildEntryFieldTree,
  type EntryColumnNode,
  type EntryFieldNode,
} from "../content-types/engine/entry-tree.js";
import { createContentTypesApi } from "../content-types/http-api.js";
import { supportsMagic } from "../content-types/permissions.js";
import {
  resolveFieldSide,
} from "../content-types/system-fields.js";
import type { ContentTypeDefinition } from "../content-types/types.js";
import { useParam } from "../hooks/useParam.js";
import { useDelayedLoading } from "../hooks/useDelayedLoading.js";
import { useFetch } from "../hooks/useFetch.js";
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
  dispatchFieldFocus,
  dispatchFieldInput,
  FIELD_ANCHOR_ATTR,
  listenForEntrySave,
  listenForFieldSet,
  scrollToField,
  takeEntrySaveRequest,
} from "./content-entry-editor/field-events.js";
import { closeVeiDialog, isVeiFrame } from "./content-entry-editor/builder-bridge.js";
import { rebuildAffectedPages } from "../page-components/rebuild-affected-pages.js";
import { showPublishStatus } from "../store/sync.js";
import { setValueAtPath } from "./content-entry-editor/field-path.js";
import { renderFieldNodes } from "./content-entry-editor/entry-fields-form.js";
import { editableEntryNodes } from "./content-entry-editor/editable-nodes.js";
import { useDocumentTitle, usePageHeaderActions } from "./page-common.js";
import { canAccess } from "../store/auth.js";

interface Props {
  typeSlug: string;
  /** Absent for a brand-new collection entry, or for a singleton (which has
   * no id of its own in the URL - see `ContentEntryList.tsx`). */
  id?: string;
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
  const aiKey = useAiKeySelection(true);
  const rewriteFnRef = useRef<RichTextRewriteFn | null>(null);

  const listFetcher = useCallback(
    (ifVersion: number | undefined, signal: AbortSignal) =>
      typesApi.listVersioned(ifVersion, signal),
    [typesApi],
  );
  // Same cache key `DryLayout`/`BuilderContentType`/`ContentEntryList` use -
  // a warm IndexedDB entry from any of those shows up here instantly instead
  // of refetching the whole schema on every navigation into this route.
  const { data: allTypes, error: typesFetchError } = useFetch<
    ContentTypeDefinition[]
  >("content-types:list", listFetcher);
  const typesList = allTypes ?? [];
  const [type, setType] = useState<ContentTypeDefinition | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** The entry AND its pending draft are both in `value` - not just "the
   * fetch resolved". Only read by `saveIfRequested` below. */
  const [entryLoaded, setEntryLoaded] = useState(false);

  const [value, setValue] = useState<EntryValue | null>(null);
  /** The same `value`, reachable without going through a render.
   *
   * `handleSave` below is re-created on every render, but the Save button
   * that calls it lives in the shared topbar (`usePageHeaderActions`), which
   * only receives the new one from an effect - and Preact runs effects after
   * paint, a frame or so behind the state update. A click landing inside that
   * window ran the PREVIOUS render's `handleSave`, which had captured the
   * previous `value` and saved it. Invisible while every field reported every
   * keystroke, since the last change was then many frames old by the time
   * anything could be clicked; a `RichTextField` deliberately settles its
   * value only once typing pauses (`VALUE_FLUSH_DELAY_MS`), which lands
   * squarely in that window - typing and immediately clicking Save wrote an
   * empty body. Reading through this ref is unaffected by which render's
   * closure is running. */
  const valueRef = useRef<EntryValue | null>(null);
  valueRef.current = value;
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
  // Both memoized on the values they actually derive from: this component
  // re-renders on every keystroke in every field (`updateFieldValue` below),
  // and more than once per keystroke once a child lifts state back up (a
  // RichText field's toolbar state does - see `editor-surface.tsx`). Re-
  // parsing and re-serializing the WHOLE entry - rich text HTML and all - on
  // each of those renders was pure waste: neither result can change unless
  // `value`/`initialSnapshot` themselves did.
  const originalValue: EntryValue | null = useMemo(
    () => (initialSnapshot !== null ? (JSON.parse(initialSnapshot) as EntryValue) : null),
    [initialSnapshot],
  );
  const isDirty = useMemo(
    () =>
      initialSnapshot !== null &&
      value !== null &&
      JSON.stringify(value) !== initialSnapshot,
    [value, initialSnapshot],
  );

  const entriesApi = useMemo(
    () =>
      type ? createContentEntriesApi(`${path}/api/content`, type.name) : null,
    [type],
  );
  const nodes: EntryFieldNode[] = useMemo(
    () => (type ? buildEntryFieldTree(type, typesList) : []),
    [type, typesList],
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
    () => (type ? editableEntryNodes(type, nodes) : []),
    [type, nodes],
  );
  // Same rationale as `originalValue`/`isDirty` above - a full field-by-field
  // diff of the entry has no business running on every render, only when one
  // of its three inputs changes.
  const previewDiffs = useMemo(
    () =>
      originalValue && value
        ? diffEntryValue(originalValue, value, editableNodes)
        : [],
    [originalValue, value, editableNodes],
  );

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
  // `supportsMagic` is the schema-level half of the same gate: configuration
  // types (`role`/`user`/`menu`/`redirect`/`aiKey`/the settings singletons)
  // have no Magic at all, and that has to be checked separately from the grant
  // - a Super Admin bypasses every grant, so the grant check alone would still
  // show them the bubble there.
  const canUseMagic = !!type && supportsMagic(type) && canAccess(type.id, "magic");
  // The RichText "Rewrite selection" button is a second entry point into
  // Magic, separate from the `<MagicChat>` bubble below - same `magic` grant
  // gates both, so `ready` (read by `AiRewriteButton` wherever it renders)
  // requires it too, not just a configured/reachable AI key. Declared here
  // (rather than up next to `aiKey`/`rewriteFnRef`) because it needs
  // `canUseMagic`, which needs `type` - see `status/role-system-permissions.md`.
  const rewriteApi = useMemo(
    () => ({
      ready: aiKey.ready && canUseMagic,
      requestRewrite: ((passage, instruction, inline, onDelta, signal) => {
        if (!rewriteFnRef.current) return Promise.reject(new Error("Magic is not ready yet."));
        return rewriteFnRef.current(passage, instruction, inline, onDelta, signal);
      }) as RichTextRewriteFn,
    }),
    [aiKey.ready, canUseMagic],
  );
  // Never inside VEI, regardless of permission - the entry being edited
  // there is whatever a live page's own marker points at (e.g. the `menu`
  // row a nav pulls its links from), and deleting it out from under the
  // page it's rendering into would break that page's layout with no undo.
  const canDelete =
    !!type && !isSingleton && !isNew && !veiFrame && canAccess(type.id, "delete");
  const showLoading = useDelayedLoading(!type || value === null);

  useEffect(() => {
    if (allTypes === undefined) return;
    const found = allTypes.find(
      (t) => t.name === typeSlug && t.kind !== "component",
    );
    if (!found) {
      setLoadError(`Content type "${typeSlug}" not found.`);
      return;
    }
    setType(found);
  }, [allTypes, typeSlug]);

  useEffect(() => {
    if (!typesFetchError) return;
    setLoadError(
      typesFetchError instanceof Error
        ? typesFetchError.message
        : "Failed to load content type.",
    );
  }, [typesFetchError]);

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
        const builtNodes = buildEntryFieldTree(type, typesList);
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
        // Set only here, after the draft has had its say - `value` is
        // briefly the server's own row in the render between the two
        // `setValue` calls above, and a VEI save that fired in that window
        // would faithfully save the pre-draft value and then discard the
        // draft that was about to replace it. See `saveIfRequested`.
        setEntryLoaded(true);
      } catch (error) {
        setLoadError(
          error instanceof Error ? error.message : "Failed to load entry.",
        );
      }
    })();
    // `typesList` deliberately excluded - it's only needed to resolve
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
  // topbar to move them to (`BuilderBridgeFrame.tsx` skips `DryLayout` entirely), so
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
    //
    // `draftEntryId`, NOT the loaded `entryId`: a singleton keys off `null`
    // everywhere this identifier is consumed (`entry-draft-store.ts`'s draft
    // slot, `dryVeiOverrideKey`, `dry-reader-http.ts`'s own override lookup,
    // which hardcodes `null` for `kind: "singleton"`). Reporting the row's
    // real id here instead made every singleton edit land under a key nothing
    // else ever looks up - found live: editing a singleton field through
    // Page Builder's visual editor queued the draft but the preview kept
    // rendering the old value, forever.
    dispatchFieldInput(fieldName, fieldValue, { typeSlug, entryId: draftEntryId });
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
      entryId: draftEntryId,
    });
  }
  // Re-subscribes on `typeSlug`/`entryId` change (not just `[]`) so the
  // closure `applyFieldSet` dispatches through is never stale. `entryId` is
  // no longer what it reports (`draftEntryId` is, see `updateFieldValue`),
  // but it still moves whenever the loaded entry does, so it remains the
  // right thing to re-subscribe on.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `applyFieldSet` isn't memoized; typeSlug/entryId are its only free variables that matter here
  useEffect(() => listenForFieldSet(applyFieldSet), [typeSlug, entryId]);

  // Broadcasts the EXACT field currently focused - the Visual Editing
  // Interface (`VeiEntryFrame.tsx`'s `vei:focus` relay) scrolls the
  // corresponding marked element on the public page into view and swaps its
  // baseline dashed outline for a solid one while it's the one actually
  // being worked on. `focusin`/`focusout` bubble (unlike `focus`/`blur`), so
  // one document-level pair covers every field without threading a handler
  // through each one.
  useEffect(() => {
    const fieldNameFor = (target: EventTarget | null): string | null => {
      if (!(target instanceof Element)) return null;
      const anchor = target.closest(`[${FIELD_ANCHOR_ATTR}]`);
      // The FULL composite path, unlike `dry:field-input`/`applyFieldSet`
      // above (which only ever report the top-level segment, since that's
      // all a VALUE write can address without also threading the rest of
      // `EntryValue`'s shape through). A nested `flatten` field's own
      // composite path ("hero.title", `FieldRenderer.tsx`'s `pathPrefix`)
      // matches a marker's `ref.path` exactly, so keeping it whole lets
      // the preview highlight the ONE field actually focused instead of
      // every marker under the same top-level component.
      return anchor?.getAttribute(FIELD_ANCHOR_ATTR) ?? null;
    };
    const onFocusIn = (event: FocusEvent) => {
      const name = fieldNameFor(event.target);
      if (name) dispatchFieldFocus(name, { typeSlug, entryId: draftEntryId });
    };
    const onFocusOut = (event: FocusEvent) => {
      // `relatedTarget` is what's ABOUT to gain focus - still inside the
      // SAME field (tabbing between two of its own controls) means nothing
      // changed; a `focusin` for a genuinely different field fires its own
      // event right after, so only report "nothing focused" when the next
      // stop isn't a field at all.
      if (fieldNameFor(event.relatedTarget) === null) dispatchFieldFocus(null, { typeSlug, entryId: draftEntryId });
    };
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, [typeSlug, entryId]);

  // `?_field=` deep link - once the fields have actually rendered
  // (`value !== null`), scroll straight to the one named in the URL and
  // flash its outline. `scrollField` itself never changes without a
  // navigation, but `value` flips from `null` exactly once per load - that's
  // the real "fields are on screen now" signal this effect waits for.
  //
  // `?_path=` (`VeiEntryFrame.tsx`'s `editorUrl`, only ever set alongside `_field`
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
    // `valueRef`, not the `value` this render closed over - see the ref's own
    // doc comment: the topbar's Save button can still be holding an earlier
    // render's `handleSave` when it fires.
    const current = valueRef.current;
    if (!type || !entriesApi || !current) return;
    setFieldErrors({});

    // Confirm-password mismatches only ever exist client-side - `confirm` never
    // reaches the server - so this is the one pre-submit check the editor runs,
    // ahead of the usual "just submit and surface whatever the server rejects"
    // pattern below.
    const passwordErrors = findPasswordChangeErrors(nodes, current);
    if (Object.keys(passwordErrors).length > 0) {
      setFieldErrors(passwordErrors);
      toast.add({ type: "error", title: "Fix the highlighted fields." });
      // Reported, not just returned: an outside driver (the VEI dock, via
      // `bridge.ts`) is waiting on `dry:entry-saved` to learn the outcome,
      // and a bare `return` here would leave it hanging until its own
      // 30s timeout instead of failing immediately.
      dispatchEntrySaved(false);
      return;
    }

    setSaving(true);
    let saved = false;
    try {
      // An `avatar` column (only ever `user`) holds a pending local `data:`
      // preview until now - see `AvatarField.tsx`'s own doc comment. Uploaded
      // here, right before the request actually goes out, not on pick.
      const avatarNode = nodes.find(
        (n): n is EntryColumnNode => n.kind === "column" && n.fieldType === "avatar",
      );
      const pendingAvatar =
        avatarNode && typeof current[avatarNode.fieldName] === "string"
          ? (current[avatarNode.fieldName] as string)
          : undefined;
      const payload =
        pendingAvatar && isPendingAvatarValue(pendingAvatar)
          ? {
              ...current,
              // `entryId` is null for a not-yet-created entry - falls back to
              // a one-off random id in that rare case (an avatar picked in
              // the same action that creates the row); every later edit
              // reuses the row's own stable `entryId`.
              [avatarNode!.fieldName]: await commitPendingAvatar(magicChatImageSource, pendingAvatar, entryId ?? randomUUID()),
            }
          : current;

      if (isSingleton) {
        const entry = await entriesApi.saveSingleton(payload);
        setValue(entry.value);
        setEntryId(entry.id);
        setInitialSnapshot(JSON.stringify(entry.value));
        await discardEntryDraft(typeSlug, draftEntryId);
        toast.add({ type: "success", title: `Saved "${type.label}".` });
      } else if (isNew) {
        await entriesApi.create(payload);
        await discardEntryDraft(typeSlug, draftEntryId);
        toast.add({ type: "success", title: `Created "${type.label}" entry.` });
        route(`${path}/content/${type.name}`);
      } else if (entryId) {
        const entry = await entriesApi.update(entryId, payload);
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
      // Background, best-effort: rebuilds whatever already-published static
      // pages depend on this content type, so an edit made here doesn't sit
      // stale until someone remembers to visit `/dry/page-build`. Skipped
      // inside a VEI dialog - `saveAll()` (`pages/page-components/page-builder/` (Page Builder's preview)) already
      // does this itself, batched across every entry it just saved; doing it
      // here too would rebuild the same pages twice.
      if (saved && type && !veiFrame) {
        void rebuildAffectedPages(path, type.name, typesList, (message) => {
          if (/failed|couldn't/i.test(message)) {
            toast.add({ title: message, type: "error" });
          } else {
            showPublishStatus(message, message.startsWith("Publishing "));
          }
        });
      }
    }
  }

  /**
   * Lets the Visual Editing Interface run this editor's own Save from
   * outside the frame (`plans/vei.md`). No dependency array on purpose:
   * `handleSave` closes over `value`/`entryId`/`type`, so re-subscribing
   * each render is what keeps the handler from saving a stale snapshot.
   *
   * The request routinely arrives BEFORE this component exists at all: the
   * overlay answers `vei:ready` the instant it sees it, and that comes from
   * `App.tsx`'s own mount effect, some 40ms before this route-split editor
   * has mounted and fetched its entry. So the gate is
   * `takeEntrySaveRequest()` (`field-events.ts`) rather than the event
   * alone - the same latch is checked on every render, which is what lets a
   * request that arrived too early still get carried out once there's
   * something to save, instead of vanishing and leaving the dock stuck on
   * "Saving ..." until its own 30s timeout.
   */
  function saveIfRequested(): void {
    // A load that failed will never become saveable, so answer the request
    // now rather than letting the caller wait out its own timeout.
    if (loadError) {
      if (takeEntrySaveRequest()) dispatchEntrySaved(false);
      return;
    }
    if (!entryLoaded || !type || !entriesApi || !value) return;
    if (!takeEntrySaveRequest()) return;
    void handleSave();
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- see above: the latest closure is the point
  useEffect(() => {
    saveIfRequested();
    return listenForEntrySave(saveIfRequested);
  });

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
      // The entry is gone server-side - a lingering unsaved draft for it
      // would otherwise resurface on next load (same reasoning as
      // `handleResetAll`'s own `discardEntryDraft` call above).
      void discardEntryDraft(typeSlug, draftEntryId);
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
  // Nothing to show on the right (no side fields, and no danger zone since
  // that's singleton/permission-gated) - drop the second column entirely
  // rather than reserving its width for an empty panel, which would cram
  // `mainFields` into the left ~60% of the page for no reason.
  const hasSideColumn = sideFields.length > 0 || canDelete;

  const entryMediaValue = type.features?.slug
    ? { collectionName: type.name, slug: typeof value.slug === "string" ? value.slug : null, isNew }
    : null;

  return (
    <RichTextRewriteContext.Provider value={rewriteApi}>
    <EntryMediaContext.Provider value={entryMediaValue}>
      {/* Outside the dialog, this same title/Cancel/Preview/Save row is
       * handed to DryLayout's topbar instead (`usePageHeaderActions` above)
       * - `BuilderBridgeFrame.tsx` skips `DryLayout` (and its topbar) entirely, so the
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
        <div
          class={`content-entry-editor-grid${hasSideColumn ? "" : " single-column"}`}
        >
          <div class="stack">
            {renderFieldNodes(
              mainFields,
              value,
              fieldErrors,
              updateFieldValue,
              typesList,
              revealPath,
              streamingFieldName,
              undefined,
              entryId,
            )}
          </div>

          {hasSideColumn && (
            <div class="stack">
              {renderFieldNodes(
                sideFields,
                value,
                fieldErrors,
                updateFieldValue,
                typesList,
                revealPath,
                streamingFieldName,
                undefined,
                entryId,
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
          )}
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
    </EntryMediaContext.Provider>
    </RichTextRewriteContext.Provider>
  );
}
