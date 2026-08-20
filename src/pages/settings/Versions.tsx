import { useEffect, useMemo, useState } from "preact/hooks";
const { path } = window.__DRY_CONFIG__;
import ConfirmDialog from "../../components/ConfirmDialog.js";
import { useDialogSync } from "../../hooks/list-nav.js";
import { toast } from "../../components/Toast.js";
import { createContentTypesApi, listCached } from "../../content-types/http-api.js";
import { CONTENT_TYPES_RESOURCE_ID, PAGE_BUILDER_RESOURCE_ID } from "../../content-types/permissions.js";
import { publishAllPages } from "../../page-components/initial-publish.js";
import { gitState } from "../../page-components/git/git-state.js";
import {
  getVersionCommit,
  getVersionFile,
  listVersions,
  restoreVersion,
  type HistoryCommit,
  type HistoryCommitFile,
  type RestorePlan,
} from "../../page-components/git/versions-http-api.js";
import { canAccess } from "../../store/auth.js";
import { useDocumentTitle } from "../page-common.js";

/** `[CONTENT] `-prefixed commits are content (entries + the content-type
 * document); everything else - including anything committed before content
 * mirroring existed - is code. Same rule `PageBuilder`'s own History dialog
 * uses, kept here rather than shared because it is two lines and each screen
 * labels it differently. */
function isContentCommit(message: string): boolean {
  return message.startsWith("[CONTENT] ");
}

const PAGE_SIZE = 30;

interface ViewedFile {
  sha: string;
  path: string;
  content: string;
}

/**
 * Settings -> Versions (`status/git-versions-page.md`): the tenant's whole
 * git history in one list, and "go back to this commit" for any entry in it.
 *
 * What "go back" means here is deliberately broad - page source, the
 * content-type schema and mirrored entry rows all move together, because a
 * commit describes all three (`server/git-restore.ts`). It is also
 * deliberately forward-only: restoring pushes a NEW commit rather than
 * rewinding the branch, so nothing anyone else pushed is ever lost, and the
 * restore itself shows up in this same list.
 *
 * Reading history only needs the Git Sync setting grant (the same one that
 * puts this page in the nav). Restoring additionally needs the Page Builder
 * and content-type grants - it rewrites executable page source and runs real
 * migrations - so the Restore buttons simply aren't rendered without them.
 */
export default function Versions() {
  useDocumentTitle("Versions");
  const typesApi = useMemo(() => createContentTypesApi(`${path}/api/content-types`), []);

  const [commits, setCommits] = useState<HistoryCommit[]>([]);
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [details, setDetails] = useState<Record<string, HistoryCommitFile[]>>({});
  const [loadingDetails, setLoadingDetails] = useState<Set<string>>(() => new Set());
  const [openPatches, setOpenPatches] = useState<Set<string>>(() => new Set());
  const [viewed, setViewed] = useState<ViewedFile | null>(null);

  const [pending, setPending] = useState<{ commit: HistoryCommit; plan: RestorePlan } | null>(null);
  const [planning, setPlanning] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  const canRestore = canAccess(PAGE_BUILDER_RESOURCE_ID, "setting") && canAccess(CONTENT_TYPES_RESOURCE_ID, "setting");

  async function load(nextPage: number) {
    setLoading(true);
    try {
      const result = await listVersions(path, { limit: PAGE_SIZE, page: nextPage });
      setConfigured(result.configured);
      setRepo(result.repo ?? "");
      setBranch(result.branch ?? "");
      setCommits((current) => (nextPage === 1 ? result.commits : [...current, ...result.commits]));
      setHasMore(result.commits.length === PAGE_SIZE);
      setPage(nextPage);
      setError(result.reason ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load the repository history.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function expand(sha: string) {
    if (details[sha] || loadingDetails.has(sha)) return;
    setLoadingDetails((current) => new Set(current).add(sha));
    try {
      const detail = await getVersionCommit(path, sha);
      setDetails((current) => ({ ...current, [sha]: detail.files }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load this commit.");
    } finally {
      setLoadingDetails((current) => {
        const next = new Set(current);
        next.delete(sha);
        return next;
      });
    }
  }

  async function viewFile(sha: string, filePath: string) {
    try {
      const file = await getVersionFile(path, sha, filePath);
      setViewed({ sha, path: filePath, content: file.missing ? "(this file does not exist at this commit)" : file.content ?? "" });
    } catch (cause) {
      toast.add({ type: "error", title: cause instanceof Error ? cause.message : "Failed to read the file." });
    }
  }

  /** Step 1 of a restore: ask the server what it WOULD change, so the
   * confirm dialog can name the data-losing parts before anything is
   * written. */
  async function planRestore(commit: HistoryCommit) {
    setPlanning(commit.sha);
    try {
      const plan = await restoreVersion(path, commit.sha, "plan");
      setPending({ commit, plan });
    } catch (cause) {
      toast.add({ type: "error", title: cause instanceof Error ? cause.message : "Could not prepare the restore." });
    } finally {
      setPlanning(null);
    }
  }

  /** Step 2: apply, re-sync the browser's git working copy so Page Builder
   * doesn't keep showing the pre-restore tree, then rebuild and publish -
   * compiling pages only happens in the browser, so this half can't live on
   * the server. */
  async function applyRestore() {
    if (!pending) return;
    setRestoring(true);
    try {
      const result = await restoreVersion(path, pending.commit.sha, "apply");
      for (const message of result.errors) toast.add({ type: "error", title: message });
      if (result.commitReason) toast.add({ type: "default", title: `Restored, but not committed: ${result.commitReason}` });

      if (gitState.value.phase !== "unconfigured") {
        const { resyncWorkingCopy } = await import("../../page-components/git/git-repo.js");
        await resyncWorkingCopy({ adminPath: path, branch: gitState.value.branch });
      }

      toast.add({ type: "success", title: `Restored ${pending.commit.sha.slice(0, 7)} - rebuilding pages…` });
      const allTypes = await listCached(typesApi);
      const published = await publishAllPages(path, allTypes, (message) => toast.add({ type: "default", title: message }));
      if (published.error) toast.add({ type: "error", title: `Rebuild failed: ${published.error}` });

      setPending(null);
      setDetails({});
      await load(1);
    } catch (cause) {
      toast.add({ type: "error", title: cause instanceof Error ? cause.message : "The restore failed." });
    } finally {
      setRestoring(false);
    }
  }

  const plan = pending?.plan;
  const destructive = (plan?.schema.destructive.length ?? 0) > 0 || (plan?.entries.remove ?? 0) > 0 || (plan?.source.remove.length ?? 0) > 0;

  return (
    <>
      <div class="page-header">
        <div style={{ flex: 1 }}>
          <h1>Versions</h1>
          <p>Every commit on this project's branch - page code, content types and entries - and one click back to any of them.</p>
        </div>
      </div>

      {configured === false && (
        <section class="card">
          <header><h2>No repository connected</h2></header>
          <div class="under stack">
            <p class="hint">
              Versions reads this project's git history, so it needs a repository first. Connect one under{" "}
              <a href={`${path}/settings/github-sync`}>Settings → Git Sync</a>.
            </p>
            {error && <span class="error">{error}</span>}
          </div>
        </section>
      )}

      {configured !== false && (
        <section class="card">
          <header>
            <h2>History</h2>
            <p>{repo ? `${repo} · ${branch}` : "Loading…"}</p>
          </header>
          <div class="under stack">
            {error && <span class="error">{error}</span>}
            {!canRestore && commits.length > 0 && (
              <p class="hint">You can read this history, but restoring a commit needs the Page Builder and content type permissions.</p>
            )}

            <div class="stack versions-list">
              {commits.map((commit) => (
                <details
                  key={commit.sha}
                  onToggle={(event) => {
                    if ((event.currentTarget as HTMLDetailsElement).open) void expand(commit.sha);
                  }}
                >
                  <summary>
                    <span class="versions-summary">
                      <strong>{commit.message.split("\n")[0]}</strong>
                      <span class="versions-meta">
                        <span class={`badge sm ${isContentCommit(commit.message) ? "warning" : "info"}`}>
                          {isContentCommit(commit.message) ? "Content" : "Code"}
                        </span>
                        <span class="badge sm secondary mono">{commit.sha.slice(0, 7)}</span>
                        <span class="badge sm outline">{commit.authorName}</span>
                        <time class="badge sm outline" dateTime={commit.date}>{new Date(commit.date).toLocaleString()}</time>
                      </span>
                    </span>
                  </summary>

                  {loadingDetails.has(commit.sha) && (
                    <div class="row versions-loading"><span class="spinner" aria-hidden="true" /><span>Loading changes…</span></div>
                  )}
                  {details[commit.sha]?.length === 0 && <p class="hint">This commit changes nothing drycms owns.</p>}
                  {details[commit.sha]?.map((file) => {
                    const key = `${commit.sha}:${file.path}`;
                    return (
                      <div class="stack versions-file" key={key}>
                        <div class="row">
                          <code>{file.path}</code>
                          {file.status === "added" && <span class="badge sm success">New</span>}
                          {file.status === "removed" && <span class="badge sm destructive">Deleted</span>}
                          <span class="versions-stats">
                            <span class="additions">+{file.additions}</span>
                            <span class="deletions">-{file.deletions}</span>
                          </span>
                          {file.patch && (
                            <button
                              type="button"
                              class="outline sm"
                              onClick={() => setOpenPatches((current) => {
                                const next = new Set(current);
                                if (next.has(key)) next.delete(key);
                                else next.add(key);
                                return next;
                              })}
                            >
                              {openPatches.has(key) ? "Hide diff" : "Diff"}
                            </button>
                          )}
                          <button type="button" class="outline sm" onClick={() => void viewFile(commit.sha, file.path)}>
                            View file
                          </button>
                        </div>
                        {openPatches.has(key) && file.patch && <pre class="scroll versions-patch">{file.patch}</pre>}
                      </div>
                    );
                  })}

                  {canRestore && (
                    <div class="row versions-actions">
                      <button
                        type="button"
                        class="sm"
                        disabled={planning !== null}
                        aria-busy={planning === commit.sha}
                        onClick={() => void planRestore(commit)}
                      >
                        Restore this version
                      </button>
                    </div>
                  )}
                </details>
              ))}

              {loading && commits.length === 0 && (
                <div class="row versions-loading"><span class="spinner" aria-hidden="true" /><span class="hint">Loading history…</span></div>
              )}
              {!loading && commits.length === 0 && !error && <p class="hint">No commits yet.</p>}
            </div>

            {hasMore && (
              <div class="row">
                <button type="button" class="outline" disabled={loading} aria-busy={loading || undefined} onClick={() => void load(page + 1)}>
                  Load more
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      <ConfirmDialog
        open={pending !== null}
        size="lg"
        title={`Restore ${pending?.commit.sha.slice(0, 7) ?? ""}?`}
        destructive={destructive}
        busy={restoring}
        confirmLabel={restoring ? "Restoring…" : "Restore and publish"}
        onCancel={() => (restoring ? undefined : setPending(null))}
        onConfirm={() => void applyRestore()}
        message={plan ? (
          <div class="stack">
            <p>
              This puts the project back to <strong>{pending?.commit.message.split("\n")[0]}</strong>, then rebuilds and
              publishes the site. It is committed as a new commit - nothing already in the history is removed.
            </p>
            <ul>
              <li>{plan.source.write.length} page-source {plan.source.write.length === 1 ? "file" : "files"} rewritten, {plan.source.remove.length} deleted</li>
              <li>
                {plan.schema.apply.length} content {plan.schema.apply.length === 1 ? "type" : "types"} re-applied
                {plan.schema.remove.length > 0 && <>, <strong>{plan.schema.remove.length} deleted</strong> ({plan.schema.remove.join(", ")})</>}
              </li>
              <li>{plan.entries.restore} {plan.entries.restore === 1 ? "entry" : "entries"} restored, {plan.entries.remove} removed</li>
            </ul>
            {plan.schema.destructive.length > 0 && (
              <div class="stack">
                <strong class="error">These schema changes drop data:</strong>
                <ul>
                  {plan.schema.destructive.map((change, index) => (
                    <li key={index}>{[change.contentTypeName, change.tableName, change.columnName, change.kind].filter(Boolean).join(" · ")}</li>
                  ))}
                </ul>
              </div>
            )}
            {plan.warnings.map((warning) => <p class="hint" key={warning}>{warning}</p>)}
            {plan.errors.map((message) => <p class="error" key={message}>{message}</p>)}
          </div>
        ) : null}
      />

      <FileAtCommitDialog file={viewed} onClose={() => setViewed(null)} />
    </>
  );
}

/** One file's contents as of one commit - a plain read-only dialog rather
 * than a `ConfirmDialog`, which would put two buttons on a screen that has
 * nothing to confirm. */
function FileAtCommitDialog({ file, onClose }: { file: ViewedFile | null; onClose: () => void }) {
  const ref = useDialogSync(file !== null, onClose);
  return (
    <dialog ref={ref} class="xl" aria-label={file ? `${file.path} at ${file.sha.slice(0, 7)}` : "File"}>
      {file && (
        <>
          <header>
            <h3><code>{file.path}</code> @ {file.sha.slice(0, 7)}</h3>
          </header>
          <pre class="scroll versions-file-view">{file.content}</pre>
          <footer>
            <button type="button" onClick={onClose}>Close</button>
          </footer>
        </>
      )}
    </dialog>
  );
}
