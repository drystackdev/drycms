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

export interface EntryPullStatus {
  configured: boolean;
  repo?: string;
  branch?: string;
  provider?: string;
  reason?: string;
}

/**
 * `GET routes/backup.ts`'s `entries` slug - whether this branch has a git
 * repository configured to pull `content/entries/**` from at all. Same
 * never-throws contract as `downloadBackup` above.
 */
export async function getEntryPullStatus(endpoint: string): Promise<EntryPullStatus> {
  try {
    const response = await fetch(endpoint, { credentials: "same-origin" });
    const body = (await response.json().catch(() => ({}))) as EntryPullStatus & { message?: unknown };
    if (!response.ok) {
      return { configured: false, reason: typeof body.message === "string" ? body.message : `HTTP ${response.status}` };
    }
    return body;
  } catch (error) {
    return { configured: false, reason: error instanceof Error ? error.message : "Request failed." };
  }
}

export interface EntryPullResult {
  mode: "plan" | "apply";
  restored: number;
  skipped: string[];
  applied: boolean;
  errors: string[];
  reason?: string;
}

/**
 * `POST routes/backup.ts`'s `entries` slug - pulls whatever `content/
 * entries/**` holds at this branch's git HEAD into the current install's
 * live database (`pullEntriesFromGit` server-side). `mode: "plan"` writes
 * nothing and just reports how many entries would be pulled.
 */
export async function pullEntriesFromGit(endpoint: string, mode: "plan" | "apply"): Promise<EntryPullResult> {
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode }),
    });
    const body = (await response.json().catch(() => ({}))) as Partial<EntryPullResult> & { message?: unknown };
    if (!response.ok) {
      return {
        mode,
        restored: 0,
        skipped: [],
        applied: false,
        errors: [],
        reason: typeof body.message === "string" ? body.message : `HTTP ${response.status}`,
      };
    }
    return {
      mode,
      restored: body.restored ?? 0,
      skipped: body.skipped ?? [],
      applied: body.applied ?? false,
      errors: body.errors ?? [],
    };
  } catch (error) {
    return { mode, restored: 0, skipped: [], applied: false, errors: [], reason: error instanceof Error ? error.message : "Request failed." };
  }
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
