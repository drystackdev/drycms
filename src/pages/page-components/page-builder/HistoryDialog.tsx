import { useEffect, useState } from "preact/hooks";
import { useDialogSync } from "../../../hooks/list-nav.js";
import { getHistoryCommit, listHistory, type HistoryCommit, type HistoryCommitFile } from "../../../page-components/git/history-http-api.js";

interface Props {
  open: boolean;
  adminPath: string;
  filePath?: string;
  onReviewFile: (commit: HistoryCommit, path: string) => void;
  onReviewCommit: (commit: HistoryCommit) => void;
  onClose: () => void;
}

export default function HistoryDialog(props: Props) {
  const ref = useDialogSync(props.open, props.onClose);
  const [commits, setCommits] = useState<HistoryCommit[]>([]);
  const [details, setDetails] = useState<Record<string, HistoryCommitFile[]>>({});
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
    if (details[sha]) return;
    try {
      const detail = await getHistoryCommit(props.adminPath, sha);
      setDetails((current) => ({ ...current, [sha]: detail.files }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Failed to load commit."); }
  }

  return <dialog ref={ref} class="lg" aria-label={props.filePath ? `History of ${props.filePath}` : "Page source history"}>
    <header><h3>{props.filePath ? `History · ${props.filePath}` : "Page source history"}</h3></header>
    {error && <p class="error">{error}</p>}
    <div class="stack page-builder-history-list">
      {commits.map((commit) => <details key={commit.sha} onToggle={(event) => { if ((event.currentTarget as HTMLDetailsElement).open) void expand(commit.sha); }}>
        <summary><strong>{commit.message.split("\n")[0]}</strong> <span class="hint">{commit.sha.slice(0, 7)} · {commit.authorName} · {new Date(commit.date).toLocaleString()}</span></summary>
        {details[commit.sha]?.map((file) => <div class="row" key={file.path}><code>{file.path}</code><span class="hint">+{file.additions}/-{file.deletions}</span></div>)}
        <div class="row" style={{ marginTop: ".5rem" }}>
          {props.filePath && <button type="button" class="outline sm" onClick={() => props.onReviewFile(commit, props.filePath!)}>View this file</button>}
          <button type="button" class="sm" onClick={() => props.onReviewCommit(commit)}>Review commit</button>
        </div>
      </details>)}
      {!loading && commits.length === 0 && !error && <p class="hint">No commits found.</p>}
    </div>
    <footer><button type="button" class="outline" disabled={loading} onClick={() => void load(page + 1)}>Load more</button><button type="button" onClick={props.onClose}>Close</button></footer>
  </dialog>;
}
