import { useRef, useState } from "preact/hooks";
const { path } = window.__DRY_CONFIG__;
import ConfirmDialog from "../components/ConfirmDialog.js";
import TextField from "../components/fields/TextField.js";
import { toast } from "../components/Toast.js";
import { ArchiveIcon, UploadIcon } from "../components/icons/index.js";
import { downloadBackup, restoreBackup } from "../page-components/backup-http-api.js";
import {
  SCHEMA_DOCUMENT_EXPORT_ENDPOINT,
  importSchemaDocument,
} from "../content-types/schema-document-http-api.js";
import { hydrateContentTypeDraftIndex } from "../content-types/draft-store.js";
import { downloadStorageBackup, restoreStorageBackup } from "../page-components/storage-backup-http-api.js";
import { authState } from "../store/auth.js";
import { useDocumentTitle } from "./page-common.js";

const RESTORE_CONFIRM_PHRASE = "RESTORE";
const DB_ENDPOINT = `${path}/api/backup`;
const STORAGE_ENDPOINT = `${path}/api/storage-backup`;

interface PendingRestore {
  kind: "database" | "storage";
  file: File;
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * Super Admin-only "Backup" settings page (`DryLayout.tsx`'s `NAV` entry,
 * `superAdminOnly` - no grantable Role toggle, same reasoning that entry
 * documents for `ai-keys`). Two independent backup/restore pairs:
 * - Database (`routes/backup.ts`): every content type/entry/role/system
 *   setting, as a portable `.sql` script - see that route's own doc comment
 *   for why local sqlite and D1 share one script format.
 * - Media (`routes/storage-backup.ts`): every file under the Media storage
 *   root (local disk or R2), as a `.zip` - see that route's own doc comment
 *   for why it's streamed instead of built in memory.
 * Both restores are a full replace, not a merge, and both require typing
 * "RESTORE" into `ConfirmDialog` before the destructive action enables.
 *
 * Plus a third, deliberately NON-destructive pair for the content-type
 * schema alone (`routes/content-type-document.ts`): `content/types.json`
 * downloads as-is, and an uploaded file is STAGED as drafts rather than
 * applied - the real migration still goes through Content Types -> "Apply
 * and build", which dry-runs it and reports destructive changes first. That
 * is what makes it usable for moving a schema between projects, where a
 * blind table replace would be exactly the wrong thing.
 */
export default function Backup() {
  useDocumentTitle("Backup");
  const dbFileInputRef = useRef<HTMLInputElement>(null);
  const storageFileInputRef = useRef<HTMLInputElement>(null);
  const typesFileInputRef = useRef<HTMLInputElement>(null);

  const [downloadingDb, setDownloadingDb] = useState(false);
  const [downloadingStorage, setDownloadingStorage] = useState(false);
  const [downloadingTypes, setDownloadingTypes] = useState(false);
  const [importingTypes, setImportingTypes] = useState(false);
  const [pendingTypeImport, setPendingTypeImport] = useState<File | null>(null);
  const [pendingRestore, setPendingRestore] = useState<PendingRestore | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [restoring, setRestoring] = useState(false);

  async function handleDownloadDb() {
    setDownloadingDb(true);
    try {
      const result = await downloadBackup(DB_ENDPOINT);
      if (!result.ok || !result.blob) {
        toast.add({ type: "error", title: "Backup failed", description: result.reason });
        return;
      }
      triggerDownload(result.blob, result.filename ?? "drycms-backup.sql");
      toast.add({ type: "success", title: "Database backup downloaded." });
    } finally {
      setDownloadingDb(false);
    }
  }

  async function handleDownloadStorage() {
    setDownloadingStorage(true);
    try {
      const result = await downloadStorageBackup(STORAGE_ENDPOINT);
      if (!result.ok || !result.blob) {
        toast.add({ type: "error", title: "Backup failed", description: result.reason });
        return;
      }
      triggerDownload(result.blob, result.filename ?? "drycms-media-backup.zip");
      toast.add({ type: "success", title: "Media backup downloaded." });
    } finally {
      setDownloadingStorage(false);
    }
  }

  async function handleDownloadTypes() {
    setDownloadingTypes(true);
    try {
      const result = await downloadBackup(SCHEMA_DOCUMENT_EXPORT_ENDPOINT);
      if (!result.ok || !result.blob) {
        toast.add({ type: "error", title: "Export failed", description: result.reason });
        return;
      }
      triggerDownload(result.blob, result.filename ?? "drycms-content-types.json");
      toast.add({ type: "success", title: "Content types exported." });
    } finally {
      setDownloadingTypes(false);
    }
  }

  function pickTypeImportFile(event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (file) setPendingTypeImport(file);
  }

  async function handleConfirmTypeImport() {
    if (!pendingTypeImport) return;
    setImportingTypes(true);
    try {
      const result = await importSchemaDocument(pendingTypeImport);
      if (!result.ok) {
        toast.add({ type: "error", title: "Import failed", description: result.reason });
        return;
      }
      setPendingTypeImport(null);
      const staged = (result.added?.length ?? 0) + (result.updated?.length ?? 0);
      // The badge/list on the Content Types page reads the same draft store,
      // so pull the new staging area in now rather than on next navigation.
      await hydrateContentTypeDraftIndex();
      toast.add({
        type: staged > 0 ? "success" : "info",
        title: staged > 0 ? `${staged} content type${staged === 1 ? "" : "s"} staged as drafts` : "Nothing to stage",
        description:
          staged > 0
            ? `Open Content Types and run "Apply and build" to review and migrate. ${result.unchanged?.length ?? 0} already matched.`
            : "Every content type in that file already matches this project.",
      });
    } finally {
      setImportingTypes(false);
    }
  }

  function pickRestoreFile(kind: PendingRestore["kind"], event: Event) {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    setConfirmText("");
    setPendingRestore({ kind, file });
  }

  async function handleConfirmRestore() {
    if (!pendingRestore) return;
    setRestoring(true);
    try {
      if (pendingRestore.kind === "database") {
        const result = await restoreBackup(DB_ENDPOINT, pendingRestore.file);
        if (!result.applied) {
          toast.add({ type: "error", title: "Restore failed", description: result.reason });
          return;
        }
        setPendingRestore(null);
        toast.add({
          type: "success",
          title: "Database restored",
          description: `${result.restoredRows ?? 0} rows restored. Reloading…`,
        });
      } else {
        const result = await restoreStorageBackup(STORAGE_ENDPOINT, pendingRestore.file);
        if (!result.applied) {
          toast.add({ type: "error", title: "Restore failed", description: result.reason });
          return;
        }
        setPendingRestore(null);
        toast.add({
          type: "success",
          title: "Media restored",
          description: `${result.fileCount ?? 0} files restored. Reloading…`,
        });
      }
      // Every content type/entry/role/media reference read anywhere in the
      // already-open app (nav, drafts, cached lists, image previews) can now
      // be stale or point at rows/files that no longer exist - a full
      // reload is the simplest way to guarantee nothing keeps acting on
      // pre-restore state.
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
          <p>Download or restore the content database and Media storage.</p>
        </div>
      </div>

      <section class="card">
        <header>
          <h2>Database</h2>
          <p>
            Every content type, entry, role, and system setting, as a portable <code>.sql</code> file you can restore later or on
            another install.
          </p>
        </header>
        <div class="under row" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
          <button type="button" disabled={downloadingDb} aria-busy={downloadingDb || undefined} onClick={() => void handleDownloadDb()}>
            <ArchiveIcon /> Download backup
          </button>
          <input ref={dbFileInputRef} type="file" accept=".sql,application/sql,text/plain" hidden onChange={(e) => pickRestoreFile("database", e)} />
          <button type="button" class="outline" onClick={() => dbFileInputRef.current?.click()}>
            <UploadIcon /> Restore from file...
          </button>
        </div>
      </section>

      <section class="card">
        <header>
          <h2>Media</h2>
          <p>Every file under Media storage (local disk or R2), zipped into a single downloadable archive.</p>
        </header>
        <div class="under row" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
          <button
            type="button"
            disabled={downloadingStorage}
            aria-busy={downloadingStorage || undefined}
            onClick={() => void handleDownloadStorage()}
          >
            <ArchiveIcon /> Download backup
          </button>
          <input ref={storageFileInputRef} type="file" accept=".zip,application/zip" hidden onChange={(e) => pickRestoreFile("storage", e)} />
          <button type="button" class="outline" onClick={() => storageFileInputRef.current?.click()}>
            <UploadIcon /> Restore from file...
          </button>
        </div>
      </section>

      <section class="card">
        <header>
          <h2>Content types</h2>
          <p>
            The whole schema - every collection, singleton and component - as the single <code>content/types.json</code> file it
            lives in. Importing one stages its types as drafts; nothing is migrated until you run "Apply and build" on the Content
            Types page.
          </p>
        </header>
        <div class="under row" style={{ flexWrap: "wrap", gap: "0.75rem" }}>
          <button
            type="button"
            disabled={downloadingTypes}
            aria-busy={downloadingTypes || undefined}
            onClick={() => void handleDownloadTypes()}
          >
            <ArchiveIcon /> Download JSON
          </button>
          <input ref={typesFileInputRef} type="file" accept=".json,application/json" hidden onChange={pickTypeImportFile} />
          <button type="button" class="outline" onClick={() => typesFileInputRef.current?.click()}>
            <UploadIcon /> Import from file...
          </button>
        </div>
      </section>

      <ConfirmDialog
        open={!!pendingTypeImport}
        title="Import content types"
        busy={importingTypes}
        confirmLabel="Stage as drafts"
        onConfirm={() => void handleConfirmTypeImport()}
        onCancel={() => {
          if (!importingTypes) setPendingTypeImport(null);
        }}
        message={
          <p>
            Every content type in <strong>{pendingTypeImport?.name}</strong> is staged as a pending draft, replacing any draft
            already staged for the same type. No table is created, changed or dropped until you review the changes under Content
            Types and run "Apply and build".
          </p>
        }
      />

      <ConfirmDialog
        open={!!pendingRestore}
        title={pendingRestore?.kind === "storage" ? "Restore Media storage" : "Restore database"}
        destructive
        busy={restoring}
        confirmLabel="Restore"
        confirmDisabled={confirmText.trim() !== RESTORE_CONFIRM_PHRASE}
        onConfirm={() => void handleConfirmRestore()}
        onCancel={() => {
          if (!restoring) setPendingRestore(null);
        }}
        message={
          <div class="stack" style={{ gap: "0.75rem" }}>
            {pendingRestore?.kind === "storage" ? (
              <p>
                This replaces <strong>every file</strong> in Media storage with what's in <strong>{pendingRestore?.file.name}</strong> -
                anything uploaded or changed since that backup was taken is permanently lost.
              </p>
            ) : (
              <p>
                This replaces <strong>every</strong> content type, entry, role, and system setting with what's in{" "}
                <strong>{pendingRestore?.file.name}</strong> - anything created or changed since that backup was taken is permanently
                lost. You may need to sign in again afterward.
              </p>
            )}
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
