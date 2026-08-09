export interface GithubSyncTriggerResult {
  pushed: boolean;
  commitSha?: string;
  reason?: string;
}

/**
 * POSTs to `routes/pages-source-github-sync.ts` - a best-effort snapshot
 * commit of the pages-source tree, called AFTER a build's own
 * `publishBuiltPage(s)` has already succeeded (`PageEditor.tsx`'s Build
 * current/Build all, `PageBuild.tsx`'s Build all - see
 * `status/pages-source-github-versioning.md`). Never throws: a GitHub
 * outage, a missing/invalid token, or the feature simply being turned off
 * must never look like a failed publish to the caller, so every failure
 * mode (network error, non-2xx, the route's own `{pushed:false}`) folds
 * into the same return shape instead of an exception a build handler would
 * otherwise need its own try/catch for.
 */
export async function triggerGithubSync(githubSyncEndpoint: string, message: string): Promise<GithubSyncTriggerResult> {
  try {
    const response = await fetch(githubSyncEndpoint, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message }),
    });
    if (!response.ok) return { pushed: false, reason: `HTTP ${response.status}` };
    return (await response.json()) as GithubSyncTriggerResult;
  } catch (error) {
    return { pushed: false, reason: error instanceof Error ? error.message : "GitHub sync request failed." };
  }
}
