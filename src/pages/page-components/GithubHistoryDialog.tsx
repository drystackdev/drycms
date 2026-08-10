import { useEffect, useState } from "preact/hooks";
import { useDialogSync } from "../../hooks/list-nav.js";
import { useOverlayScrollbars } from "../../hooks/overlayscrollbars.js";
import ConfirmDialog from "../../components/ConfirmDialog.js";
import { XIcon } from "../../components/icons/index.js";
import { fetchGithubRestoreStatus, resetPagesSourceFromGithub, type GithubSnapshotCommit } from "../../page-components/github-restore-http-api.js";

export interface GithubHistoryDialogProps {
  open: boolean;
  /** `${path}/api/github-restore` - shared with `GithubResetDialog`. */
  endpoint: string;
  onClose: () => void;
  /** Called once a restore actually succeeded - `PageEditor.tsx` reloads its
   * file tree and re-runs "Build all" from it, same as `GithubResetDialog`. */
  onApplied: () => void;
}

function formatCommitDate(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/**
 * `PageEditor.tsx`'s Settings > History - lists `githubSync`'s recent
 * commits (each one a full pages-source snapshot, since every Build push
 * commits the whole tree atomically - see `github-source-sync.ts`'s
 * `listSnapshotCommits` doc comment) and restores the WHOLE tree back to
 * whichever one is picked, via the same pull-and-overwrite
 * `pages-source-github-restore.ts` route "Reset all from GitHub" uses, just
 * with that commit's `sha` instead of branch HEAD. Same list-in-dialog +
 * nested per-row `ConfirmDialog` shape `ApplyBuildDialog.tsx` uses for its
 * own "Reset this change"/"Reset all".
 */
export default function GithubHistoryDialog({ open, endpoint, onClose, onApplied }: GithubHistoryDialogProps) {
  const ref = useDialogSync(open, onClose);
  const { ref: bodyScroll } = useOverlayScrollbars<HTMLDivElement>([open]);
  const [loading, setLoading] = useState(false);
  const [commits, setCommits] = useState<GithubSnapshotCommit[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pendingRestore, setPendingRestore] = useState<GithubSnapshotCommit | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setLoadError(null);
    void fetchGithubRestoreStatus(endpoint, 30).then((status) => {
      setCommits(status.commits);
      setLoadError(!status.configured ? (status.reason ?? "GitHub Sync isn't configured/enabled.") : (status.reason ?? null));
      setLoading(false);
    });
  }, [open, endpoint]);

  async function handleConfirmRestore() {
    if (!pendingRestore) return;
    setRestoring(true);
    setRestoreError(null);
    try {
      const result = await resetPagesSourceFromGithub(endpoint, pendingRestore.sha);
      if (!result.applied) {
        setRestoreError(result.reason ?? "Restore failed.");
        return;
      }
      setPendingRestore(null);
      onApplied();
      onClose();
    } finally {
      setRestoring(false);
    }
  }

  return (
    <>
      <dialog ref={ref} class="lg github-history-dialog" aria-label="History">
        {open && (
          <>
            <header class="row justify-between" style={{ flexWrap: "nowrap" }}>
              <div class="spacer">
                <strong>History</strong>
                <p class="hint">Every Build with GitHub Sync enabled commits a full snapshot - pick one to restore the whole tree back to it.</p>
              </div>
              <button type="button" class="icon ghost" onClick={onClose}>
                <XIcon />
              </button>
            </header>

            <div class="under github-history-body" ref={bodyScroll}>
              <div class="github-history-scroll-content">
                {loading && <span class="hint">Loading…</span>}
                {!loading && loadError && <span class="error">{loadError}</span>}
                {!loading && !loadError && commits.length === 0 && <span class="hint">No snapshot commits yet.</span>}
                {!loading && commits.length > 0 && (
                  <ul class="content-type-list">
                    {commits.map((commit) => (
                      <li key={commit.sha} class="content-type-list-item row justify-between align-center">
                        <span class="stack" style={{ gap: "0.125rem", minWidth: 0 }}>
                          <strong>{commit.message.split("\n")[0]}</strong>
                          <small class="hint">
                            {formatCommitDate(commit.date)} • {commit.authorName} • <code>{commit.sha.slice(0, 7)}</code>
                          </small>
                        </span>
                        <button type="button" class="outline sm" onClick={() => setPendingRestore(commit)}>
                          Restore
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </>
        )}
      </dialog>

      {open && (
        <ConfirmDialog
          open={pendingRestore !== null}
          title="Restore this commit"
          confirmLabel="Restore"
          destructive
          busy={restoring}
          onConfirm={() => void handleConfirmRestore()}
          onCancel={() => {
            setPendingRestore(null);
            setRestoreError(null);
          }}
          message={
            <div class="stack" style={{ gap: "0.5rem" }}>
              <p>
                This replaces every page/layout/component source under this editor with the code from "
                {pendingRestore?.message.split("\n")[0]}" ({pendingRestore ? formatCommitDate(pendingRestore.date) : ""}) - anything not
                committed there is permanently lost. The whole site is then rebuilt from the restored code.
              </p>
              {restoreError && <span class="error">{restoreError}</span>}
            </div>
          }
        />
      )}
    </>
  );
}
