import { useEffect, useState } from "preact/hooks";
import { useDialogSync } from "../hooks/list-nav.js";
import { CheckCircleIcon, XCircleIcon } from "./icons/index.js";
import { createContentTypesApi } from "../content-types/http-api.js";
import { publishAllPages } from "../page-components/initial-publish.js";

const CONFIRM_WORD = "RESET";
/** No `0`/`O`/`1`/`I` - visually ambiguous in most UI fonts, and this token
 * has to be hand-typed back exactly. */
const TOKEN_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomToken(length = 6): string {
  let out = "";
  for (let i = 0; i < length; i++) out += TOKEN_CHARS[Math.floor(Math.random() * TOKEN_CHARS.length)];
  return out;
}

/** Every IndexedDB database this app opens client-side - `idb-cache.ts`
 * (generic HTTP/list cache), `entry-draft-db.ts`/`content-type-draft-db.ts`
 * (unsaved edits), `file-manager-blob-cache.ts` (Media previews),
 * `magic-chat-store.ts`/`page-source-magic-chat-store.ts` (chat history).
 * Hardcoded rather than enumerated via `indexedDB.databases()` (patchy
 * browser support) - a fixed, known list matching this app's own `DB_NAME`
 * constants. */
const INDEXED_DB_NAMES = [
  "drycms-cache",
  "drycms-entry-drafts",
  "drycms-content-type-drafts",
  "drycms-file-blob-cache",
  "drycms-magic-chat",
  "drycms-page-source-magic-chat",
];

function deleteIndexedDb(name: string): Promise<void> {
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(name);
    // A stray open connection can block deletion - never worth failing the
    // whole reset over a browser-side cache that will just get recreated
    // empty on next use anyway.
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

type StepStatus = "pending" | "active" | "done" | "error";
interface Step {
  id: string;
  label: string;
  status: StepStatus;
}

function initialSteps(): Step[] {
  return [
    { id: "content", label: "Delete & reset database (content types + data, keep the logged-in account, Git Sync config, and admin theme)", status: "pending" },
    { id: "media", label: "Delete all media (storage/R2)", status: "pending" },
    { id: "pages", label: "Reset pages to the default mock, rebuild, sync Git if configured", status: "pending" },
    { id: "cache", label: "Clear browser cache & IndexedDB", status: "pending" },
  ];
}

export interface FullResetDialogProps {
  open: boolean;
  adminPath: string;
  onClose: () => void;
  /** Called once every step finished successfully - the caller reloads the
   * page (session/role/content-types/theme all changed under it). */
  onDone: () => void;
}

/**
 * "Reset everything" - the destructive superset of the old "Reset All page"
 * action (`GithubSyncSettings.tsx`): resets the content database to the
 * built-in default types with no data (except the calling admin's own
 * account, kept so they don't get logged out; and the `githubSync`/
 * `systemSettings` singletons, kept as operator config rather than tenant
 * content - see `routes/full-reset.ts`), wipes every uploaded media file,
 * resets pages-source/build state to the mock starter, and clears every
 * browser-side cache. Two stages in one
 * dialog: a typed `RESET-<token>` gate (the token is generated fresh per
 * open, shown on screen, and must be copied back - a plain Yes/No isn't
 * enough friction for something this irreversible), then a live step-by-step
 * progress list while it actually runs.
 */
export default function FullResetDialog({ open, adminPath, onClose, onDone }: FullResetDialogProps) {
  const ref = useDialogSync(open, onClose);
  const [token, setToken] = useState(() => randomToken());
  const [typed, setTyped] = useState("");
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<Step[]>(() => initialSteps());
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    if (!open) return;
    setToken(randomToken());
    setTyped("");
    setRunning(false);
    setSteps(initialSteps());
    setError(null);
    setFinished(false);
  }, [open]);

  const expected = `${CONFIRM_WORD}-${token}`;
  const confirmReady = typed.trim() === expected;

  function setStepStatus(id: string, status: StepStatus) {
    setSteps((current) => current.map((step) => (step.id === id ? { ...step, status } : step)));
  }

  async function putJson(url: string): Promise<Record<string, unknown>> {
    const response = await fetch(url, { method: "PUT", credentials: "same-origin" });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) throw new Error(typeof body.message === "string" ? body.message : `HTTP ${response.status}`);
    return body;
  }

  async function run() {
    setRunning(true);
    setError(null);
    let activeStep = "content";
    try {
      setStepStatus("content", "active");
      await putJson(`${adminPath}/api/full-reset/content`);
      setStepStatus("content", "done");

      activeStep = "media";
      setStepStatus("media", "active");
      await putJson(`${adminPath}/api/full-reset/media`);
      setStepStatus("media", "done");

      activeStep = "pages";
      setStepStatus("pages", "active");
      const pagesResult = await putJson(`${adminPath}/api/github-sync`);
      if (!pagesResult.applied) throw new Error(typeof pagesResult.reason === "string" ? pagesResult.reason : "Reset pages-source failed.");
      // Content types were just wiped to the default set by the `content`
      // step above - re-fetch fresh rather than trusting anything loaded
      // before this ran.
      const freshTypes = await createContentTypesApi(`${adminPath}/api/content-types`).list();
      const published = await publishAllPages(adminPath, freshTypes);
      if (published.error) throw new Error(`Pages were reset but the build failed: ${published.error}`);
      setStepStatus("pages", "done");

      activeStep = "cache";
      setStepStatus("cache", "active");
      await Promise.all(INDEXED_DB_NAMES.map(deleteIndexedDb));
      setStepStatus("cache", "done");

      setFinished(true);
      onDone();
    } catch (cause) {
      setStepStatus(activeStep, "error");
      setError(cause instanceof Error ? cause.message : "Reset failed.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <dialog ref={ref} class="md" aria-label="Reset the entire system">
      {open && (
        <>
          <header>
            <h3>Reset the entire system</h3>
          </header>
          <div class="stack">
            {!running && !finished && (
              <>
                <p class="error">
                  This action PERMANENTLY DELETES: all content types &amp; data (keeping only the logged-in account, Git Sync
                  config, and admin theme settings), all media, the current pages/pages-source (restored to the default mock),
                  build state, and this browser's cache/IndexedDB. This cannot be undone.
                </p>
                <p>
                  To confirm, type exactly: <code class="mono">{expected}</code>
                </p>
                <input
                  type="text"
                  placeholder={expected}
                  value={typed}
                  onInput={(event) => setTyped((event.target as HTMLInputElement).value)}
                  autocomplete="off"
                  spellcheck={false}
                />
              </>
            )}
            {(running || finished || error) && (
              <ul class="stack full-reset-steps">
                {steps.map((step) => (
                  <li key={step.id} class="row">
                    {step.status === "active" && <span class="spinner" aria-hidden="true" />}
                    {step.status === "done" && <CheckCircleIcon class="success" aria-hidden="true" />}
                    {step.status === "error" && <XCircleIcon class="error" aria-hidden="true" />}
                    {step.status === "pending" && <span class="badge sm secondary">…</span>}
                    <span>{step.label}</span>
                  </li>
                ))}
              </ul>
            )}
            {error && <p class="error">{error}</p>}
            {finished && <p class="success">Reset complete. The page will reload…</p>}
          </div>
          <footer>
            <button type="button" class="outline" disabled={running} onClick={onClose}>
              {finished ? "Close" : "Cancel"}
            </button>
            {!finished && (
              <button type="button" class="destructive" disabled={!confirmReady || running} aria-busy={running} onClick={() => void run()}>
                Permanently delete &amp; reset
              </button>
            )}
          </footer>
        </>
      )}
    </dialog>
  );
}
