/**
 * "Magic" for the Page Editor's wire format - a sibling copy of
 * `ai-magic-write-protocol.ts`'s hand-rolled YAML subset (same block-literal/
 * plain-scalar/mapping dialect, same parsing primitives), adapted for
 * editing raw `.tsx`/`.css` page-source files instead of content-entry
 * fields. Deliberately a separate module, not an extension of
 * `ai-magic-write-protocol.ts`: the two features share no turn shapes (no
 * `fields`/`relation`/`component-repeat` concept applies to a source file),
 * matching this codebase's own convention of small parallel copies over a
 * forced shared abstraction (see `ai-magic-write.ts`'s own doc comment on why
 * IT is a copy of `ai.ts`'s wizard rather than a shared helper).
 *
 * Four top-level turn kinds:
 * - `kind: chat` - an ordinary conversational reply, identical shape to
 *   Magic Write's own `chat` turn. The only TERMINAL kind - a request may
 *   chain several `code`/`read` turns, but always ends in `chat`.
 * - `kind: code` - the FULL new replacement source for ONE file, named by
 *   its own `path` (whole-file rewrite, not a patch/diff - see
 *   `status/page-editor-magic-chat.md`: the admin chose direct-write-while-
 *   streaming over a diff-preview gate, so there's no patch format to design
 *   for v1). Not limited to the file open in the editor, and NOT terminal -
 *   `ai-page-source-write.ts` applies it (streams it to the client, which
 *   writes it into that path's buffer) and loops back for another turn, so
 *   one request can touch several files in sequence before a final `chat`
 *   wraps up. Shape mirrors `fields`'s `summary` + payload pattern.
 * - `kind: read` - look at another file before replying (this project's own
 *   source tree, this repo's own `docs/*.md` reference docs, or the
 *   generated `dry()` types) - never terminal, looped back server-side by
 *   `ai-page-source-write.ts` for another turn, same non-terminal treatment
 *   `ai-magic-write-protocol.ts` gives `kind: fetch`.
 * - `kind: fetch` - look up content-type/entry/media data INSIDE drycms
 *   (not a file) before replying - the exact same concern and wire shape
 *   `ai-magic-write-protocol.ts` already has for the content-entry Magic
 *   Chat, reused as-is (`MagicWriteFetchTurn`/`validateFetchTurn`, imported
 *   rather than duplicated) since page-source authoring needs to look up
 *   the same kind of data (e.g. "what does this collection's real data look
 *   like"). Never terminal, same treatment as `kind: read`.
 */

import { validateFetchTurn as validateMagicWriteFetchTurn, type MagicWriteFetchTurn, type MagicWriteRawFields } from "../content-types/ai-magic-write-protocol.js";

export type PageSourceRawValue = string | PageSourceRawValue[] | PageSourceRawFields;

export interface PageSourceRawFields {
  [key: string]: PageSourceRawValue;
}

export interface PageSourceChatTurn {
  kind: "chat";
  text: string;
}

export interface PageSourceCodeTurn {
  kind: "code";
  /** The file this write targets - ANY path under `pages/`/`component/`/
   * `styles/`/`md/` (`source-roots.ts`), new or existing, not just whatever
   * happens to be open in the admin's editor right now. */
  path: string;
  summary: string;
  code: string;
}

export type PageSourceReadRoot = "source" | "docs" | "types";

/** Never terminal - `ai-page-source-write.ts` executes it (via
 * `ai-page-source-read.ts`) and loops back for another model reply, same
 * non-terminal treatment `MagicWriteFetchTurn` gets. `root: "source"` reads
 * another file in this project's own `pages/`/`component/`/`styles/` tree
 * (e.g. an imported component); `root: "docs"` reads one of this repo's own
 * `docs/*.md` reference docs (see `ai-page-source-prompt.ts`'s always-
 * embedded `docs/README.md` index); `root: "types"` reads this project's
 * generated `dry()` ambient types (`dry.generated.d.ts`) - the real, current
 * collection/singleton names and field shapes, straight from the live
 * schema (`path` is ignored for this root, there's exactly one file). */
export interface PageSourceReadTurn {
  kind: "read";
  root: PageSourceReadRoot;
  path: string;
}

export type PageSourceTurn = PageSourceChatTurn | PageSourceCodeTurn | PageSourceReadTurn | MagicWriteFetchTurn;

export type PageSourceValidationResult =
  | { ok: true; turn: PageSourceTurn }
  | { ok: false; error: string };

function isRawString(value: PageSourceRawValue | undefined): value is string {
  return typeof value === "string";
}

function isRawFields(value: PageSourceRawValue | undefined): value is PageSourceRawFields {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Strips a model reply down to just the dialect body - discards a fenced
 * ` ```yaml ` wrapper and any stray prose before the first `kind:` line.
 * Only used on a TERMINAL (fully received) reply, before `parsePageSourceYaml`
 * - see `extractMagicWriteYaml`'s identical doc comment.
 */
export function extractPageSourceYaml(raw: string): string {
  const fenced = /```(?:ya?ml)?\s*([\s\S]*?)```/i.exec(raw);
  const body = fenced ? fenced[1]! : raw;
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => /^kind:\s*\S/.test(line));
  return (start === -1 ? body : lines.slice(start).join("\n")).trim();
}

interface RawLine {
  /** Leading-space count; `-1` marks a blank line. */
  indent: number;
  /** Line content with its leading indent already stripped. */
  text: string;
}

function toRawLines(source: string): RawLine[] {
  return source.split(/\r?\n/).map((line) => {
    if (line.trim() === "") return { indent: -1, text: "" };
    const indent = line.length - line.trimStart().length;
    return { indent, text: line.slice(indent) };
  });
}

const KEY_LINE = /^([A-Za-z_][\w-]*):(.*)$/;
const SEQ_ITEM = /^-\s?(.*)$/;

function skipBlank(lines: RawLine[], index: number): number {
  let next = index;
  while (next < lines.length && lines[next]!.indent === -1) next++;
  return next;
}

/** Consumes the block-literal body starting right after a `key: |` line -
 * see `ai-magic-write-protocol.ts`'s `consumeBlockLiteral` doc comment
 * (identical logic, copied rather than imported: that module's parsing
 * primitives are private to it). */
function consumeBlockLiteral(lines: RawLine[], start: number, keyIndent: number): { text: string; next: number } {
  let index = start;
  let blockIndent: number | null = null;
  const collected: string[] = [];
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.indent === -1) {
      collected.push("");
      index++;
      continue;
    }
    if (line.indent <= keyIndent) break;
    blockIndent ??= line.indent;
    const relative = Math.max(0, line.indent - blockIndent);
    collected.push(" ".repeat(relative) + line.text);
    index++;
  }
  while (collected.length > 0 && collected[collected.length - 1] === "") collected.pop();
  return { text: collected.join("\n"), next: index };
}

function parseMapping(lines: RawLine[], start: number, indent: number): { fields: PageSourceRawFields; next: number } {
  const fields: PageSourceRawFields = {};
  let index = skipBlank(lines, start);
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.indent !== indent) break;
    const match = KEY_LINE.exec(line.text);
    if (!match) break;
    const key = match[1]!;
    const remainder = (match[2] ?? "").trim();
    let value: PageSourceRawValue;
    let next: number;
    if (remainder === "|") {
      const block = consumeBlockLiteral(lines, index + 1, indent);
      value = block.text;
      next = block.next;
    } else if (remainder === "") {
      const childStart = skipBlank(lines, index + 1);
      const child = lines[childStart];
      if (child && child.indent > indent && SEQ_ITEM.test(child.text)) {
        const seq = parseSequence(lines, childStart, child.indent);
        value = seq.items;
        next = seq.next;
      } else if (child && child.indent > indent && KEY_LINE.test(child.text)) {
        const nested = parseMapping(lines, childStart, child.indent);
        value = nested.fields;
        next = nested.next;
      } else {
        value = "";
        next = index + 1;
      }
    } else {
      value = remainder;
      next = index + 1;
    }
    fields[key] = value;
    index = skipBlank(lines, next);
  }
  return { fields, next: index };
}

function parseSequence(lines: RawLine[], start: number, indent: number): { items: PageSourceRawFields[]; next: number } {
  const items: PageSourceRawFields[] = [];
  let index = skipBlank(lines, start);
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.indent !== indent) break;
    const match = SEQ_ITEM.exec(line.text);
    if (!match) break;
    const rest = match[1] ?? "";
    const itemIndent = indent + 2;
    if (rest.trim() === "") {
      const nested = parseMapping(lines, index + 1, itemIndent);
      items.push(nested.fields);
      index = nested.next;
      continue;
    }
    const synthetic: RawLine = { indent: itemIndent, text: rest };
    const rewritten = [synthetic, ...lines.slice(index + 1)];
    const nested = parseMapping(rewritten, 0, itemIndent);
    items.push(nested.fields);
    index += nested.next;
  }
  return { items, next: index };
}

function validateCodeTurn(top: PageSourceRawFields): PageSourceValidationResult {
  const path = top.path;
  const summary = top.summary;
  const code = top.code;
  if (!isRawString(path) || !path.trim()) return { ok: false, error: '"path" must be a non-empty string.' };
  if (!isRawString(summary) || !summary.trim()) return { ok: false, error: '"summary" must be a non-empty string.' };
  if (!isRawString(code) || !code.trim()) return { ok: false, error: '"code" must be a non-empty string.' };
  return { ok: true, turn: { kind: "code", path: path.trim(), summary: summary.trim(), code } };
}

const READ_ROOTS = new Set<string>(["source", "docs", "types"]);

function validateReadTurn(top: PageSourceRawFields): PageSourceValidationResult {
  const root = top.root;
  const path = top.path;
  if (!isRawString(root) || !READ_ROOTS.has(root.trim())) return { ok: false, error: '"root" must be "source", "docs", or "types".' };
  if (!isRawString(path) || !path.trim()) return { ok: false, error: '"path" must be a non-empty string.' };
  return { ok: true, turn: { kind: "read", root: root.trim() as PageSourceReadRoot, path: path.trim() } };
}

/** `kind: chat` reads its `text:` block literal like any other prose value;
 * falls back to the full raw reply when missing/empty - same lenient
 * fallback `ai-magic-write-protocol.ts`'s `coerceChatTurn` uses, and for the
 * same reason: a reply that ignored the dialect entirely still deserves to
 * be shown to the admin as plain chat rather than bounced as an error. */
function coerceChatTurn(top: PageSourceRawFields, rawText: string): PageSourceValidationResult {
  const text = isRawString(top.text) && top.text.trim() ? top.text : rawText;
  return { ok: true, turn: { kind: "chat", text: text.trim() } };
}

/** Full, validated parse - only meaningful once the whole reply has been
 * received. Never throws; only fails (`{ ok: false }`) for an explicit
 * `code`/`read` reply whose body doesn't match its own declared shape (worth
 * a dialect-retry) - anything else, including an unparseable document,
 * resolves as `chat` (see `parseMagicWriteYaml`'s identical reasoning). */
export function parsePageSourceYaml(text: string): PageSourceValidationResult {
  let top: PageSourceRawFields;
  try {
    top = parseMapping(toRawLines(text), 0, 0).fields;
  } catch {
    return { ok: true, turn: { kind: "chat", text: text.trim() } };
  }
  if (top.kind === "code") return validateCodeTurn(top);
  if (top.kind === "read") return validateReadTurn(top);
  if (top.kind === "fetch") {
    const result = validateMagicWriteFetchTurn(top as MagicWriteRawFields);
    return result.ok ? { ok: true, turn: result.turn as MagicWriteFetchTurn } : result;
  }
  return coerceChatTurn(top, text);
}

export interface PageSourcePartialState {
  kind?: string;
  /** Only meaningful once `kind === "chat"` (or the lenient no-`kind`
   * fallback) - whatever of the `text:` block has streamed in so far. */
  text?: string;
  /** Only meaningful once `kind === "code"` - the target file's path, once
   * that (short, plain-scalar) line has fully streamed in. The client waits
   * for this before it starts live-flushing `code` into any buffer at all -
   * see `path`'s sibling doc comment below. */
  path?: string;
  /** Only meaningful once `kind === "code"` - whatever of the `summary:`
   * block has streamed in so far. */
  summary?: string;
  /** Only meaningful once `kind === "code"` - whatever of the `code:` block
   * has streamed in so far. The client feeds this straight into `path`'s
   * live editor buffer (if that file happens to be open) on every tick
   * (`status/page-editor-magic-chat.md` - direct-write-while-streaming, no
   * diff gate), same "stream straight into the real value" treatment
   * `MagicChat.tsx` already gives a streaming `text`/`richtext` field. */
  code?: string;
}

/** Tolerant, incremental read of whatever's parseable from a still-
 * streaming reply - re-scans the growing text from scratch on every call,
 * same "cheap enough" reasoning `parsePartialMagicWriteYaml` documents (a
 * page-source reply is at most a few hundred KB). Unlike `fields`' nested
 * per-field spans, `code`/`text`/`summary` are each a single top-level block
 * literal, so a flat mapping parse already gives live-growing values with no
 * extra span-tracking needed. */
export function parsePartialPageSourceYaml(text: string): PageSourcePartialState {
  const top = parseMapping(toRawLines(text), 0, 0).fields;
  return {
    kind: isRawString(top.kind) ? top.kind : undefined,
    text: isRawString(top.text) ? top.text : undefined,
    path: isRawString(top.path) ? top.path : undefined,
    summary: isRawString(top.summary) ? top.summary : undefined,
    code: isRawString(top.code) ? top.code : undefined,
  };
}
