export interface BackupDownloadResult {
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
 * `GET routes/backup.ts` - downloads the whole content database as a
 * portable `.sql` script. Never throws - a network/HTTP failure comes back
 * as `{ok:false,reason}` so the caller can show a toast instead of an
 * unhandled rejection, same contract `github-restore-http-api.ts`'s own
 * calls use.
 */
export async function downloadBackup(endpoint: string): Promise<BackupDownloadResult> {
  try {
    const response = await fetch(endpoint, { credentials: "same-origin" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}) as { message?: unknown });
      return { ok: false, reason: typeof body.message === "string" ? body.message : `HTTP ${response.status}` };
    }
    const blob = await response.blob();
    const filename = filenameFromDisposition(response.headers.get("content-disposition")) ?? "drycms-backup.sql";
    return { ok: true, blob, filename };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "Request failed." };
  }
}

export interface BackupRestoreResult {
  applied: boolean;
  restoredRows?: number;
  reason?: string;
}

/**
 * `POST routes/backup.ts` - restores a previously downloaded `.sql` backup,
 * fully replacing every current content table. Never throws, same
 * `{applied:false,reason}` contract as `github-restore-http-api.ts`'s own
 * restore call.
 */
export async function restoreBackup(endpoint: string, file: File): Promise<BackupRestoreResult> {
  try {
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(endpoint, { method: "POST", credentials: "same-origin", body: form });
    const body = await response.json().catch(() => ({}) as { message?: unknown });
    if (!response.ok) {
      return { applied: false, reason: typeof body.message === "string" ? body.message : `HTTP ${response.status}` };
    }
    return body as BackupRestoreResult;
  } catch (error) {
    return { applied: false, reason: error instanceof Error ? error.message : "Request failed." };
  }
}
