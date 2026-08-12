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
 *   tree (`pages/`/`component/`/`styles/`/`md/`) - read through the same
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
import { readGeneratedDryTypes } from "../../content-types/types-cache.js";
import { MD_ROOT } from "../app-router/source-roots.js";

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

/** `path` is ignored - this root always resolves to the one generated
 * `dry.generated.d.ts` file (`content-types/types-cache.ts`'s
 * `readGeneratedDryTypes`), the real, current `dry()` collection/singleton
 * names and field shapes. */
async function readGeneratedTypes(context: DryRouteContext): Promise<PageSourceReadResult> {
  const label = "Reading dry() types…";
  try {
    const text = await readGeneratedDryTypes(context);
    return { label, resultText: `This project's generated dry() types (dry.generated.d.ts):\n\`\`\`ts\n${truncate(text)}\n\`\`\`` };
  } catch (error) {
    return { label, resultText: `Could not read the generated dry() types: ${error instanceof Error ? error.message : "unknown error"}.` };
  }
}

export async function executePageSourceRead(context: DryRouteContext, turn: PageSourceReadTurn): Promise<PageSourceReadResult> {
  if (turn.root === "docs") return readDoc(turn.path);
  if (turn.root === "types") return readGeneratedTypes(context);
  return readSourceFile(context, turn.path);
}

const MD_README_PATH = `${MD_ROOT}/README.md`;
/** Smaller than `MAX_READ_CHARS` above - this is embedded in EVERY Magic
 * Chat turn (`buildPageSourceSystemPrompt`'s `projectContext`), unlike an
 * on-demand `kind: read`, so a runaway README costs every turn's token
 * budget, not just one hop's. */
const MAX_README_CHARS = 20_000;

/** `md/README.md`'s content (`MD_ROOT`), if the project has written one -
 * this project's own admin-authored context for Magic Chat/MCP, always
 * embedded in the system prompt the same way `ai-page-source-docs.ts`'s
 * `PAGE_SOURCE_README` already is (see `ai-page-source-prompt.ts`). `null`
 * for "no such file yet" AND for any read failure alike - this is a
 * best-effort orientation aid, never something worth failing the whole
 * Magic Chat turn over. */
export async function readProjectReadme(context: DryRouteContext): Promise<string | null> {
  try {
    const adapter = getStorageAdapter(pagesSourceStorage, context);
    const stat = await adapter.stat(MD_README_PATH);
    if (!stat || stat.kind !== "file") return null;
    const file = await adapter.read(MD_README_PATH);
    const chunks: Buffer[] = [];
    for await (const chunk of file.stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const text = Buffer.concat(chunks).toString("utf-8");
    return text.length > MAX_README_CHARS
      ? `${text.slice(0, MAX_README_CHARS)}\n… (truncated - read "${MD_README_PATH}" via \`kind: read\` for the rest)`
      : text;
  } catch {
    return null;
  }
}
