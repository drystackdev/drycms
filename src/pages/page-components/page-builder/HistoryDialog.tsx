import { useEffect, useState } from "preact/hooks";
import { useDialogSync } from "../../../hooks/list-nav.js";
import { useOverlayScrollbars } from "../../../hooks/overlayscrollbars.js";
import { getHistoryCommit, listHistory, type HistoryCommit, type HistoryCommitFile } from "../../../page-components/git/history-http-api.js";

interface Props {
  open: boolean;
  adminPath: string;
  filePath?: string;
  onReviewFile: (commit: HistoryCommit, path: string) => void;
  onReviewCommit: (commit: HistoryCommit) => void;
  onClose: () => void;
}

/** `[CONTENT] `-prefixed commits are git-mirrored D1 content
 * (`plans/history-content.md`) - everything else, including a commit from
 * before that feature existed (no prefix at all), is Code. Only meaningful
 * when `filePath` is unset (the dock's whole-repo view): scoped to one
 * page-source path, `listHistory`'s own `path` filter never returns a
 * content commit in the first place, so there's nothing to split. */
function isContentCommitMessage(message: string): boolean {
  return message.startsWith("[CONTENT] ");
}

export default function HistoryDialog(props: Props) {
  const ref = useDialogSync(props.open, props.onClose);
  const { ref: historyScroll } = useOverlayScrollbars<HTMLDivElement>([props.open]);
  const [commits, setCommits] = useState<HistoryCommit[]>([]);
  const [details, setDetails] = useState<Record<string, HistoryCommitFile[]>>({});
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingDetails, setLoadingDetails] = useState<Set<string>>(() => new Set());
  const [activeTab, setActiveTab] = useState<"code" | "content">("code");
  const showTabs = !props.filePath;
  const visibleCommits = showTabs
    ? commits.filter((commit) => isContentCommitMessage(commit.message) === (activeTab === "content"))
    : commits;

  async function load(nextPage: number) {
    setLoading(true);
    try {
      const result = await listHistory(props.adminPath, { path: props.filePath, limit: 30, page: nextPage });
      setCommits((current) => nextPage === 1 ? result.commits : [...current, ...result.commits]);
      setPage(nextPage);
      setError(result.reason ?? null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Failed to load history."); }
    finally { setLoading(false); }
  }

  useEffect(() => { if (props.open) void load(1); }, [props.open, props.filePath]);

  async function expand(sha: string) {
    if (details[sha] || loadingDetails.has(sha)) return;
    setLoadingDetails((current) => new Set(current).add(sha));
    try {
      const detail = await getHistoryCommit(props.adminPath, sha);
      setDetails((current) => ({ ...current, [sha]: detail.files }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Failed to load commit."); }
    finally {
      setLoadingDetails((current) => {
        const next = new Set(current);
        next.delete(sha);
        return next;
      });
    }
  }

  return <dialog ref={ref} class="lg" aria-label={props.filePath ? `History of ${props.filePath}` : "Page source history"}>
    <header><h3>{props.filePath ? `History · ${props.filePath}` : "Page source history"}</h3></header>
    {showTabs && (
      <div class="row page-builder-history-tabs" role="tablist">
        <button type="button" role="tab" class="sm" aria-selected={activeTab === "code"} onClick={() => setActiveTab("code")}>Code</button>
        <button type="button" role="tab" class="sm" aria-selected={activeTab === "content"} onClick={() => setActiveTab("content")}>Content</button>
      </div>
    )}
    {error && <p class="error">{error}</p>}
    <div ref={historyScroll} class="under page-builder-history-scroll"><div class="stack page-builder-history-list">
      {visibleCommits.map((commit) => <details key={commit.sha} onToggle={(event) => { if ((event.currentTarget as HTMLDetailsElement).open) void expand(commit.sha); }}>
        <summary><span class="page-builder-history-summary"><strong>{commit.message.split("\n")[0]}</strong><span class="page-builder-history-meta"><span class="badge sm secondary mono">{commit.sha.slice(0, 7)}</span><span class="badge sm info">{commit.authorName}</span><time class="badge sm outline" dateTime={commit.date}>{new Date(commit.date).toLocaleString()}</time></span></span></summary>
        {loadingDetails.has(commit.sha) && <div class="row page-builder-history-loading"><span class="spinner" aria-hidden="true" /><span>Loading changes…</span></div>}
        {details[commit.sha]?.length === 0 && <p class="hint page-builder-history-empty">No file changes.</p>}
        {details[commit.sha]?.map((file) => <div class="row" key={file.path}><code>{file.path}</code>{file.status === "added" ? <span class="badge sm success">New</span> : <span class="page-builder-history-stats"><span class="additions">+{file.additions}</span><span class="deletions">-{file.deletions}</span></span>}</div>)}
        {activeTab === "code" && (
          <div class="row" style={{ marginTop: ".5rem" }}>
            {props.filePath && <button type="button" class="outline sm" onClick={() => props.onReviewFile(commit, props.filePath!)}>View this file</button>}
            <button type="button" class="sm" onClick={() => props.onReviewCommit(commit)}>Review commit</button>
          </div>
        )}
      </details>)}
      {loading && commits.length === 0 && <div class="page-builder-history-loading"><span class="spinner" aria-hidden="true" /><span class="hint">Loading history…</span></div>}
      {!loading && visibleCommits.length === 0 && !error && <p class="hint">No commits found.</p>}
    </div></div>
    <footer><button type="button" class="outline" disabled={loading} aria-busy={loading || undefined} onClick={() => void load(page + 1)}>Load more</button><button type="button" onClick={props.onClose}>Close</button></footer>
  </dialog>;
}
