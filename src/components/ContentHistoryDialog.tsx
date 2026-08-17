import { useEffect, useState } from "preact/hooks";
import { useDialogSync } from "../hooks/list-nav.js";
import { useOverlayScrollbars } from "../hooks/overlayscrollbars.js";
import {
  getContentHistoryCommit,
  getContentHistoryFile,
  listContentHistory,
  type ContentHistoryCommit,
  type ContentHistoryCommitFile,
  type ContentHistoryTarget,
} from "../content-types/content-history-http-api.js";

interface Props {
  open: boolean;
  adminPath: string;
  target: ContentHistoryTarget;
  label: string;
  onClose: () => void;
}

/**
 * Read-only git history for ONE entry/singleton/content-type schema
 * (`plans/history-content.md`) - the content counterpart of
 * `page-components/page-builder/HistoryDialog.tsx`, but scoped to a single
 * `content/` JSON file via `content-history-http-api.ts` instead of page
 * source, and permission-gated per-resource server-side rather than on the
 * blanket Page Builder grant. No revert/restore action (decision #4): just
 * the commit list, each one's diff stat, and the raw JSON at that commit.
 */
export default function ContentHistoryDialog(props: Props) {
  const ref = useDialogSync(props.open, props.onClose);
  const { ref: historyScroll } = useOverlayScrollbars<HTMLDivElement>([props.open]);
  const [commits, setCommits] = useState<ContentHistoryCommit[]>([]);
  const [details, setDetails] = useState<Record<string, ContentHistoryCommitFile[]>>({});
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<Set<string>>(() => new Set());

  async function load(nextPage: number) {
    setLoading(true);
    try {
      const result = await listContentHistory(props.adminPath, props.target, { limit: 30, page: nextPage });
      setCommits((current) => (nextPage === 1 ? result.commits : [...current, ...result.commits]));
      setPage(nextPage);
      // `reason` can be set even when `configured` is true - `listSnapshotCommits`
      // (`git-source-sync.ts`) still reports a real API failure (bad token,
      // unreachable repo, ...) that way, and that must surface here too, not
      // just the "never configured at all" case.
      setError(result.reason ?? (result.configured ? null : "Git isn't configured."));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load history.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (props.open) void load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-fetch only when the dialog (re)opens or the target changes, not on every re-render
  }, [props.open, "schema" in props.target ? props.target.schema : `${props.target.type}:${props.target.entryId ?? ""}`]);

  async function expand(sha: string) {
    if (details[sha] || busy.has(sha)) return;
    setBusy((current) => new Set(current).add(sha));
    try {
      const detail = await getContentHistoryCommit(props.adminPath, sha);
      setDetails((current) => ({ ...current, [sha]: detail.files }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load commit.");
    } finally {
      setBusy((current) => {
        const next = new Set(current);
        next.delete(sha);
        return next;
      });
    }
  }

  async function viewFile(sha: string) {
    if (sha in fileContents || busy.has(sha)) return;
    setBusy((current) => new Set(current).add(sha));
    try {
      const result = await getContentHistoryFile(props.adminPath, props.target, sha);
      setFileContents((current) => ({ ...current, [sha]: result.missing ? "" : (result.content ?? "") }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to load this version.");
    } finally {
      setBusy((current) => {
        const next = new Set(current);
        next.delete(sha);
        return next;
      });
    }
  }

  return (
    <dialog ref={ref} class="lg" aria-label={`History · ${props.label}`}>
      {props.open && (
        <>
          <header><h3>History · {props.label}</h3></header>
          {error && <p class="error">{error}</p>}
          <div ref={historyScroll} class="under page-builder-history-scroll">
            <div class="stack page-builder-history-list">
              {commits.map((commit) => (
                <details key={commit.sha} onToggle={(event) => { if ((event.currentTarget as HTMLDetailsElement).open) void expand(commit.sha); }}>
                  <summary>
                    <span class="page-builder-history-summary">
                      <strong>{commit.message.split("\n")[0]}</strong>
                      <span class="page-builder-history-meta">
                        <span class="badge sm secondary mono">{commit.sha.slice(0, 7)}</span>
                        <span class="badge sm info">{commit.authorName}</span>
                        <time class="badge sm outline" dateTime={commit.date}>{new Date(commit.date).toLocaleString()}</time>
                      </span>
                    </span>
                  </summary>
                  {busy.has(commit.sha) && !details[commit.sha] && (
                    <div class="row page-builder-history-loading"><span class="spinner" aria-hidden="true" /><span>Loading changes…</span></div>
                  )}
                  {details[commit.sha]?.length === 0 && <p class="hint page-builder-history-empty">No file changes.</p>}
                  {details[commit.sha]?.map((file) => (
                    <div class="row" key={file.path}>
                      <code>{file.path}</code>
                      {file.status === "added" ? <span class="badge sm success">New</span> : <span class="page-builder-history-stats"><span class="additions">+{file.additions}</span><span class="deletions">-{file.deletions}</span></span>}
                    </div>
                  ))}
                  <div class="row" style={{ marginTop: ".5rem" }}>
                    <button type="button" class="outline sm" disabled={busy.has(commit.sha)} onClick={() => void viewFile(commit.sha)}>
                      View this version
                    </button>
                  </div>
                  {commit.sha in fileContents && (
                    <pre class="page-builder-history-file"><code>{fileContents[commit.sha] || "(deleted at this commit)"}</code></pre>
                  )}
                </details>
              ))}
              {loading && commits.length === 0 && <div class="page-builder-history-loading"><span class="spinner" aria-hidden="true" /><span class="hint">Loading history…</span></div>}
              {!loading && commits.length === 0 && !error && <p class="hint">No commits found.</p>}
            </div>
          </div>
          <footer>
            <button type="button" class="outline" disabled={loading} aria-busy={loading || undefined} onClick={() => void load(page + 1)}>Load more</button>
            <button type="button" onClick={props.onClose}>Close</button>
          </footer>
        </>
      )}
    </dialog>
  );
}
