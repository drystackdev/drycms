import { useEffect, useState } from "preact/hooks";
const { path } = window.__DRY_CONFIG__;
import { useDialogSync } from "../../hooks/list-nav.js";
import { useOverlayScrollbars } from "../../hooks/overlayscrollbars.js";
import { toast } from "../../components/Toast.js";
import ConfirmDialog from "../../components/ConfirmDialog.js";
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  UndoIcon,
  UploadIcon,
  XCircleIcon,
  XIcon,
} from "../../components/icons/index.js";
import { createContentTypesApi, type BatchItemResult } from "../../content-types/http-api.js";
import { describeDestructiveChange, diffContentType } from "../../content-types/draft-diff.js";
import {
  discardDraft,
  discardDrafts,
  drafts,
  deleteAiContentTypeDraftOnServer,
  type DraftEntry,
} from "../../content-types/draft-store.js";
import { SparkleIcon } from "../../components/AiSparkleIcon.js";
import { bumpContentTypesVersion } from "../../store/content-types.js";
import type { ContentTypeDefinition, ContentTypeKind } from "../../content-types/types.js";

export interface ApplyBuildDialogProps {
  open: boolean;
  /** When set, review/apply only this content type's pending draft. */
  contentTypeId?: string;
  /** All non-`hidden` content types currently live on the server, across
   * every kind - used to diff each pending draft against. */
  liveDefinitions: ContentTypeDefinition[];
  onClose: () => void;
  /** Called once after an apply attempt writes ANYTHING (even a partial
   * failure - whatever succeeded is already live) - `liveDefinitions` comes
   * from the parent's own `useFetch()`, which has no other way to learn the
   * server changed since this dialog applies without navigating/remounting
   * the list page (unlike the old per-type editor Save, which always routed
   * back to the list and so always remounted it). */
  onApplied?: () => void;
}

type Stage = "review" | "checking" | "checked" | "applying" | "applied";

const KIND_LABELS: Record<ContentTypeKind, string> = {
  collection: "Collection",
  singleton: "Single",
  component: "Component",
};

const api = createContentTypesApi(`${path}/api/content-types`);

/**
 * The "Apply and build" flow (see `status/content-type-staged-apply.md`) -
 * reviews every pending draft (all 3 kinds together) and dry-runs the
 * combined migration before ever writing to the live schema:
 *
 * 1. `review` - a client-only diff of each pending draft against its live
 *    definition (or "New" if it doesn't exist yet). No server call.
 * 2. `checking` -> `checked` - `POST .../content-types` with `mode: "plan"`:
 *    every draft is validated and dry-run planned (see `routes/content-types
 *    .ts`'s `performSave`) - real errors (naming collisions, a stale version
 *    because someone else edited it meanwhile, protected-field violations)
 *    surface here, and the real destructive-change summary comes back too,
 *    all without touching the database.
 * 3. `applying` -> `applied` - `mode: "apply"`: the same drafts, actually
 *    written, sequentially, stopping at the first failure. Whatever
 *    succeeded is discarded from the local draft store; whatever's left
 *    stays pending for a retry.
 */
export default function ApplyBuildDialog({
  open,
  contentTypeId,
  liveDefinitions,
  onClose,
  onApplied,
}: ApplyBuildDialogProps) {
  const ref = useDialogSync(open, onClose);
  const { ref: bodyScroll } = useOverlayScrollbars<HTMLDivElement>([open]);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  const [stage, setStage] = useState<Stage>("review");
  const [items, setItems] = useState<DraftEntry[]>([]);
  const [liveSnapshot, setLiveSnapshot] = useState<ContentTypeDefinition[]>([]);
  const [planResults, setPlanResults] = useState<BatchItemResult[] | null>(null);
  const [applyResults, setApplyResults] = useState<BatchItemResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetItemId, setResetItemId] = useState<string | null>(null);
  const [resetAllConfirm, setResetAllConfirm] = useState(false);

  // Snapshot the pending drafts (AND what's currently live) the moment the
  // dialog opens - one review/build/apply pass diffs against a fixed
  // baseline throughout, even once `onApplied()` below tells the parent to
  // reload `liveDefinitions` mid-dialog: without this snapshot, an applied
  // item's own diff would recompute against its own just-written live copy
  // and collapse to "no changes" right as the success screen appears.
  useEffect(() => {
    if (!open) return;
    setStage("review");
    setPlanResults(null);
    setApplyResults(null);
    setError(null);
    const pending = Object.values(drafts.value);
    setItems(
      contentTypeId
        ? pending.filter((entry) => entry.definition.id === contentTypeId)
        : pending,
    );
    setLiveSnapshot(liveDefinitions);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentionally only re-snapshots when the dialog or selected row changes, not on every `liveDefinitions` identity change (e.g. the post-apply reload this dialog itself triggers).
  }, [open, contentTypeId]);

  const diffs = items.map((entry) => ({
    entry,
    diff: diffContentType(liveSnapshot.find((d) => d.id === entry.definition.id), entry.definition),
  }));

  const busy = stage === "checking" || stage === "applying";

  async function runPlan() {
    setStage("checking");
    setError(null);
    try {
      const response = await api.planBatch(items.map((entry) => entry.definition));
      setPlanResults(response.results);
      const plannedDestructive = response.results.some(
        (result) => result.ok && (result.destructiveSummary?.length ?? 0) > 0,
      );
      setStage("checked");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to check pending changes.");
      setStage("review");
    }
  }

  async function runApply() {
    setStage("applying");
    setError(null);
    try {
      const response = await api.applyBatch(items.map((entry) => entry.definition));
      setApplyResults(response.results);
      const succeededIds = response.results.filter((r) => r.ok).map((r) => r.id);
      discardDrafts(succeededIds);
      // A succeeded AI-proposed draft is now live - its server-side staging
      // copy (`ai-content-type-drafts.ts`) is no longer pending review, so
      // clear it too, same as any other resolved AI draft.
      for (const id of succeededIds) {
        const entry = items.find((item) => item.definition.id === id);
        if (entry?.source === "ai") void deleteAiContentTypeDraftOnServer(id);
      }
      const allOk = response.results.length === items.length && response.results.every((r) => r.ok);
      setStage("applied");
      if (succeededIds.length > 0) {
        bumpContentTypesVersion();
        onApplied?.();
      }
      if (allOk) {
        toast.add({ type: "success", title: "Applied and built successfully." });
        onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to apply pending changes.");
      setStage("checked");
    }
  }

  function handleClose() {
    if (busy) return;
    onClose();
  }

  // Removing an item mid-review invalidates any plan/apply results already
  // fetched for the OTHER remaining items too (the "no conflicts"/"loses
  // data" banner above summarizes the whole batch) - simplest to drop back
  // to `review` and make the admin re-check rather than try to patch a
  // partial result set.
  function resetItemsState(remaining: DraftEntry[]) {
    setItems(remaining);
    setStage("review");
    setPlanResults(null);
    setApplyResults(null);
    setError(null);
  }

  function handleResetItem() {
    if (!resetItemId) return;
    const entry = items.find((item) => item.definition.id === resetItemId);
    discardDraft(resetItemId);
    if (entry?.source === "ai") void deleteAiContentTypeDraftOnServer(resetItemId);
    resetItemsState(items.filter((entry) => entry.definition.id !== resetItemId));
    setResetItemId(null);
  }

  function handleResetAll() {
    discardDrafts(items.map((entry) => entry.definition.id));
    for (const entry of items) {
      if (entry.source === "ai") void deleteAiContentTypeDraftOnServer(entry.definition.id);
    }
    resetItemsState([]);
    setResetAllConfirm(false);
  }

  const resetTarget = items.find((entry) => entry.definition.id === resetItemId);
  // Once the batch has actually been applied, results are final - resetting
  // would either no-op (already-succeeded items are gone from the draft
  // store) or discard a failure the admin may still want to retry, so both
  // reset actions are only offered before/while reviewing.
  const canReset = !busy && stage !== "applied";

  const hasPlanErrors = (planResults ?? []).some((r) => !r.ok);
  const hasDestructive = (planResults ?? []).some((r) => (r.destructiveSummary?.length ?? 0) > 0);
  const applyAllOk = applyResults !== null && applyResults.length === items.length && applyResults.every((r) => r.ok);

  const resultsToShow = applyResults ?? planResults;

  return (
    <>
      <dialog ref={ref} class="lg apply-build-dialog" aria-label="Apply and build">
        {open && (
          <>
            <header class="row justify-between apply-build-header" style={{ flexWrap: "nowrap" }}>
              <div class="spacer apply-build-intro" style={{ minWidth: 0 }}>
                <p><strong>Apply and build</strong></p>
                <p>Review the pending changes before publishing them to the live schema.</p>
              </div>
              <button type="button" class="icon ghost" onClick={handleClose} disabled={busy}>
                <XIcon />
              </button>
            </header>

            {stage === "checked" && !hasPlanErrors && (
              <div
                class={`alert ${hasDestructive ? "warning" : "success"}`}
                style={{ marginBlock: "0 1rem" }}
              >
                {hasDestructive ? <AlertTriangleIcon /> : <CheckCircleIcon />}
                <h4>{hasDestructive ? "This will lose data" : "No conflicts found"}</h4>
                <p>
                  {hasDestructive
                    ? "Some changes drop columns or tables - review the warnings above before applying."
                    : "Ready to apply - this will run the migration on the live schema."}
                </p>
              </div>
            )}

            <div class="under apply-build-body" ref={bodyScroll}>
              <div class="apply-build-scroll-content">
              {items.length === 0 ? (
                <div class="apply-build-empty">
                  <CheckCircleIcon />
                  <strong>No pending changes</strong>
                  <span class="hint">Everything is already up to date.</span>
                </div>
              ) : (
                <div class="row justify-between align-start">
                  <div class="apply-build-summary">
                    <strong>{items.length} pending change{items.length === 1 ? "" : "s"}</strong>
                    <span class="hint">Review each content type below.</span>
                  </div>
                  <button
                    type="button"
                    class="sm outline"
                    disabled={!canReset}
                    onClick={() => setResetAllConfirm(true)}
                  >
                    <UndoIcon /> Reset all
                  </button>
                </div>
              )}

              <ul class="content-type-list">
                {diffs.map(({ entry, diff }) => {
                  const result = resultsToShow?.find((r) => r.id === entry.definition.id);
                  return (
                    <li
                      key={entry.definition.id}
                      class="content-type-list-item apply-build-change stack"
                      style={{ gap: "0.375rem", alignItems: "stretch" }}
                    >
                      <span class="row justify-between" style={{ gap: "0.375rem" }}>
                        <span class="row" style={{ gap: "0.375rem" }}>
                          <strong>{entry.definition.label || entry.definition.name || "(untitled)"}</strong>
                          <span class="badge sm secondary">{KIND_LABELS[entry.definition.kind]}</span>
                          {diff.isNew && <span class="badge sm info">New</span>}
                          {entry.source === "ai" && (
                            <span class="badge sm" data-tooltip="Proposed by an MCP client">
                              <SparkleIcon /> AI
                            </span>
                          )}
                        </span>
                        <button
                          type="button"
                          class="ghost icon sm"
                          aria-label={`Reset change to "${entry.definition.label || entry.definition.name || "this content type"}"`}
                          data-tooltip="Reset"
                          disabled={!canReset}
                          onClick={() => setResetItemId(entry.definition.id)}
                        >
                          <UndoIcon />
                        </button>
                      </span>

                      {diff.fieldChanges.length === 0 && diff.featureChanges.length === 0 && (
                        <p class="hint">No field changes.</p>
                      )}
                      {diff.fieldChanges.length > 0 && (
                        <ul class="hint" style={{ margin: 0, paddingInlineStart: "1.25rem" }}>
                          {diff.fieldChanges.map((change) => (
                            <li key={change.fieldId}>
                              {change.kind === "added" && `Added "${change.label}" (${change.typeLabel})`}
                              {change.kind === "removed" && `Removed "${change.label}" (${change.typeLabel})`}
                              {change.kind === "changed" && `Changed "${change.label}" (${change.typeLabel})`}
                            </li>
                          ))}
                        </ul>
                      )}
                      {diff.featureChanges.length > 0 && (
                        <ul class="hint" style={{ margin: 0, paddingInlineStart: "1.25rem" }}>
                          {diff.featureChanges.map((change) => (
                            <li key={change.key}>
                              {change.enabled ? "Enabled" : "Disabled"} feature "{change.key}"
                            </li>
                          ))}
                        </ul>
                      )}

                      {result && !result.ok && <p class="error">{result.error}</p>}
                      {result?.ok && result.destructiveSummary && result.destructiveSummary.length > 0 && (
                        <ul
                          class="hint"
                          style={{ margin: 0, paddingInlineStart: "1.25rem", color: "var(--dry-error)" }}
                        >
                          {result.destructiveSummary.map((change, i) => (
                            <li key={i}>{describeDestructiveChange(change)}</li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>

              {busy && (
                <div class="row justify-center" style={{ padding: "1.5rem 0" }}>
                  <progress class="circle" />
                  <span>{stage === "checking" ? "Checking for conflicts..." : "Applying changes..."}</span>
                </div>
              )}

              {error && <p class="error">{error}</p>}

              {stage === "checked" && hasPlanErrors && (
                <div class="alert destructive" style={{ marginBlock: "1rem" }}>
                  <XCircleIcon />
                  <h4>Some changes can't be applied</h4>
                  <p>Fix the errors above (edit that content type again), then re-check.</p>
                </div>
              )}

              {stage === "applied" && (
                <div class={`alert ${applyAllOk ? "success" : "destructive"}`} style={{ marginBlock: "1rem" }}>
                  {applyAllOk ? <CheckCircleIcon /> : <XCircleIcon />}
                  <h4>{applyAllOk ? "Applied successfully" : "Some changes failed"}</h4>
                  <p>
                    {applyAllOk
                      ? "Every pending change is now live."
                      : "Whatever succeeded is now live and cleared from your drafts - fix the error above and try the rest again."}
                  </p>
                </div>
              )}
              </div>
            </div>

            <footer>
              <button type="button" class="outline" onClick={handleClose} disabled={busy}>
                {stage === "applied" ? "Close" : "Cancel"}
              </button>

              {stage === "review" && (
                <button type="button" disabled={items.length === 0} onClick={runPlan}>
                  Confirm
                </button>
              )}
              {stage === "checking" && (
                <button type="button" disabled aria-busy="true">
                  Checking...
                </button>
              )}
              {stage === "checked" && !hasPlanErrors && (
                <button type="button" class={hasDestructive ? "destructive" : undefined} onClick={runApply}>
                  <UploadIcon /> Save
                </button>
              )}
              {stage === "checked" && hasPlanErrors && (
                <button type="button" onClick={runPlan}>
                  Re-check
                </button>
              )}
              {stage === "applying" && (
                <button type="button" disabled aria-busy="true">
                  Applying...
                </button>
              )}
              {stage === "applied" && !applyAllOk && (
                <button type="button" onClick={runPlan}>
                  Re-check remaining
                </button>
              )}
            </footer>
          </>
        )}
      </dialog>

      {open && (
        <>
          <ConfirmDialog
            open={resetItemId !== null}
            title="Reset this change?"
            message={
              <p>
                This discards the unapplied change to "
                {resetTarget?.definition.label || resetTarget?.definition.name || "this content type"}
                "{resetTarget?.isNew ? "" : " and reverts back to the live version"}. This
                cannot be undone.
              </p>
            }
            confirmLabel="Reset"
            destructive
            onConfirm={handleResetItem}
            onCancel={() => setResetItemId(null)}
          />

          <ConfirmDialog
            open={resetAllConfirm}
            title="Reset all pending changes?"
            message={
              <p>
                This discards the {items.length} pending change{items.length === 1 ? "" : "s"} below
                and reverts everything back to the live version. This cannot be undone.
              </p>
            }
            confirmLabel="Reset all"
            destructive
            onConfirm={handleResetAll}
            onCancel={() => setResetAllConfirm(false)}
          />
        </>
      )}
    </>
  );
}
