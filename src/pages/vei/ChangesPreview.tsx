import { useEffect, useState } from "preact/hooks";
import { useLocation } from "preact-iso";
const { path } = window.__DRY_CONFIG__;
import ConfirmDialog from "../../components/ConfirmDialog.js";
import { CheckIcon, EraserIcon } from "../../components/icons/index.js";
import { getAllEntryDraftRecords } from "../../content-types/entry-draft-db.js";
import { discardEntryDraft } from "../../content-types/entry-draft-store.js";
import { diffEntryValue, formatDiffValue, type EntryFieldDiff } from "../../content-types/entry-draft-diff.js";
import type { EntryValue } from "../../content-types/engine/entry-codec.js";
import { buildEntryFieldTree, flattenQueryableColumns, type EntryFieldNode } from "../../content-types/engine/entry-tree.js";
import { createContentEntriesApi } from "../../content-types/entries-http-api.js";
import { createContentTypesApi, listCached } from "../../content-types/http-api.js";
import { SYSTEM_FIELD_IDS } from "../../content-types/system-fields.js";
import type { ContentTypeDefinition } from "../../content-types/types.js";
import { canAccess } from "../../store/auth.js";
import { blankEntryValue } from "../content-entry-editor/blank-value.js";
import { useDocumentTitle } from "../page-common.js";
import { closeVeiDialog, isVeiFrame } from "./bridge.js";

interface ChangeEntry {
  key: string;
  typeSlug: string;
  entryId: string | null;
  typeLabel: string;
  label: string;
  isNew: boolean;
  href: string;
  diffs: EntryFieldDiff[];
  updatedAt: number;
}

// Same exclusions `ContentEntryEditor.tsx` applies before diffing/rendering a
// form - these fields are never user-edited, so a mismatch here would just be
// noise, not a real pending change.
const isTimestampField = (node: EntryFieldNode) =>
  node.kind === "column" &&
  (node.fieldId === SYSTEM_FIELD_IDS.createdAt || node.fieldId === SYSTEM_FIELD_IDS.updatedAt);
const isSortIndexField = (node: EntryFieldNode) =>
  node.kind === "column" && node.fieldId === SYSTEM_FIELD_IDS.sortIndex;

/** The entry's own admin editor URL, `?_vei=1` kept so navigating there stays
 * inside this same bare iframe instead of popping the full sidebar/topbar
 * chrome open inside the VEI dialog. */
function entryHref(type: ContentTypeDefinition, entryId: string | null): string {
  if (type.kind === "singleton") return `${path}/content/${type.name}?_vei=1`;
  if (entryId === null) return `${path}/content/${type.name}/new?_vei=1`;
  return `${path}/content/${type.name}/${entryId}?_vei=1`;
}

function entryLabel(type: ContentTypeDefinition, allTypes: ContentTypeDefinition[], value: EntryValue, entryId: string | null): string {
  if (type.kind === "singleton") return type.label;
  const titleColumn = flattenQueryableColumns(buildEntryFieldTree(type, allTypes))[0];
  const raw = titleColumn ? value[titleColumn.fieldName] : undefined;
  if (typeof raw === "string" && raw.trim()) return raw;
  return entryId ? `#${entryId}` : "New entry";
}

/**
 * Every unsaved entry/singleton draft site-wide, with a before/after diff
 * per changed field - the same information `ContentEntryEditor.tsx`'s own
 * "Preview" button shows for ONE entry, aggregated here across all of them.
 * Opened from the Visual Editing Interface's outer dock (`overlay.ts`), which
 * has no page of its own to scope "all changes" to - IndexedDB drafts aren't
 * scoped to a page either, so this reads every one of them regardless of
 * which page (or which VEI session) wrote it.
 */
export default function ChangesPreview() {
  const { route } = useLocation();
  const [changes, setChanges] = useState<ChangeEntry[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // The entry a "Reset" click is asking to discard - confirmed before it
  // actually runs, same as `ContentEntryEditor.tsx`'s own "Reset all" (this
  // IS that action, just reachable for any entry from this list instead of
  // only the one currently open in the editor).
  const [resetTarget, setResetTarget] = useState<ChangeEntry | null>(null);

  useDocumentTitle("Pending changes");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const typesApi = createContentTypesApi(`${path}/api/content-types`);
        // Cache-aware, not `typesApi.list()` - shares the same IndexedDB
        // entry `DryLayout`/`BuilderContentType` keep warm via `useFetch`,
        // so opening this from the VEI dock doesn't re-download the full
        // schema on top of whatever the page underneath already fetched.
        const [allTypes, records] = await Promise.all([listCached(typesApi), getAllEntryDraftRecords()]);
        const typeByName = new Map(allTypes.map((t) => [t.name, t] as const));

        const results = await Promise.all(
          records.map(async (record): Promise<ChangeEntry | null> => {
            const type = typeByName.get(record.typeSlug);
            if (!type || type.kind === "component") return null;
            const isSingleton = type.kind === "singleton";
            const requiredAction = isSingleton ? "setting" : record.entryId === null ? "create" : "update";
            if (!canAccess(type.id, requiredAction)) return null;

            const nodes = buildEntryFieldTree(type, allTypes);
            const editableNodes = nodes.filter((n) => !isTimestampField(n) && !isSortIndexField(n));
            const entriesApi = createContentEntriesApi(`${path}/api/content`, type.name);

            let original: EntryValue;
            try {
              if (isSingleton) {
                const entry = await entriesApi.getSingleton();
                original = entry?.value ?? blankEntryValue(editableNodes);
              } else if (record.entryId !== null) {
                original = (await entriesApi.get(record.entryId)).value;
              } else {
                original = blankEntryValue(editableNodes);
              }
            } catch {
              // The entry (or its whole type) was deleted server-side since
              // this draft was written - nothing left to preview it against.
              return null;
            }

            const diffs = diffEntryValue(original, record.value, editableNodes);
            if (diffs.length === 0) return null;

            return {
              key: record.key,
              typeSlug: record.typeSlug,
              entryId: record.entryId,
              typeLabel: type.label,
              label: entryLabel(type, allTypes, record.value, record.entryId),
              isNew: !isSingleton && record.entryId === null,
              href: entryHref(type, record.entryId),
              diffs,
              updatedAt: record.updatedAt,
            };
          }),
        );

        if (cancelled) return;
        setChanges(
          results
            .filter((r): r is ChangeEntry => r !== null)
            .sort((a, b) => b.updatedAt - a.updatedAt),
        );
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "Failed to load pending changes.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleReset(target: ChangeEntry): Promise<void> {
    await discardEntryDraft(target.typeSlug, target.entryId);
    setResetTarget(null);
    setChanges((current) => {
      const next = current?.filter((c) => c.key !== target.key) ?? current;
      // Nothing left to review - close the dialog instead of leaving it open
      // on the empty state, same as `ContentEntryEditor.tsx`'s own
      // `handleResetField`/`handleResetAll` do for the single-entry Preview
      // dialog. A no-op outside the VEI frame (`bridge.ts`), so this is safe
      // to always call rather than guarding on `isVeiFrame()` here too.
      if (next && next.length === 0) closeVeiDialog();
      return next;
    });
  }

  return (
    <>
      <div class="page-header">
        <div style={{ flex: 1 }}>
          <h1>Pending changes</h1>
          <p>Every unsaved edit across all entries and singletons.</p>
        </div>
        {isVeiFrame() && (
          <div class="row">
            <button type="button" class="outline" onClick={closeVeiDialog}>Close</button>
          </div>
        )}
      </div>

      {changes === null && !loadError && (
        <div class="empty"><progress class="circle" /><p>Loading pending changes…</p></div>
      )}
      {loadError && <span class="error">{loadError}</span>}
      {changes !== null && changes.length === 0 && (
        <div class="empty">
          <CheckIcon />
          <strong>No pending changes</strong>
          <small>Everything is saved.</small>
        </div>
      )}
      {changes !== null && changes.length > 0 && (
        <ul class="entry-preview-diff-list">
          {changes.map((change) => (
            <li key={change.key} class="entry-preview-diff-item stack">
              <div class="entry-preview-diff-item-head">
                <span class="row" style={{ alignItems: "baseline" }}>
                  <strong>{change.typeLabel}</strong>
                  <span class="hint">{change.label}</span>
                  {change.isNew && <span class="badge sm secondary">New</span>}
                </span>
                <span class="row">
                  <button type="button" class="ghost sm" onClick={() => route(change.href)}>
                    Open
                  </button>
                  <button type="button" class="ghost sm icon" title="Discard this entry's changes" onClick={() => setResetTarget(change)}>
                    <EraserIcon />
                  </button>
                </span>
              </div>
              <ul class="stack">
                {change.diffs.map((diff) => (
                  <li key={diff.fieldName} class="stack">
                    <span class="hint">{diff.label}</span>
                    <div class="entry-preview-diff-values">
                      <span class="entry-preview-diff-before">{formatDiffValue(diff.before)}</span>
                      <span class="entry-preview-diff-after">{formatDiffValue(diff.after)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={resetTarget !== null}
        title="Discard these changes?"
        message={
          <p>
            This reverts "{resetTarget?.label}" back to its last saved value.
            Unsaved edits will be lost.
          </p>
        }
        confirmLabel="Discard"
        destructive
        onConfirm={() => resetTarget && void handleReset(resetTarget)}
        onCancel={() => setResetTarget(null)}
      />
    </>
  );
}
