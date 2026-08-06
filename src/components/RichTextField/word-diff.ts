/**
 * Word-level diff for `ai-rewrite-button.tsx`'s "Rewrite selection" preview
 * (`status/magic-write.md` Phase 4, user request: "cần có UI diff để người
 * dùng biết" - the plain rendered preview alone didn't show WHAT changed).
 * Hand-rolled LCS diff, not a library - see `feedback_prefer_api_over_library`
 * memory (this is display logic, not a parsing/security job); the codebase
 * had no existing text-diff algorithm to reuse (`entry-draft-diff.ts`'s own
 * "diff" only compares whole field values, never sub-string).
 */

export interface WordDiffOp {
  type: "same" | "add" | "remove";
  text: string;
}

/** Splits on runs of whitespace, keeping the whitespace itself as its own
 * token (so it participates in the diff too, e.g. a paragraph break turning
 * into a single space reads as one changed token instead of vanishing
 * silently) - `Boolean` filters out the empty strings `split` leaves at the
 * string's own start/end. */
function tokenize(text: string): string[] {
  return text.split(/(\s+)/).filter((token) => token.length > 0);
}

/** Adjacent same-type ops are joined into one, so e.g. "This is a test" all
 * unchanged renders as a single `<span>` instead of one per word. */
function mergeAdjacent(ops: WordDiffOp[]): WordDiffOp[] {
  const merged: WordDiffOp[] = [];
  for (const op of ops) {
    const last = merged[merged.length - 1];
    if (last && last.type === op.type) last.text += op.text;
    else merged.push({ ...op });
  }
  return merged;
}

/**
 * Classic LCS-backtrack word diff: build the longest-common-subsequence
 * length table, then walk it front-to-back preferring whichever branch keeps
 * more of the eventual LCS ahead - the standard "same/remove/add" diff
 * output. O(n*m) in token count, fine for a single rewritten passage
 * (`handleRewriteSelection`'s own 20,000-char cap keeps this bounded).
 */
export function diffWords(before: string, after: string): WordDiffOp[] {
  const a = tokenize(before);
  const b = tokenize(after);
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
    }
  }
  const ops: WordDiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ type: "same", text: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) {
      ops.push({ type: "remove", text: a[i]! });
      i++;
    } else {
      ops.push({ type: "add", text: b[j]! });
      j++;
    }
  }
  while (i < n) ops.push({ type: "remove", text: a[i++]! });
  while (j < m) ops.push({ type: "add", text: b[j++]! });
  return mergeAdjacent(ops);
}

/** Plain-text extraction for the diff above - display-only (the actual
 * document mutation always goes through the real `sanitizeAiRichTextHtml` +
 * `importCleanHtmlFragment` path, never this). Regex-based rather than a
 * detached-element/DOMParser round-trip, matching `ai-richtext-sanitize.ts`'s
 * own reasoning for staying off the DOM here. */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|h[2-6]|blockquote|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .trim();
}
