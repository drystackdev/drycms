/**
 * Magic Write's wire format - a small hand-rolled YAML SUBSET (not full
 * YAML): block-literal scalars (`key: |` + indented raw lines, used for
 * every prose value so streamed content can be appended straight into an
 * open preview without JSON string-escaping), plain scalars (`key: value`
 * on one line, for number/boolean/date/select-id/image-path), nested
 * mappings (`flatten` fields), and block sequences of mappings
 * (`component-repeat` fields). See `status/magic-write.md` decision #4 for
 * the rationale and the exact dialect rules the system prompt teaches the
 * model. Deliberately independent of `ai-wizard-protocol.ts` (JSON, kept
 * unchanged) - no shared parsing code between the two.
 *
 * `status/magic-chat.md` decision #1/#2 (the "Magic" chat upgrade) added a
 * third top-level shape, `kind: chat` - plain conversational text, no field
 * write. Its own block literal (`text: |`) reuses the exact same streaming
 * mechanism `summary`/field values already use, so a chat reply renders
 * live too. Decision #2 also made the whole parser lenient: a reply that
 * doesn't recognize as `question`/`fields`/`fetch` (missing `kind:`, or a
 * `kind` value that isn't one of those) is treated as `chat` using the raw
 * text, rather than a hard parse error - only a malformed `question`/
 * `fields`/`fetch` body (a real attempt at structured output gone wrong)
 * still asks the model to retry, since silently swallowing THAT would
 * corrupt what gets written to a field (or, for `fetch`, run the wrong
 * query).
 *
 * `status/magic-chat.md` decision #5 (Phase B) added a fourth shape, `kind:
 * fetch` - all plain scalars (`source`/`typeSlug`/`id`/`search`/`path`), no
 * block literal. Unlike the other three, never terminal: `ai-magic-write.ts`
 * executes the query and loops back for another reply instead of closing the
 * stream - see `MagicWriteFetchTurn`'s own doc comment.
 *
 * `status/richtext-rewrite-shared-chat.md` added a fifth shape, `kind:
 * rewrite` - a single `html: |` block literal, the full rewritten
 * replacement for one RichText passage. Only ever valid as the reply to an
 * explicit per-turn "rewrite this exact passage" request (see
 * `ai-magic-write-prompt.ts`'s `buildRewriteTurnMessage`) - never something
 * the model reaches for on its own.
 *
 * `status/relation-quick-create.md` added a sixth shape, `kind: create` -
 * the model creating a brand-new entry in a collection DIRECTLY related to
 * this one via a `relation` field (never an arbitrary type - see
 * `ai-magic-write.ts`'s `creatableTypeSlugs`), so it can then link this
 * entry to it without the admin having to leave the chat to create the
 * related row by hand first. Like `kind: fetch`, never terminal: executed
 * server-side and looped back for another reply, and its own `fields` are
 * plain scalars/groups only (`ai-magic-write-fields.ts`'s
 * `WRITABLE_COLUMN_TYPES` - no relation/image on the newly created row
 * itself, keeping one create hop's blast radius small).
 */

export interface MagicWriteChoice {
  id: string;
  label: string;
}

export interface MagicWriteQuestionTurn {
  kind: "question";
  topic: string;
  question: string;
  choices: MagicWriteChoice[];
  multi: boolean;
  allowOther?: boolean;
}

/** A plain conversational reply - no field write, no question. Covers small
 * talk, clarifying remarks that don't need a structured `question`, capability
 * explanations, and (via the lenient fallback in `parseMagicWriteYaml` below)
 * any reply that didn't follow the `kind:` dialect at all. */
export interface MagicWriteChatTurn {
  kind: "chat";
  text: string;
}

/** A field's parsed-but-not-yet-schema-validated value - a bare string for
 * every scalar (block-literal or plain, regardless of the real field's
 * eventual number/boolean/date type; that coercion happens against the
 * content type's own `EntryFieldNode[]` in `ai-magic-write.ts`'s
 * `parseMagicWriteFields`, not here), a nested mapping for a `flatten`
 * field, or an array of mappings for a `component-repeat` field. */
export type MagicWriteRawValue = string | MagicWriteRawValue[] | MagicWriteRawFields;

export interface MagicWriteRawFields {
  [fieldName: string]: MagicWriteRawValue;
}

export interface MagicWriteFieldsTurn {
  kind: "fields";
  summary: string;
  fields: MagicWriteRawFields;
}

export type MagicWriteFetchSource = "entries" | "entry" | "media" | "types";

/** `status/magic-chat.md` decision #5 (Phase B) - the model actively looking
 * up data OUTSIDE this entry, INSIDE drycms itself (never the internet - see
 * `ai-magic-write-prompt.ts`'s `CAPABILITY_INSTRUCTION`). Never a terminal
 * turn: `ai-magic-write.ts`'s `streamMagicWrite` executes the query
 * server-side and loops back for another model reply, capped at a few hops
 * per admin turn - the client never sees this shape directly, only a
 * transient status line. All plain scalars (no block literal needed - these
 * are short technical tokens, not prose). */
export interface MagicWriteFetchTurn {
  kind: "fetch";
  source: MagicWriteFetchSource;
  /** Required for "entries"/"entry" - the target content type's name. */
  typeSlug?: string;
  /** Required for "entry" - which row (the SAME plain numeric id a "ref"/
   * "refs" field write uses, per `ai-magic-write-fields.ts`'s relation
   * coercion - never a hashed HTTP-API id). */
  id?: string;
  /** Optional free-text filter, "entries" only. */
  search?: string;
  /** Optional folder path, "media" only - root when omitted. */
  path?: string;
}

/** The full rewritten replacement for one RichText passage - see this file's
 * own doc comment. `html` follows whatever inline-vs-block dialect subset
 * that turn's own request specified (never re-stated here; the protocol
 * layer doesn't know about that distinction). */
export interface MagicWriteRewriteTurn {
  kind: "rewrite";
  html: string;
}

/** `status/relation-quick-create.md` - the model creating a new entry in a
 * directly-related collection. Never a terminal turn - see this file's own
 * doc comment. `fields` uses the exact same raw shape a `kind: fields` reply
 * does (coerced the same way, via `applyMagicWriteFields`), just for the
 * NEW row instead of the entry currently open. */
export interface MagicWriteCreateTurn {
  kind: "create";
  typeSlug: string;
  fields: MagicWriteRawFields;
}

export type MagicWriteTurn = MagicWriteQuestionTurn | MagicWriteFieldsTurn | MagicWriteChatTurn | MagicWriteFetchTurn | MagicWriteRewriteTurn | MagicWriteCreateTurn;

export type MagicWriteValidationResult =
  | { ok: true; turn: MagicWriteTurn }
  | { ok: false; error: string };

function isRawString(value: MagicWriteRawValue | undefined): value is string {
  return typeof value === "string";
}

function isRawFields(value: MagicWriteRawValue | undefined): value is MagicWriteRawFields {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isRawArray(value: MagicWriteRawValue | undefined): value is MagicWriteRawValue[] {
  return Array.isArray(value);
}

/**
 * Strips a model reply down to just the dialect body - discards a
 * ```yaml fenced wrapper (the system prompt forbids one, but tolerating it
 * costs nothing) and any stray prose before the first `kind:` line, mirroring
 * `ai-wizard-protocol.ts`'s `extractWizardJson`'s tolerance for the JSON
 * dialect. Only used on a TERMINAL (fully received) reply, before
 * `parseMagicWriteYaml` - never on a still-streaming partial, where a
 * not-yet-closed fence would make this actively misleading.
 */
export function extractMagicWriteYaml(raw: string): string {
  const fenced = /```(?:ya?ml)?\s*([\s\S]*?)```/i.exec(raw);
  const body = fenced ? fenced[1]! : raw;
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => /^kind:\s*\S/.test(line));
  return (start === -1 ? body : lines.slice(start).join("\n")).trim();
}

interface RawLine {
  /** Leading-space count; `-1` marks a blank (whitespace-only) line - never
   * used to decide where a block/mapping/sequence ends on its own, matching
   * real YAML's own block-scalar rule that blank lines never terminate a
   * scan by themselves. */
  indent: number;
  /** Line content with its leading indent already stripped. Empty for a
   * blank line. */
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

/**
 * Consumes the block-literal body starting right after a `key: |` line -
 * every following line indented more than `keyIndent` belongs to it. The
 * block's own indentation is fixed by the first non-blank line encountered,
 * then stripped from every line so any indentation beyond that (e.g. nested
 * HTML) round-trips untouched. Trailing blank lines collected only because
 * the stream (or the document) happened to end there are dropped - they
 * belong to whatever separates this block from the next sibling, not to the
 * block's own content.
 */
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

/**
 * Parses every sibling `key: ...` line found at exactly `indent`, starting
 * at `start`, into a mapping - dispatching each value to a block literal, a
 * plain one-line scalar, a nested mapping, or a block sequence based on
 * what immediately follows the `key:`. Stops (without error) at the first
 * line that doesn't fit - callers past the top level rely on that tolerance
 * for partial/streaming text, where the last field is naturally still
 * incomplete.
 */
function parseMapping(lines: RawLine[], start: number, indent: number): { fields: MagicWriteRawFields; next: number } {
  const fields: MagicWriteRawFields = {};
  let index = skipBlank(lines, start);
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.indent !== indent) break;
    const match = KEY_LINE.exec(line.text);
    if (!match) break;
    const key = match[1]!;
    const remainder = (match[2] ?? "").trim();
    let value: MagicWriteRawValue;
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

/** Parses a block sequence of mappings (`- key: |` / `  otherKey: value`,
 * one mapping per `-` item) starting at `start`, all items at `indent`. */
function parseSequence(lines: RawLine[], start: number, indent: number): { items: MagicWriteRawFields[]; next: number } {
  const items: MagicWriteRawFields[] = [];
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
    // The item's first key lives on the same physical line as "- " - splice
    // a synthetic line standing in for it (re-indented to `itemIndent`, the
    // column its own sibling keys align to) so the rest of this function's
    // machinery can treat it exactly like any other mapping key line.
    const synthetic: RawLine = { indent: itemIndent, text: rest };
    const rewritten = [synthetic, ...lines.slice(index + 1)];
    const nested = parseMapping(rewritten, 0, itemIndent);
    items.push(nested.fields);
    index += nested.next;
  }
  return { items, next: index };
}

function validateQuestionTurn(top: MagicWriteRawFields): MagicWriteValidationResult {
  const topic = top.topic;
  const question = top.question;
  const choicesRaw = top.choices;
  if (!isRawString(topic) || !topic.trim()) return { ok: false, error: '"topic" must be a non-empty string.' };
  if (!isRawString(question) || !question.trim()) return { ok: false, error: '"question" must be a non-empty string.' };
  if (!isRawArray(choicesRaw) || choicesRaw.length === 0) return { ok: false, error: '"choices" must be a non-empty list.' };
  const choices: MagicWriteChoice[] = [];
  for (const raw of choicesRaw) {
    if (!isRawFields(raw) || !isRawString(raw.id) || !isRawString(raw.label) || !raw.id.trim() || !raw.label.trim()) {
      return { ok: false, error: 'Each choice needs a non-empty "id" and "label".' };
    }
    choices.push({ id: raw.id.trim(), label: raw.label.trim() });
  }
  const multi = isRawString(top.multi) && top.multi.trim().toLowerCase() === "true";
  const allowOther = isRawString(top.allowOther) ? top.allowOther.trim().toLowerCase() === "true" : undefined;
  return {
    ok: true,
    turn: { kind: "question", topic: topic.trim(), question: question.trim(), choices, multi, allowOther },
  };
}

function validateFieldsTurn(top: MagicWriteRawFields): MagicWriteValidationResult {
  const summary = top.summary;
  const fields = top.fields;
  if (!isRawString(summary) || !summary.trim()) return { ok: false, error: '"summary" must be a non-empty string.' };
  if (!isRawFields(fields)) return { ok: false, error: '"fields" must be a mapping of field name to value.' };
  return { ok: true, turn: { kind: "fields", summary: summary.trim(), fields } };
}

const FETCH_SOURCES = new Set<string>(["entries", "entry", "media", "types"]);

/** Exported for reuse by `ai-page-source-protocol.ts`'s own `kind: fetch`
 * turn (Page Editor Magic Chat) - the exact same lookup-other-drycms-data
 * concern, on the exact same wire shape (`MagicWriteFetchTurn`), so there's
 * no reason to keep a second copy of this parser around (unlike the
 * `fields`/`relation`/`component-repeat` parsing this module also owns,
 * which genuinely doesn't apply to page-source and stays private). */
export function validateFetchTurn(top: MagicWriteRawFields): MagicWriteValidationResult {
  const source = top.source;
  if (!isRawString(source) || !FETCH_SOURCES.has(source.trim())) {
    return { ok: false, error: '"source" must be one of "entries", "entry", "media", "types".' };
  }
  const trimmedSource = source.trim() as MagicWriteFetchSource;
  const typeSlug = isRawString(top.typeSlug) ? top.typeSlug.trim() : "";
  if ((trimmedSource === "entries" || trimmedSource === "entry") && !typeSlug) {
    return { ok: false, error: `"typeSlug" is required when source is "${trimmedSource}".` };
  }
  const id = isRawString(top.id) ? top.id.trim() : "";
  if (trimmedSource === "entry" && !id) {
    return { ok: false, error: '"id" is required when source is "entry".' };
  }
  const search = isRawString(top.search) && top.search.trim() ? top.search.trim() : undefined;
  const path = isRawString(top.path) && top.path.trim() ? top.path.trim() : undefined;
  return {
    ok: true,
    turn: { kind: "fetch", source: trimmedSource, typeSlug: typeSlug || undefined, id: id || undefined, search, path },
  };
}

function validateRewriteTurn(top: MagicWriteRawFields): MagicWriteValidationResult {
  const html = top.html;
  if (!isRawString(html) || !html.trim()) return { ok: false, error: '"html" must be a non-empty string.' };
  return { ok: true, turn: { kind: "rewrite", html: html.trim() } };
}

function validateCreateTurn(top: MagicWriteRawFields): MagicWriteValidationResult {
  const typeSlug = top.typeSlug;
  const fields = top.fields;
  if (!isRawString(typeSlug) || !typeSlug.trim()) return { ok: false, error: '"typeSlug" must be a non-empty string.' };
  if (!isRawFields(fields)) return { ok: false, error: '"fields" must be a mapping of field name to value.' };
  return { ok: true, turn: { kind: "create", typeSlug: typeSlug.trim(), fields } };
}

/** `kind: chat` reads its `text:` block literal like any other prose value;
 * falls back to the full raw reply when that's missing/empty (covers both
 * an explicit-but-malformed `kind: chat` and - via `parseMagicWriteYaml`
 * calling this for ANY unrecognized/missing `kind` - a reply that ignored
 * the dialect entirely and just talked. Never fails: chat is never worth
 * bouncing back to the model for a retry. */
function coerceChatTurn(top: MagicWriteRawFields, rawText: string): MagicWriteValidationResult {
  const text = isRawString(top.text) && top.text.trim() ? top.text : rawText;
  return { ok: true, turn: { kind: "chat", text: text.trim() } };
}

/** Full, validated parse - only meaningful once the whole reply has been
 * received (the terminal turn). Never throws, and only ever fails (`{ ok:
 * false }`) for a `question`/`fields` reply whose body doesn't match its own
 * declared shape - a real, worth-retrying dialect violation (mirroring
 * `ai-wizard-protocol.ts`'s `parseWizardTurn` usage, the server's retry loop
 * asks the model to resend instead of crashing the stream). Anything else -
 * `kind: chat`, an unrecognized/missing `kind`, or even an unparseable
 * document - resolves as a `chat` turn instead (see this file's own doc
 * comment and `status/magic-chat.md` decision #2): silently mangling a field
 * write is worth guarding against, but bouncing an admin's ordinary
 * conversational reply back as an error is not. */
export function parseMagicWriteYaml(text: string): MagicWriteValidationResult {
  let top: MagicWriteRawFields;
  try {
    top = parseMapping(toRawLines(text), 0, 0).fields;
  } catch {
    return { ok: true, turn: { kind: "chat", text: text.trim() } };
  }
  if (top.kind === "question") return validateQuestionTurn(top);
  if (top.kind === "fields") return validateFieldsTurn(top);
  if (top.kind === "fetch") return validateFetchTurn(top);
  if (top.kind === "rewrite") return validateRewriteTurn(top);
  if (top.kind === "create") return validateCreateTurn(top);
  return coerceChatTurn(top, text);
}

export interface MagicWritePartialState {
  kind?: string;
  /** Only meaningful once `kind === "fields"` - whatever of the summary
   * block has streamed in so far. */
  summary?: string;
  /** Only meaningful once `kind === "chat"` (or the lenient no-`kind`
   * fallback that also resolves as chat, see `parseMagicWriteYaml`) -
   * whatever of the `text:` block has streamed in so far. Growing live the
   * same way `summary` does, so a chat bubble can render token-by-token. */
  text?: string;
  /** Only meaningful once `kind === "question"` - whatever of the
   * `question:` block has streamed in so far (the `choices` list itself
   * only becomes available on the terminal, fully-parsed turn). */
  question?: string;
  /** Top-level `fields` children fully closed so far (a following sibling
   * key confirmed the model moved past them) - in the order the model wrote
   * them. */
  closedFields: MagicWriteRawFields;
  /** The `fields` child currently being written, if any - whatever of its
   * value has streamed in so far. `MagicChat` decides how to use this per
   * the field's real type (looked up from the content type's own
   * `EntryFieldNode[]`, not from this protocol layer): fed live into
   * `updateFieldValue` for a scalar field, ignored (shown as a generic
   * "writing…" skeleton) for richtext/flatten/component-repeat until the
   * field closes for good. */
  streamingField?: { name: string; value: MagicWriteRawValue };
}

function findTopLevelKeyLine(lines: RawLine[], key: string): number | null {
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    if (line.indent !== 0) continue;
    const match = KEY_LINE.exec(line.text);
    if (match && match[1] === key) return index;
  }
  return null;
}

interface ChildSpan {
  key: string;
  start: number;
  end: number;
}

/** Every sibling `key:` line at exactly `indent`, starting at `start`, as a
 * `[start, end)` line-index span each - the span for a field runs up to
 * (but excludes) the next sibling's own start line, or the end of the
 * document for the last one. */
function topLevelChildSpans(lines: RawLine[], start: number, indent: number): ChildSpan[] {
  const starts: { key: string; index: number }[] = [];
  let index = start;
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.indent === -1) {
      index++;
      continue;
    }
    if (line.indent < indent) break;
    if (line.indent === indent) {
      const match = KEY_LINE.exec(line.text);
      if (!match) break;
      starts.push({ key: match[1]!, index });
    }
    index++;
  }
  return starts.map((entry, i) => ({
    key: entry.key,
    start: entry.index,
    end: i + 1 < starts.length ? starts[i + 1]!.index : lines.length,
  }));
}

/** Tolerant, incremental read of whatever's parseable from a still-streaming
 * `fields` turn - never throws, never "repairs" anything (unlike
 * `ai-wizard-protocol.ts`'s JSON `repairPartialJson`), just re-scans the
 * growing text from scratch on every call and reports what's structurally
 * complete. Cheap enough for that: Magic Write turns are at most a few KB. */
export function parsePartialMagicWriteYaml(text: string): MagicWritePartialState {
  const lines = toRawLines(text);
  const top = parseMapping(lines, 0, 0).fields;
  const kind = isRawString(top.kind) ? top.kind : undefined;
  const summary = isRawString(top.summary) ? top.summary : undefined;
  const chatText = isRawString(top.text) ? top.text : undefined;
  const question = isRawString(top.question) ? top.question : undefined;
  if (kind !== "fields") return { kind, summary, text: chatText, question, closedFields: {} };

  const fieldsLineIndex = findTopLevelKeyLine(lines, "fields");
  if (fieldsLineIndex === null) return { kind, summary, closedFields: {} };
  const fieldsIndent = lines[fieldsLineIndex]!.indent;
  const firstChildIndex = skipBlank(lines, fieldsLineIndex + 1);
  const firstChild = lines[firstChildIndex];
  if (!firstChild || firstChild.indent <= fieldsIndent) return { kind, summary, closedFields: {} };

  const spans = topLevelChildSpans(lines, firstChildIndex, firstChild.indent);
  if (spans.length === 0) return { kind, summary, closedFields: {} };

  const closedFields: MagicWriteRawFields = {};
  for (const span of spans.slice(0, -1)) {
    const parsed = parseMapping(lines.slice(span.start, span.end), 0, firstChild.indent).fields;
    if (span.key in parsed) closedFields[span.key] = parsed[span.key]!;
  }
  const lastSpan = spans[spans.length - 1]!;
  const lastParsed = parseMapping(lines.slice(lastSpan.start, lastSpan.end), 0, firstChild.indent).fields;
  const streamingField = lastSpan.key in lastParsed ? { name: lastSpan.key, value: lastParsed[lastSpan.key]! } : undefined;

  return { kind, summary, closedFields, streamingField };
}
