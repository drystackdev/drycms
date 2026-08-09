import { useEffect, useState } from "preact/hooks";
import ConfirmDialog from "../../components/ConfirmDialog.js";
import TextField from "../../components/fields/TextField.js";
import { fetchGithubRestoreStatus, resetPagesSourceFromGithub } from "../../page-components/github-restore-http-api.js";

export interface GithubResetDialogProps {
  open: boolean;
  /** `${path}/api/github-restore` - shared with `GithubHistoryDialog`. */
  endpoint: string;
  onClose: () => void;
  /** Called once the pull+overwrite actually succeeded - `PageEditor.tsx`
   * reloads its file tree and re-runs "Build all" from it. */
  onApplied: () => void;
}

/**
 * `PageEditor.tsx`'s Settings > "Reset all from GitHub" - pulls
 * `githubSync.branch`'s current HEAD and overwrites the whole pages-source
 * tree with it (`pages-source-github-restore.ts`'s `POST`, no `sha`).
 * Requires typing the exact `owner/repo` back (fetched fresh every time the
 * dialog opens, never hard-coded) before the destructive confirm button
 * enables - same "type the name to confirm" bar `scripts/new-project.ts`
 * sets for its own irreversible reset.
 */
export default function GithubResetDialog({ open, endpoint, onClose, onApplied }: GithubResetDialogProps) {
  const [repo, setRepo] = useState<string | null>(null);
  const [branch, setBranch] = useState<string | null>(null);
  const [configured, setConfigured] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setConfirmText("");
    setApplyError(null);
    setLoadingStatus(true);
    void fetchGithubRestoreStatus(endpoint, 1).then((status) => {
      setConfigured(status.configured);
      setRepo(status.repo ?? null);
      setBranch(status.branch ?? null);
      setStatusError(!status.configured ? (status.reason ?? "GitHub Sync isn't configured/enabled.") : (status.reason ?? null));
      setLoadingStatus(false);
    });
  }, [open, endpoint]);

  async function handleConfirm() {
    setApplying(true);
    setApplyError(null);
    try {
      const result = await resetPagesSourceFromGithub(endpoint);
      if (!result.applied) {
        setApplyError(result.reason ?? "Reset failed.");
        return;
      }
      onApplied();
      onClose();
    } finally {
      setApplying(false);
    }
  }

  const canConfirm = !loadingStatus && !!repo && confirmText.trim() === repo;

  return (
    <ConfirmDialog
      open={open}
      title="Reset all from GitHub"
      confirmLabel="Reset all"
      destructive
      busy={applying}
      confirmDisabled={!canConfirm}
      onConfirm={() => void handleConfirm()}
      onCancel={onClose}
      message={
        <div class="stack" style={{ gap: "0.75rem" }}>
          {loadingStatus && <span class="hint">Loading GitHub Sync settings…</span>}
          {!loadingStatus && !configured && <span class="error">{statusError}</span>}
          {!loadingStatus && configured && repo && (
            <>
              <p>
                This pulls <strong>{repo}</strong> (<code>{branch}</code>) from GitHub and replaces every page/layout/component source
                under this editor with it - anything not committed there is permanently lost. The whole site is then rebuilt from the
                pulled code.
              </p>
              <TextField label={`Type "${repo}" to confirm`} placeholder={repo} value={confirmText} onChange={setConfirmText} />
            </>
          )}
          {!loadingStatus && configured && !repo && statusError && <span class="error">{statusError}</span>}
          {applyError && <span class="error">{applyError}</span>}
        </div>
      }
    />
  );
}
