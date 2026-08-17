import { useState } from "preact/hooks";
import { useDialogSync } from "../../../hooks/list-nav.js";
import type { EntryDraftRecord } from "../../../content-types/entry-draft-db.js";
import type { ContentTypeDefinition } from "../../../content-types/types.js";
import { PreviewIcon, UndoIcon } from "../../../components/icons/index.js";
import EntryPreviewDialog from "../../content-entry-editor/EntryPreviewDialog.js";
import { createContentEntriesApi } from "../../../content-types/entries-http-api.js";
import { diffEntryValue, type EntryFieldDiff } from "../../../content-types/entry-draft-diff.js";
import { buildEntryFieldTree, type EntryFieldNode } from "../../../content-types/engine/entry-tree.js";
import { SYSTEM_FIELD_IDS } from "../../../content-types/system-fields.js";
import { blankEntryValue } from "../../content-entry-editor/blank-value.js";

export interface SaveProgress {
  percent: number;
  label: string;
}

export default function SavePreviewDialog(props: {
  open: boolean;
  dirtyPaths: string[];
  drafts: EntryDraftRecord[];
  allTypes: ContentTypeDefinition[];
  progress: SaveProgress | null;
  adminPath: string;
  onPreviewCode: (path: string) => void;
  onRevertCode: (path: string) => void;
  onRevertDraft: (draft: EntryDraftRecord) => void;
  onUpdateDraft: (draft: EntryDraftRecord, value: EntryDraftRecord["value"]) => void;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const dialogRef = useDialogSync(props.open, props.onClose);
  const [draftPreview, setDraftPreview] = useState<{ draft: EntryDraftRecord; diffs: EntryFieldDiff[] } | null>(null);
  const [previewLoadingKey, setPreviewLoadingKey] = useState<string | null>(null);
  const typeByName = new Map(props.allTypes.map((type) => [type.name, type] as const));
  const hasChanges = props.dirtyPaths.length > 0 || props.drafts.length > 0;

  async function openDraftPreview(draft: EntryDraftRecord) {
    const type = typeByName.get(draft.typeSlug);
    if (!type || type.kind === "component") return;
    setPreviewLoadingKey(draft.key);
    try {
      const nodes = buildEntryFieldTree(type, props.allTypes).filter((node: EntryFieldNode) =>
        !(node.kind === "column" && (
          node.fieldId === SYSTEM_FIELD_IDS.createdAt ||
          node.fieldId === SYSTEM_FIELD_IDS.updatedAt ||
          node.fieldId === SYSTEM_FIELD_IDS.sortIndex
        )),
      );
      const api = createContentEntriesApi(`${props.adminPath}/api/content`, type.name);
      const original = type.kind === "singleton"
        ? (await api.getSingleton())?.value ?? blankEntryValue(nodes)
        : draft.entryId === null
          ? blankEntryValue(nodes)
          : (await api.get(draft.entryId)).value;
      setDraftPreview({ draft, diffs: diffEntryValue(original, draft.value, nodes) });
    } finally {
      setPreviewLoadingKey(null);
    }
  }

  return (
    <dialog ref={dialogRef} class="lg page-builder-save-dialog" aria-label="Preview changes before saving">
      <header>
        <div>
          <strong class="dialog-title">Build &amp; publish</strong>
          <p class="hint">Commits the saved changes to git, then rebuilds and publishes every affected page.</p>
        </div>
      </header>
      <div class="under page-builder-save-dialog-body">
        <div class="page-builder-save-group">
          <div class="row"><strong>Code files</strong><span class="badge sm secondary">{props.dirtyPaths.length}</span></div>
          {props.dirtyPaths.length > 0 ? (
            <ul class="page-builder-save-list">
              {props.dirtyPaths.map((filePath) => (
                <li key={filePath}>
                  <div class="row">
                    <code>{filePath}</code><span class="spacer" />
                    <button type="button" class="ghost icon sm" title="Preview" onClick={() => props.onPreviewCode(filePath)}><PreviewIcon /></button>
                    <button type="button" class="ghost icon sm" title="Revert" onClick={() => props.onRevertCode(filePath)}><UndoIcon /></button>
                  </div>
                </li>
              ))}
            </ul>
          ) : <p class="hint">No code changes.</p>}
        </div>

        <div class="page-builder-save-group">
          <div class="row"><strong>Content entries</strong><span class="badge sm secondary">{props.drafts.length}</span></div>
          {props.drafts.length > 0 ? (
            <ul class="page-builder-save-list">
              {props.drafts.map((draft) => (
                <li key={draft.key}>
                  <div class="row">
                    <div><strong>{typeByName.get(draft.typeSlug)?.label ?? draft.typeSlug}</strong><div class="hint">{draft.entryId ?? "Singleton / new entry"}</div></div>
                    <span class="spacer" />
                    <button type="button" class="ghost icon sm" title="Preview" aria-busy={previewLoadingKey === draft.key} onClick={() => void openDraftPreview(draft)}><PreviewIcon /></button>
                    <button type="button" class="ghost icon sm" title="Revert" onClick={() => props.onRevertDraft(draft)}><UndoIcon /></button>
                  </div>
                </li>
              ))}
            </ul>
          ) : <p class="hint">No content changes.</p>}
        </div>

        {props.progress && (
          <div class="stack page-builder-save-progress" aria-live="polite">
            <div class="row"><strong>{props.progress.label}</strong><span class="spacer" /><span>{props.progress.percent}%</span></div>
            <progress value={props.progress.percent} max={100} />
          </div>
        )}
      </div>
      <footer>
        <button type="button" class="outline" disabled={props.progress !== null} onClick={props.onClose}>Cancel</button>
        <button type="button" disabled={!hasChanges || props.progress !== null} onClick={props.onConfirm}>Build &amp; publish</button>
      </footer>
      <EntryPreviewDialog
        open={draftPreview !== null}
        diffs={draftPreview?.diffs ?? []}
        onClose={() => setDraftPreview(null)}
        onResetField={(fieldName) => {
          if (!draftPreview) return;
          const diff = draftPreview.diffs.find((candidate) => candidate.fieldName === fieldName);
          if (!diff) return;
          const value = { ...draftPreview.draft.value, [fieldName]: diff.before };
          const nextDraft = { ...draftPreview.draft, value };
          const diffs = draftPreview.diffs.filter((candidate) => candidate.fieldName !== fieldName);
          if (diffs.length === 0) {
            // Reverting the final changed field means there is no draft
            // anymore. Persisting `value === original` as a draft leaves a
            // phantom Save item/Preview button and VEI override behind.
            props.onRevertDraft(draftPreview.draft);
            setDraftPreview(null);
          } else {
            props.onUpdateDraft(draftPreview.draft, value);
            setDraftPreview({ draft: nextDraft, diffs });
          }
        }}
        onRequestResetAll={() => {
          if (!draftPreview) return;
          props.onRevertDraft(draftPreview.draft);
          setDraftPreview(null);
        }}
      />
    </dialog>
  );
}
