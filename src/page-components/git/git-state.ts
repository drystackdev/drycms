import { signal } from "@preact/signals";

/**
 * The one shared view of the browser's git working copy - what the admin app
 * boots (`routers/App.tsx`'s `AuthenticatedApp`) and what Page Builder reads
 * to decide whether it can edit yet, show an ahead/behind badge, or offer
 * Commit & Deploy (`status/git-page-source.md`).
 *
 * A signal rather than a hook's state: the clone starts at app boot, long
 * before Page Builder mounts, and must survive every route change in
 * between - the exact shape `store/auth.ts` already uses for session state.
 *
 * This module itself is deliberately dependency-light (no isomorphic-git, no
 * ZenFS): every operation `import()`s `git-repo.js` on demand, so a session
 * that never touches page source never pays the ~170 KB gzip those bring.
 */
export type GitPhase =
  /** No repository configured on the server - Page Builder can't edit code. */
  | "unconfigured"
  /** Nothing attempted yet this session. */
  | "idle"
  | "cloning"
  | "ready"
  /** The remote moved while this copy has its own commits or edits - needs a
   * human decision, never an automatic overwrite. */
  | "diverged"
  | "error";

export interface GitState {
  phase: GitPhase;
  branch: string;
  /** `"owner/name"`, purely for display. Never a secret. */
  repo: string;
  head: string | null;
  dirty: string[];
  /** Progress text while cloning (`Receiving objects`, ...). */
  progress: string;
  error: string | null;
}

export const gitState = signal<GitState>({
  phase: "idle",
  branch: "",
  repo: "",
  head: null,
  dirty: [],
  progress: "",
  error: null,
});

function patch(next: Partial<GitState>): void {
  gitState.value = { ...gitState.value, ...next };
}

export interface GitServerConfig {
  configured: boolean;
  repo: string;
  branch: string;
  /** `true` when a PAT is available server-side. Reads work without one on a
   * public repository; a push never does. */
  hasToken: boolean;
}

export async function fetchGitConfig(adminPath: string): Promise<GitServerConfig> {
  const response = await fetch(`${adminPath}/api/git/config`, { credentials: "same-origin" });
  if (!response.ok) return { configured: false, repo: "", branch: "", hasToken: false };
  return (await response.json()) as GitServerConfig;
}

let inFlight: Promise<void> | undefined;

/**
 * Clone (first run) or fast-forward (every later one), once per session.
 * Never throws: a failure lands in `gitState.error` for the UI to show,
 * because this runs unattended at app boot where there is nobody to catch it.
 *
 * Coalesced through `inFlight` - the boot effect and a Page Builder mount can
 * both ask, and two concurrent clones into one IndexedDB would corrupt it
 * (the Web Lock in `git-fs.ts` protects across TABS; this protects within
 * one).
 */
export function ensureRepoReady(adminPath: string): Promise<void> {
  inFlight ??= run(adminPath).finally(() => {
    inFlight = undefined;
  });
  return inFlight;
}

async function run(adminPath: string): Promise<void> {
  try {
    const config = await fetchGitConfig(adminPath);
    if (!config.configured) {
      patch({ phase: "unconfigured", repo: config.repo, branch: config.branch });
      return;
    }
    patch({ phase: "cloning", repo: config.repo, branch: config.branch, error: null, progress: "" });

    const { ensureCloned, status } = await import("./git-repo.js");
    const result = await ensureCloned({
      adminPath,
      branch: config.branch,
      onProgress: (progress) => patch({ progress: progress.phase }),
    });
    const current = await status();
    patch({
      phase: result.diverged ? "diverged" : "ready",
      head: result.head,
      dirty: current.dirty,
      progress: "",
    });
  } catch (error) {
    patch({ phase: "error", progress: "", error: error instanceof Error ? error.message : "The git working copy could not be prepared." });
  }
}

/** Re-reads the dirty list after a local write - cheap (no network). */
export async function refreshGitStatus(): Promise<void> {
  if (gitState.value.phase === "unconfigured") return;
  try {
    const { status } = await import("./git-repo.js");
    const current = await status();
    patch({ head: current.head, dirty: current.dirty });
  } catch {
    // A status read failing is never worth interrupting an edit for; the
    // next real operation surfaces the same problem with context.
  }
}
