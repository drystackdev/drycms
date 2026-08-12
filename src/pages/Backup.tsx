import { useRef, useState } from "preact/hooks";
const { path } = window.__DRY_CONFIG__;
import ConfirmDialog from "../components/ConfirmDialog.js";
import TextField from "../components/fields/TextField.js";
import { toast } from "../components/Toast.js";
import { ArchiveIcon, UploadIcon } from "../components/icons/index.js";
import { downloadBackup, restoreBackup } from "../page-components/backup-http-api.js";
import { authState } from "../store/auth.js";
import { useDocumentTitle } from "./page-common.js";

const RESTORE_CONFIRM_PHRASE = "RESTORE";
const ENDPOINT = `${path}/api/backup`;

/**
 * Super Admin-only "Backup" settings page (`DryLayout.tsx`'s `NAV` entry,
 * `superAdminOnly` - no grantable Role toggle, same reasoning that entry
 * documents for `ai-keys`). Downloads/restores the whole content database
 * as a portable `.sql` script via `routes/backup.ts` - see that file's own
 * doc comment for why both `content.engine` values (local sqlite, D1) share
 * one script format instead of a raw file for one and a dump for the other.
 */
export default function Backup() {
  useDocumentTitle("Backup");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [downloading, setDownloading] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [restoring, setRestoring] = useState(false);

  async function handleDownload() {
    setDownloading(true);
    try {
      const result = await downloadBackup(ENDPOINT);
      if (!result.ok || !result.blob) {
        toast.add({ type: "error", title: "Backup failed", description: result.reason });
        return;
      }
      const url = URL.createObjectURL(result.blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = result.filename ?? "drycms-backup.sql";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.add({ type: "success", title: "Backup downloaded." });
    } finally {
      setDownloading(false);
    }
  }

  function handleFilePicked(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setConfirmText("");
    setPendingFile(file);
  }

  async function handleRestore() {
    if (!pendingFile) return;
    setRestoring(true);
    try {
      const result = await restoreBackup(ENDPOINT, pendingFile);
      if (!result.applied) {
        toast.add({ type: "error", title: "Restore failed", description: result.reason });
        return;
      }
      setPendingFile(null);
      toast.add({
        type: "success",
        title: "Database restored",
        description: `${result.restoredRows ?? 0} rows restored. Reloading…`,
      });
      // Every content type/entry/role read anywhere in the already-open app
      // (nav, drafts, cached lists) can now be stale or reference rows that
      // no longer exist - a full reload is the simplest way to guarantee
      // nothing keeps acting on pre-restore state.
      window.setTimeout(() => window.location.reload(), 1200);
    } finally {
      setRestoring(false);
    }
  }

  if (!authState.value.user?.isSuperAdmin) {
    return <span class="error">You don't have permission to manage backups.</span>;
  }

  return (
    <>
      <div class="page-header">
        <div style={{ flex: 1 }}>
          <h1>Backup</h1>
          <p>Download or restore the entire content database - content types, entries, roles, and system settings.</p>
        </div>
      </div>

      <section class="card">
        <header>
          <h2>Download backup</h2>
          <p>
            Saves every content type, entry, role, and system setting as a portable <code>.sql</code> file you can restore later or on
            another install.
          </p>
        </header>
        <div class="under row">
          <button type="button" disabled={downloading} aria-busy={downloading || undefined} onClick={() => void handleDownload()}>
            <ArchiveIcon /> Download backup
          </button>
        </div>
      </section>

      <section class="card">
        <header>
          <h2>Restore backup</h2>
          <p>Replaces every current content type, entry, role, and system setting with what's in the file. This cannot be undone.</p>
        </header>
        <div class="under row">
          <input ref={fileInputRef} type="file" accept=".sql,application/sql,text/plain" hidden onChange={handleFilePicked} />
          <button type="button" class="outline" onClick={() => fileInputRef.current?.click()}>
            <UploadIcon /> Choose backup file...
          </button>
        </div>
      </section>

      <ConfirmDialog
        open={!!pendingFile}
        title="Restore database"
        destructive
        busy={restoring}
        confirmLabel="Restore"
        confirmDisabled={confirmText.trim() !== RESTORE_CONFIRM_PHRASE}
        onConfirm={() => void handleRestore()}
        onCancel={() => {
          if (!restoring) setPendingFile(null);
        }}
        message={
          <div class="stack" style={{ gap: "0.75rem" }}>
            <p>
              This replaces <strong>every</strong> content type, entry, role, and system setting with what's in{" "}
              <strong>{pendingFile?.name}</strong> - anything created or changed since that backup was taken is permanently lost. You may
              need to sign in again afterward.
            </p>
            <TextField
              label={`Type "${RESTORE_CONFIRM_PHRASE}" to confirm`}
              placeholder={RESTORE_CONFIRM_PHRASE}
              value={confirmText}
              onChange={setConfirmText}
            />
          </div>
        }
      />
    </>
  );
}
