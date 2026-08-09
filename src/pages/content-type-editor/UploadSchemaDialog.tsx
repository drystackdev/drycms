import { useRef, useState } from "preact/hooks";
const { path } = window.__DRY_CONFIG__;
import { useDialogSync } from "../../hooks/list-nav.js";
import { useOverlayScrollbars } from "../../hooks/overlayscrollbars.js";
import { toast } from "../../components/Toast.js";
import {
  AlertTriangleIcon,
  CheckCircleIcon,
  UploadIcon,
  XCircleIcon,
  XIcon,
} from "../../components/icons/index.js";
import { createContentTypeSeedApi } from "../../content-types/content-type-seed-http-api.js";
import { describeDestructiveChange } from "../../content-types/draft-diff.js";
import type { BatchItemResult } from "../../content-types/http-api.js";
import { bumpContentTypesVersion } from "../../store/content-types.js";
import type { ContentTypeDefinition, ContentTypeKind } from "../../content-types/types.js";

export interface UploadSchemaDialogProps {
  open: boolean;
  /** Every OTHER live content type - used only to label each uploaded item
   * "New" vs "Update" (`liveDefinitions.find(id match)`), same source
   * `ApplyBuildDialog` diffs against. */
  liveDefinitions: ContentTypeDefinition[];
  onClose: () => void;
  onApplied?: () => void;
}

type Stage = "pick" | "checking" | "checked" | "applying" | "applied";

const KIND_LABELS: Record<ContentTypeKind, string> = {
  collection: "Collection",
  singleton: "Single",
  component: "Component",
};

const api = createContentTypeSeedApi(`${path}/api/content-type-seed`);

function parseSchemaFile(text: string): ContentTypeDefinition[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  const contentTypes = (parsed as { contentTypes?: unknown } | null)?.contentTypes;
  if (!Array.isArray(contentTypes)) {
    throw new Error('Expected a `schema.json` with a top-level "contentTypes" array.');
  }
  return contentTypes as ContentTypeDefinition[];
}

/**
 * "Upload schema" - the manual counterpart to `ApplyBuildDialog`'s "Apply
 * and build", for a `schema.json` file (`bun run seed:sync`'s output, or
 * one from another install) instead of this session's own pending drafts.
 * Same plan-then-apply shape, reusing `routes/content-type-seed.ts`'s
 * `kind: "schema"` - which is itself a thin wrapper around
 * `routes/content-types.ts`'s `handleBatch`, so every result here (create
 * vs. update, version conflicts, destructive-change warnings) is the exact
 * same machinery `ApplyBuildDialog` already relies on.
 */
export default function UploadSchemaDialog({ open, liveDefinitions, onClose, onApplied }: UploadSchemaDialogProps) {
  const ref = useDialogSync(open, onClose);
  const { ref: bodyScroll } = useOverlayScrollbars<HTMLDivElement>([open]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [stage, setStage] = useState<Stage>("pick");
  const [fileName, setFileName] = useState<string | null>(null);
  const [items, setItems] = useState<ContentTypeDefinition[]>([]);
  const [planResults, setPlanResults] = useState<BatchItemResult[] | null>(null);
  const [applyResults, setApplyResults] = useState<BatchItemResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = stage === "checking" || stage === "applying";

  function reset() {
    setStage("pick");
    setFileName(null);
    setItems([]);
    setPlanResults(null);
    setApplyResults(null);
    setError(null);
  }

  async function handleFilePicked(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    (event.currentTarget as HTMLInputElement).value = "";
    if (!file) return;
    setError(null);
    try {
      const parsed = parseSchemaFile(await file.text());
      setFileName(file.name);
      setItems(parsed);
      setPlanResults(null);
      setApplyResults(null);
      setStage("pick");
    } catch (e) {
      setFileName(null);
      setItems([]);
      setError(e instanceof Error ? e.message : "Failed to read that file.");
    }
  }

  async function runPlan() {
    setStage("checking");
    setError(null);
    try {
      const response = await api.planSchema(items);
      setPlanResults(response.results);
      setStage("checked");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to check the uploaded schema.");
      setStage("pick");
    }
  }

  async function runApply() {
    setStage("applying");
    setError(null);
    try {
      const response = await api.applySchema(items);
      setApplyResults(response.results);
      const allOk = response.results.length === items.length && response.results.every((r) => r.ok);
      setStage("applied");
      if (response.results.some((r) => r.ok)) {
        bumpContentTypesVersion();
        onApplied?.();
      }
      if (allOk) {
        toast.add({ type: "success", title: "Schema uploaded and applied." });
        onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to apply the uploaded schema.");
      setStage("checked");
    }
  }

  function handleClose() {
    if (busy) return;
    onClose();
    reset();
  }

  const hasPlanErrors = (planResults ?? []).some((r) => !r.ok);
  const hasDestructive = (planResults ?? []).some((r) => (r.destructiveSummary?.length ?? 0) > 0);
  const applyAllOk = applyResults !== null && applyResults.length === items.length && applyResults.every((r) => r.ok);
  const resultsToShow = applyResults ?? planResults;

  return (
    <dialog ref={ref} class="lg apply-build-dialog" aria-label="Upload schema">
      {open && (
        <>
          <header class="row justify-between apply-build-header" style={{ flexWrap: "nowrap" }}>
            <div class="spacer apply-build-intro" style={{ minWidth: 0 }}>
              <p><strong>Upload schema</strong></p>
              <p>Pick a `schema.json` file, review what it would change, then confirm.</p>
            </div>
            <button type="button" class="icon ghost" onClick={handleClose} disabled={busy}>
              <XIcon />
            </button>
          </header>

          {stage === "checked" && !hasPlanErrors && (
            <div class={`alert ${hasDestructive ? "warning" : "success"}`} style={{ marginBlock: "0 1rem" }}>
              {hasDestructive ? <AlertTriangleIcon /> : <CheckCircleIcon />}
              <h4>{hasDestructive ? "This will lose data" : "No conflicts found"}</h4>
              <p>
                {hasDestructive
                  ? "Some changes drop columns or tables - review the warnings below before applying."
                  : "Ready to apply - this will run the migration on the live schema."}
              </p>
            </div>
          )}

          <div class="under apply-build-body" ref={bodyScroll}>
            <div class="apply-build-scroll-content">
              <input ref={fileInputRef} type="file" accept="application/json,.json" hidden onChange={(e) => void handleFilePicked(e)} />

              {items.length === 0 ? (
                <div class="apply-build-empty">
                  <UploadIcon />
                  <strong>No file selected</strong>
                  <span class="hint">Pick a `schema.json` exported by `bun run seed:sync`.</span>
                  <button type="button" class="sm" style={{ marginTop: "0.5rem" }} onClick={() => fileInputRef.current?.click()}>
                    Choose file
                  </button>
                </div>
              ) : (
                <div class="row justify-between align-start">
                  <div class="apply-build-summary">
                    <strong>{fileName}</strong>
                    <span class="hint">{items.length} content type{items.length === 1 ? "" : "s"} in this file.</span>
                  </div>
                  <button type="button" class="sm outline" disabled={busy} onClick={() => fileInputRef.current?.click()}>
                    Choose a different file
                  </button>
                </div>
              )}

              {items.length > 0 && (
                <ul class="content-type-list">
                  {items.map((definition) => {
                    const result = resultsToShow?.find((r) => r.id === definition.id);
                    const isNew = !liveDefinitions.some((d) => d.id === definition.id);
                    return (
                      <li key={definition.id} class="content-type-list-item apply-build-change stack" style={{ gap: "0.375rem", alignItems: "stretch" }}>
                        <span class="row" style={{ gap: "0.375rem" }}>
                          <strong>{definition.label || definition.name || "(untitled)"}</strong>
                          <span class="badge sm secondary">{KIND_LABELS[definition.kind]}</span>
                          {isNew ? <span class="badge sm info">New</span> : <span class="badge sm">Update</span>}
                        </span>

                        {result && !result.ok && <p class="error">{result.error}</p>}
                        {result?.ok && result.destructiveSummary && result.destructiveSummary.length > 0 && (
                          <ul class="hint" style={{ margin: 0, paddingInlineStart: "1.25rem", color: "var(--dry-error)" }}>
                            {result.destructiveSummary.map((change, i) => (
                              <li key={i}>{describeDestructiveChange(change)}</li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

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
                  <p>Fix the file (or the live content type it conflicts with), then re-check.</p>
                </div>
              )}

              {stage === "applied" && (
                <div class={`alert ${applyAllOk ? "success" : "destructive"}`} style={{ marginBlock: "1rem" }}>
                  {applyAllOk ? <CheckCircleIcon /> : <XCircleIcon />}
                  <h4>{applyAllOk ? "Applied successfully" : "Some changes failed"}</h4>
                  <p>
                    {applyAllOk
                      ? "Every content type in this file is now live."
                      : "Whatever succeeded is now live - fix the error above and try again for the rest."}
                  </p>
                </div>
              )}
            </div>
          </div>

          <footer>
            <button type="button" class="outline" onClick={handleClose} disabled={busy}>
              {stage === "applied" ? "Close" : "Cancel"}
            </button>

            {stage === "pick" && (
              <button type="button" disabled={items.length === 0} onClick={runPlan}>
                Check
              </button>
            )}
            {stage === "checking" && (
              <button type="button" disabled aria-busy="true">
                Checking...
              </button>
            )}
            {stage === "checked" && !hasPlanErrors && (
              <button type="button" class={hasDestructive ? "destructive" : undefined} onClick={runApply}>
                <UploadIcon /> Apply
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
  );
}
