export interface StorageBackupDownloadResult {
  ok: boolean;
  blob?: Blob;
  filename?: string;
  reason?: string;
}

function filenameFromDisposition(header: string | null): string | undefined {
  if (!header) return undefined;
  const match = /filename="([^"]+)"/.exec(header);
  return match?.[1];
}

/**
 * `GET routes/storage-backup.ts` - downloads every file under the Media
 * storage root as a single `.zip`. Never throws - a network/HTTP failure
 * comes back as `{ok:false,reason}`, same contract `backup-http-api.ts`'s
 * `downloadBackup` uses for the database backup.
 */
export async function downloadStorageBackup(endpoint: string): Promise<StorageBackupDownloadResult> {
  try {
    const response = await fetch(endpoint, { credentials: "same-origin" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}) as { message?: unknown });
      return { ok: false, reason: typeof body.message === "string" ? body.message : `HTTP ${response.status}` };
    }
    const blob = await response.blob();
    const filename = filenameFromDisposition(response.headers.get("content-disposition")) ?? "drycms-media-backup.zip";
    return { ok: true, blob, filename };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Request failed." };
  }
}

export interface StorageBackupRestoreResult {
  applied: boolean;
  fileCount?: number;
  reason?: string;
}

/**
 * `POST routes/storage-backup.ts` - restores a previously downloaded
 * `.zip`, fully replacing every current file in storage. Never throws, same
 * `{applied:false,reason}` contract as `backup-http-api.ts`'s
 * `restoreBackup`.
 */
export async function restoreStorageBackup(endpoint: string, file: File): Promise<StorageBackupRestoreResult> {
  try {
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(endpoint, { method: "POST", credentials: "same-origin", body: form });
    const body = await response.json().catch(() => ({}) as { message?: unknown });
    if (!response.ok) {
      return { applied: false, reason: typeof body.message === "string" ? body.message : `HTTP ${response.status}` };
    }
    return body as StorageBackupRestoreResult;
  } catch (error) {
    return { applied: false, reason: error instanceof Error ? error.message : "Request failed." };
  }
}
