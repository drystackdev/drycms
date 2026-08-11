/**
 * Executes a `kind: read` turn (`ai-page-source-protocol.ts`) - the Page
 * Editor's Magic Chat looking at a file OTHER than the one it's editing,
 * before replying. Called from `ai-page-source-write.ts`'s loop, never from
 * the client directly - never a terminal SSE `turn` event, just a
 * `resultText` folded back into the conversation as a synthetic message
 * before the model gets another turn. Same non-terminal shape
 * `ai-magic-write-fetch.ts`'s `executeMagicFetch` has for `kind: fetch`.
 *
 * Two allowed roots, each resolved independently:
 * - `root: "source"` - another file in THIS project's own `pagesSourceStorage`
 *   tree (`pages/`/`component/`/`styles/`) - read through the same
 *   `StorageAdapter` `pages-source.ts`'s own `GET` uses, so path
 *   normalization/sandboxing is identical; a path outside the storage root
 *   simply resolves to nothing (`stat()` returns `null`), never a traversal.
 * - `root: "docs"` - one of this repo's own `docs/*.md` reference docs,
 *   bundled at build time (`ai-page-source-docs.ts`) - a fixed, compile-time
 *   set of keys, so there's no path-traversal surface here at all (an
 *   unrecognized key just means "not found").
 */
import { pagesSourceStorage } from "../config.js";
import type { DryRouteContext } from "../context.js";
import { getStorageAdapter } from "../storage-adapters.js";
import { normalizeStoragePath } from "../../storage/path.js";
import type { PageSourceReadTurn } from "../../page-components/ai-page-source-protocol.js";
import { PAGE_SOURCE_DOCS } from "../../page-components/ai-page-source-docs.js";

export interface PageSourceReadResult {
  /** Short status shown to the admin while this hop runs (`{reading}` SSE
   * event) - never the file's own contents. */
  label: string;
  /** Folded into the conversation as a synthetic `user` message. */
  resultText: string;
}

/** Generous but bounded - a source file could in principle be huge; this
 * keeps one lookup from blowing the whole turn's token budget. Same order of
 * magnitude as `ai-magic-write.ts`'s `rewritePassage` cap, scaled up for
 * whole files rather than one passage. */
const MAX_READ_CHARS = 60_000;

function truncate(text: string): string {
  return text.length > MAX_READ_CHARS ? `${text.slice(0, MAX_READ_CHARS)}\n… (truncated - this file is longer than what's shown here)` : text;
}

async function readSourceFile(context: DryRouteContext, path: string): Promise<PageSourceReadResult> {
  const normalized = normalizeStoragePath(path);
  const label = `Reading "${normalized}"…`;
  try {
    const adapter = getStorageAdapter(pagesSourceStorage, context);
    const stat = await adapter.stat(normalized);
    if (!stat || stat.kind !== "file") {
      return { label, resultText: `No file at "${normalized}" in this project's source tree.` };
    }
    const file = await adapter.read(normalized);
    const chunks: Buffer[] = [];
    for await (const chunk of file.stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString("utf-8");
    return { label, resultText: `Contents of "${normalized}":\n\`\`\`\n${truncate(text)}\n\`\`\`` };
  } catch (error) {
    return { label, resultText: `Could not read "${normalized}": ${error instanceof Error ? error.message : "unknown error"}.` };
  }
}

function readDoc(path: string): PageSourceReadResult {
  const key = path.replace(/^\/+/, "");
  const label = `Reading "${key}"…`;
  const content = PAGE_SOURCE_DOCS[key];
  if (content === undefined) {
    const available = Object.keys(PAGE_SOURCE_DOCS).sort().join(", ") || "(none)";
    return { label, resultText: `No doc at "${key}". Available: ${available}.` };
  }
  return { label, resultText: `Contents of "${key}":\n${truncate(content)}` };
}

export async function executePageSourceRead(context: DryRouteContext, turn: PageSourceReadTurn): Promise<PageSourceReadResult> {
  return turn.root === "docs" ? readDoc(turn.path) : readSourceFile(context, turn.path);
}
