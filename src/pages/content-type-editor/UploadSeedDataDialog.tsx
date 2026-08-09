import { useRef, useState } from "preact/hooks";
const { path } = window.__DRY_CONFIG__;
import { useDialogSync } from "../../hooks/list-nav.js";
import { toast } from "../../components/Toast.js";
import { CheckCircleIcon, UploadIcon, XIcon } from "../../components/icons/index.js";
import { createContentTypeSeedApi, type SeedPlanItem } from "../../content-types/content-type-seed-http-api.js";
import type { EntryValue } from "../../content-types/engine/entry-codec.js";

export interface UploadSeedDataDialogProps {
  open: boolean;
  onClose: () => void;
  onApplied?: () => void;
}

type Stage = "pick" | "checking" | "checked" | "applying" | "applied";

interface ParsedSeed {
  singletonData?: Record<string, EntryValue>;
  menuData?: EntryValue[];
}

const api = createContentTypeSeedApi(`${path}/api/content-type-seed`);

function parseSeedFile(text: string): ParsedSeed {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error('Expected a `seed.json` with optional "singletonData"/"menuData" keys.');
  }
  const { singletonData, menuData } = parsed as ParsedSeed;
  if (!singletonData && !menuData) {
    throw new Error("That file has no `singletonData` or `menuData` to apply.");
  }
  return { singletonData, menuData };
}

/**
 * "Upload seed data" - applies a `seed.json` file's singleton row values /
 * `menu` rows (`bun run seed:sync`'s output, or one from another install)
 * via `routes/content-type-seed.ts`'s `kind: "seed"`, which delegates to
 * `content-types/seed.ts`'s `applyPackagedSingletonData`/
 * `applyPackagedMenuData` - both already skip anything that already has
 * live data (never overwrite), so "Check" just surfaces that same
 * will-apply/will-skip decision before anything is written.
 */
export default function UploadSeedDataDialog({ open, onClose, onApplied }: UploadSeedDataDialogProps) {
  const ref = useDialogSync(open, onClose);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [stage, setStage] = useState<Stage>("pick");
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedSeed | null>(null);
  const [singletons, setSingletons] = useState<SeedPlanItem[]>([]);
  const [menu, setMenu] = useState<SeedPlanItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  const busy = stage === "checking" || stage === "applying";

  function reset() {
    setStage("pick");
    setFileName(null);
    setParsed(null);
    setSingletons([]);
    setMenu(null);
    setError(null);
  }

  async function handleFilePicked(event: Event) {
    const file = (event.currentTarget as HTMLInputElement).files?.[0];
    (event.currentTarget as HTMLInputElement).value = "";
    if (!file) return;
    setError(null);
    try {
      const next = parseSeedFile(await file.text());
      setFileName(file.name);
      setParsed(next);
      setSingletons([]);
      setMenu(null);
      setStage("pick");
    } catch (e) {
      setFileName(null);
      setParsed(null);
      setError(e instanceof Error ? e.message : "Failed to read that file.");
    }
  }

  async function runPlan() {
    if (!parsed) return;
    setStage("checking");
    setError(null);
    try {
      const response = await api.planSeedData(parsed.singletonData, parsed.menuData);
      setSingletons(response.singletons);
      setMenu(response.menu);
      setStage("checked");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to check the uploaded seed data.");
      setStage("pick");
    }
  }

  async function runApply() {
    if (!parsed) return;
    setStage("applying");
    setError(null);
    try {
      const response = await api.applySeedData(parsed.singletonData, parsed.menuData);
      setSingletons(response.singletons);
      setMenu(response.menu);
      setStage("applied");
      onApplied?.();
      toast.add({ type: "success", title: "Seed data applied." });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to apply the uploaded seed data.");
      setStage("checked");
    }
  }

  function handleClose() {
    if (busy) return;
    onClose();
    reset();
  }

  const items = [...singletons, ...(menu ? [menu] : [])];
  const willApplyAny = items.some((item) => item.willApply);

  return (
    <dialog ref={ref} class="lg apply-build-dialog" aria-label="Upload seed data">
      {open && (
        <>
          <header class="row justify-between apply-build-header" style={{ flexWrap: "nowrap" }}>
            <div class="spacer apply-build-intro" style={{ minWidth: 0 }}>
              <p><strong>Upload seed data</strong></p>
              <p>Pick a `seed.json` file, review what it would fill in, then confirm.</p>
            </div>
            <button type="button" class="icon ghost" onClick={handleClose} disabled={busy}>
              <XIcon />
            </button>
          </header>

          <div class="under apply-build-body">
            <div class="apply-build-scroll-content">
              <input ref={fileInputRef} type="file" accept="application/json,.json" hidden onChange={(e) => void handleFilePicked(e)} />

              {!parsed ? (
                <div class="apply-build-empty">
                  <UploadIcon />
                  <strong>No file selected</strong>
                  <span class="hint">Pick a `seed.json` exported by `bun run seed:sync`.</span>
                  <button type="button" class="sm" style={{ marginTop: "0.5rem" }} onClick={() => fileInputRef.current?.click()}>
                    Choose file
                  </button>
                </div>
              ) : (
                <div class="row justify-between align-start">
                  <div class="apply-build-summary">
                    <strong>{fileName}</strong>
                    <span class="hint">
                      {Object.keys(parsed.singletonData ?? {}).length} singleton{Object.keys(parsed.singletonData ?? {}).length === 1 ? "" : "s"}
                      {parsed.menuData?.length ? `, ${parsed.menuData.length} menu row${parsed.menuData.length === 1 ? "" : "s"}` : ""} in this file.
                    </span>
                  </div>
                  <button type="button" class="sm outline" disabled={busy} onClick={() => fileInputRef.current?.click()}>
                    Choose a different file
                  </button>
                </div>
              )}

              {(stage === "checked" || stage === "applied") && items.length > 0 && (
                <ul class="content-type-list">
                  {items.map((item) => (
                    <li key={item.id} class="content-type-list-item row justify-between">
                      <strong>{item.label}</strong>
                      {item.willApply ? (
                        <span class="badge sm success">{stage === "applied" ? "Applied" : "Will apply"}</span>
                      ) : (
                        <span class="badge sm secondary">Skipped - already has data</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {stage === "checked" && items.length === 0 && (
                <p class="hint">Nothing in this file matches a live singleton or the menu collection.</p>
              )}

              {busy && (
                <div class="row justify-center" style={{ padding: "1.5rem 0" }}>
                  <progress class="circle" />
                  <span>{stage === "checking" ? "Checking..." : "Applying..."}</span>
                </div>
              )}

              {error && <p class="error">{error}</p>}

              {stage === "checked" && !willApplyAny && items.length > 0 && (
                <p class="hint">Everything here already has live data - nothing to apply.</p>
              )}

              {stage === "applied" && (
                <div class="alert success" style={{ marginBlock: "1rem" }}>
                  <CheckCircleIcon />
                  <h4>Applied</h4>
                  <p>Whatever wasn't already populated is now live.</p>
                </div>
              )}
            </div>
          </div>

          <footer>
            <button type="button" class="outline" onClick={handleClose} disabled={busy}>
              {stage === "applied" ? "Close" : "Cancel"}
            </button>

            {stage === "pick" && (
              <button type="button" disabled={!parsed} onClick={runPlan}>
                Check
              </button>
            )}
            {stage === "checking" && (
              <button type="button" disabled aria-busy="true">
                Checking...
              </button>
            )}
            {stage === "checked" && (
              <button type="button" disabled={!willApplyAny} onClick={runApply}>
                <UploadIcon /> Apply
              </button>
            )}
            {stage === "applying" && (
              <button type="button" disabled aria-busy="true">
                Applying...
              </button>
            )}
          </footer>
        </>
      )}
    </dialog>
  );
}
