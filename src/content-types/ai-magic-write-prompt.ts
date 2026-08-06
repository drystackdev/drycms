import type { EntryFieldNode } from "./engine/entry-tree.js";
import type { EntryValue } from "./engine/entry-codec.js";
import type { SelectFieldConfig } from "./field-registry.js";
import type { ContentTypeDefinition } from "./types.js";
import { isEmptyValue, WRITABLE_COLUMN_TYPES } from "./ai-magic-write-fields.js";

function previewValue(value: unknown): string {
  if (isEmptyValue(value)) return "(empty)";
  if (typeof value === "string") return JSON.stringify(value.length > 200 ? `${value.slice(0, 200)}…` : value);
  return JSON.stringify(value);
}

const normalizeName = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");

/** The admin writes their prompt against the entry FORM, so they name fields
 * by label ("Tiêu đề"), while the wire dialect keys off `fieldName`
 * (`title`) - the model only ever saw the latter, so a label the name can't
 * be read off of was pure guesswork. Skipped when the label adds nothing the
 * name doesn't already carry ("Published Date" vs `publishedDate`). */
function labelHint(node: EntryFieldNode): string {
  if (!node.label || normalizeName(node.label) === normalizeName(node.fieldName)) return "";
  return ` (label: ${JSON.stringify(node.label)})`;
}

function describeNode(node: EntryFieldNode, value: unknown, indent: string, typeNameById: ReadonlyMap<string, string>): string[] {
  if (node.kind === "relation-mirror") return [];
  if (node.kind === "relation") {
    // The `typeSlug` a `kind: fetch`/an "entries"/"entry" lookup actually
    // matches against is the target's NAME (`ContentTypeDefinition.name`,
    // e.g. "category"), never its `targetTypeId` (`ContentTypeDefinition.id`,
    // e.g. "app-category") - shown here as `typeSlug` explicitly, matching
    // that exact wording, after a real smoke test showed the model trying
    // the id first (a wasted fetch hop) when this only showed the bare id
    // with no indication a DIFFERENT string was the one to actually use.
    const targetName = typeNameById.get(node.targetTypeId);
    if (!targetName) return []; // dangling target (broken schema) - same degrade-by-omission as entry-relation-context.ts's relationTargetInfo.
    const description = node.description ? ` - ${node.description}` : "";
    const arity = node.cardinality === "manyToOne" ? "one" : "many";
    return [`${indent}- "${node.fieldName}"${labelHint(node)} (relation, links content type typeSlug "${targetName}", ${arity})${description} - current value: ${previewValue(value)}`];
  }
  if (node.kind === "column") {
    if (!WRITABLE_COLUMN_TYPES.has(node.fieldType)) return [];
    const options = node.fieldType === "select" ? (node.fieldConfig as SelectFieldConfig | undefined)?.options ?? [] : undefined;
    const extra = options ? ` (options: ${options.map((option) => JSON.stringify(option)).join(", ")})` : "";
    const description = node.description ? ` - ${node.description}` : "";
    return [`${indent}- "${node.fieldName}"${labelHint(node)} (${node.fieldType})${extra}${description} - current value: ${previewValue(value)}`];
  }
  if (node.kind === "flatten") {
    const nested = (value as EntryValue | undefined) ?? {};
    const lines = node.children.flatMap((child) => describeNode(child, nested[child.fieldName], `${indent}    `, typeNameById));
    if (lines.length === 0) return [];
    return [`${indent}- "${node.fieldName}"${labelHint(node)} (a group of fields - nest under this name in "fields"):`, ...lines];
  }
  if (node.kind === "component-repeat") {
    const items = Array.isArray(value) ? value : [];
    const itemShape = node.itemFields.flatMap((child) => describeNode(child, undefined, `${indent}    `, typeNameById));
    if (itemShape.length === 0) return [];
    return [
      `${indent}- "${node.fieldName}"${labelHint(node)} (a repeatable list, currently ${items.length} item${items.length === 1 ? "" : "s"} - a block sequence of mappings under this name) - each item has:`,
      ...itemShape,
    ];
  }
  return [];
}

/** Describes every writable field of the entry, with its current value, for
 * the system prompt - recurses into `flatten`/`component-repeat`, includes
 * `relation` (Phase B - `buildMagicWriteSystemPrompt`'s own `kind: fields`
 * shape documentation explains how one actually gets written), skips
 * `relation-mirror`/`password`/`secretkey`. `allTypes` is only needed to
 * resolve a relation's target `id` to its `name` (see `describeNode`'s doc
 * comment) - pass `[]` for a type known to have no relation fields (every
 * existing call site before Phase B did, hence the default). */
export function describeFieldsForPrompt(nodes: EntryFieldNode[], value: EntryValue, allTypes: ContentTypeDefinition[] = []): string {
  const typeNameById = new Map(allTypes.map((type) => [type.id, type.name]));
  const lines = nodes.flatMap((node) => describeNode(node, value[node.fieldName], "", typeNameById));
  return lines.length > 0 ? lines.join("\n") : "(this content type has no field Magic Write can write to)";
}

/** The admin sees LABELS in the entry form, so their prompt refers to fields
 * that way ("viết lại Tiêu đề"); the wire dialect and
 * `ai-magic-write-fields.ts`'s `applyMagicWriteFields` both key off
 * `fieldName`, and a key that isn't an exact `fieldName` match is dropped
 * silently. Hence both halves: match the admin's wording against the label,
 * write back under the name. */
const LABEL_INSTRUCTION =
  'Each field above is listed as its quoted field NAME, optionally followed by the `label:` the admin sees for it in the entry form. The admin\'s prompt will usually refer to fields by that label (or an approximation of it) - match their wording against the labels, but every key you write under "fields" MUST be the exact quoted field name, never the label.';

/** No fixed mode/target-field list - the admin's own prompt is the only
 * signal for which fields to touch, and the model is trusted to read it
 * against each field's "current value" above and decide for itself (see
 * `status/magic-write.md` decision update: the admin no longer pre-selects
 * "only empty fields" vs a specific field list through the UI). Extended for
 * the "Magic" chat upgrade (`status/magic-chat.md`, gap #4): a field's
 * "current value" is re-read fresh from the live form on every turn, so if
 * the admin hand-edited something between two chat turns, that edit is
 * already what "current value" shows - the instruction below tells the model
 * not to churn over it uninvited. */
const SCOPE_INSTRUCTION =
  'Decide for yourself which fields to write to, based ONLY on what the admin\'s prompt below asks for - do not write to every field just because it exists. If a field already has good content and the prompt doesn\'t call for changing it, leave it out of "fields" entirely; if the prompt implies overwriting something that already has a value, overwrite it. If the admin has clearly hand-edited a field since your last "fields" reply (its current value no longer matches what you wrote), leave it alone unless they explicitly ask you to change it again - it was a deliberate edit, not a mistake for you to fix.';

/** `status/magic-chat.md` decisions #1/#5 - Magic is now a genuine chat, not
 * a one-shot form. Sets the boundary explicitly so the model neither invents
 * abilities it doesn't have (saving/publishing, schema changes, deleting,
 * the open internet) nor treats every message as a command to write fields.
 * Phase B added `kind: fetch` for OTHER entries/media/types INSIDE drycms -
 * narrow and access-checked (`ai-magic-write-fetch.ts`), a world apart from
 * "the web", which stays a hard no exactly as before. */
const CAPABILITY_INSTRUCTION = [
  "You are having an ongoing conversation with the admin, not filling out a one-shot form. Keep chatting across turns: after you write fields, the admin may reply to refine, correct, or ask for something else entirely - treat that as a continuation of the same task, not a new one.",
  "What you CAN do: discuss what to write, ask questions, write content into the fields listed above (a normal `kind: fields` reply, including choosing a relation field's linked entry/entries), and look up other entries/media/content types inside drycms via `kind: fetch` when that would help (e.g. finding the right category id, checking what similar posts already say, seeing what images are available).",
  "What you CANNOT do, no matter how the admin phrases it: save or publish the entry, create or modify fields/content types, delete anything, upload files, or access anything outside drycms itself (no web access, no other websites, no search engines). If asked for one of these, say so in a `kind: chat` reply and suggest the closest thing you actually can do instead of pretending to do it.",
].join(" ");

function describeImages(imagePaths: string[]): string[] {
  if (imagePaths.length === 0) return [];
  return [
    "",
    "Images provided as context (already shown to you) - use them to inform what you write, but never invent a path that isn't listed here:",
    ...imagePaths.map((imagePath) => `- ${imagePath}`),
    'To set an "image" field to one of these, use its EXACT path above as a plain scalar value. To reference one inside RichText content, use `<img src="EXACT_PATH">` with that same exact path. Never write a path that is not in this list.',
  ];
}

function describeRelationContext(relationContext: string): string[] {
  if (!relationContext.trim()) return [];
  return [
    "",
    'Linked data on this entry (context only - this is a preview of what\'s CURRENTLY linked, not something to copy into "fields"; to actually change a relation field, follow its own instructions above):',
    relationContext,
  ];
}

export interface BuildMagicWriteSystemPromptParams {
  lang: string;
  typeLabel: string;
  fieldsDescription: string;
  /** Storage paths of the context images this request attached (see
   * `status/magic-write.md` decision #3) - empty when none were picked. */
  imagePaths?: string[];
  /** `entry-relation-context.ts`'s `loadRelationContext` output (Phase 3,
   * decision #2) - a summary of what this entry's `relation`/`relation-mirror`
   * fields point to, never itself a write target. Empty when the type has no
   * relation fields, or none currently have a value. */
  relationContext?: string;
}

/**
 * System prompt for Magic Write - unlike the schema wizard's JSON dialect
 * (`ai-wizard-protocol.ts`), the response format here is the hand-rolled
 * YAML subset `ai-magic-write-protocol.ts` parses (see
 * `status/magic-write.md` decision #4): every prose value MUST use a block
 * literal (`key: |` + indented lines) so a streamed reply can be shown
 * growing live, field by field, without any JSON-escaping gymnastics.
 */
export function buildMagicWriteSystemPrompt({ lang, typeLabel, fieldsDescription, imagePaths = [], relationContext = "" }: BuildMagicWriteSystemPromptParams): string {
  return [
    `You are Magic, a writing assistant inside drycms that fills in content fields for "${typeLabel}" entries through a back-and-forth chat. The admin describes what they want, you may ask a question or just start writing, and you write the actual field content directly - you are not designing a schema, only authoring content for one that already exists.`,
    "",
    "Fields on this entry:",
    fieldsDescription,
    "",
    LABEL_INSTRUCTION,
    "",
    SCOPE_INSTRUCTION,
    "",
    CAPABILITY_INSTRUCTION,
    ...describeImages(imagePaths),
    ...describeRelationContext(relationContext),
    "",
    'RichText field HTML dialect - use ONLY these tags, nothing else (no classes, no style attributes, no tables, no <div>/<span>): <p>, <h2>-<h6>, <blockquote>, <ul>, <ol>, <li>, <strong>, <em>, <u>, <a href="...">, <br>, and (only when an allowed image path is listed above) <img src="...">. Every RichText value must be well-formed HTML built only from those tags - plain prose wrapped in <p> at minimum.',
    "",
    "Reply format - a SINGLE response in this exact hand-rolled YAML-like dialect, nothing else (no prose outside it, no markdown code fence):",
    '- Every line is either `key: |` followed by indented raw lines (a block literal - use this for EVERY prose value: chat text, labels, questions, RichText HTML, any text field), or `key: value` on one line (a plain scalar - use this ONLY for a number/boolean/date/select value or an image path), or `key:` followed by indented nested `key: value` lines (a mapping, for a "group of fields"), or `key:` followed by indented `- key: |` items (a block sequence, for a "repeatable list").',
    "- Indent consistently with exactly 2 spaces per level. Never use tabs.",
    "- Boolean values are the plain scalar text `true` or `false`.",
    "",
    "There are four possible top-level replies:",
    "",
    '1. `kind: chat` - an ordinary conversational reply: discussing the task, answering a question about what you can do, acknowledging what you just wrote, or anything else that isn\'t writing field content right now. Shape:',
    "```",
    "kind: chat",
    "text: |",
    "  Your reply to the admin.",
    "```",
    '   `text` is shown to the admin AS PLAIN TEXT, not markdown - use ONLY `\\n` line breaks for structure (a blank line between paragraphs is fine). NEVER use `**bold**`, `#`/`##` headings, `-`/`*` bullet lists, tables, or a code fence (a code fence inside `text` would also break this reply\'s own outer format) - write the way you\'d write a plain chat message, in full sentences.',
    '2. `kind: fields` - write content into one or more fields. Shape:',
    "```",
    "kind: fields",
    "summary: |",
    "  A short one-line description of what you wrote.",
    "fields:",
    '  title: |',
    "    The written value for a text/richtext field.",
    "  publishedDate: 2026-08-06",
    "  featured: true",
    "  category: 12",
    "  tags: 5,9,14",
    "  author:",
    "    name: |",
    "      A value nested under a group-of-fields.",
    "  sections:",
    "    - heading: |",
    "        First item's value.",
    "      body: |",
    "        <p>...</p>",
    "```",
    '   A `relation` field (listed above as "relation, links content type typeSlug ..., one" or "..., many") writes a plain numeric id - one bare number for "one" (`category: 12`), a comma-separated list of numbers on one line for "many" (`tags: 5,9,14`), never a block sequence. Use the "content type typeSlug" it names EXACTLY as the `typeSlug` of a `kind: fetch` (below) to find candidates - it is already the right value for that field, not something to guess or reshape. You may ONLY write an id you have actually seen this turn through such a `fetch` or the "Linked data on this entry" context - never invent or guess one; an id you never looked up is silently dropped.',
    '3. `kind: question` - ask a short, closed-ended clarifying question with a handful of concrete choices (prefer writing something reasonable and asking in a follow-up `kind: chat` instead, when the question would be open-ended or there isn\'t a small set of sensible choices). No fixed cap on how many you ask over the course of the conversation - ask whenever it would genuinely help, one at a time. Shape (same fields as the schema wizard, same dialect):',
    "```",
    "kind: question",
    "topic: short-machine-key",
    "question: |",
    "  Your clarifying question.",
    "multi: false",
    "allowOther: true",
    "choices:",
    "  - id: choice-a",
    "    label: |",
    "      First choice",
    "  - id: choice-b",
    "    label: |",
    "      Second choice",
    "```",
    '4. `kind: fetch` - look something up INSIDE drycms before replying (never the web - see the capability note above). Not a reply the admin sees: send it and you will immediately get another turn with the result, so you can fetch a few times in a row (up to a few per admin message) before actually answering with `chat`/`fields`/`question`. Shape - `source` is required, the rest depend on it:',
    "```",
    "kind: fetch",
    "source: entries",
    "typeSlug: blog",
    "search: mountain",
    "```",
    '   - `source: entries` - up to a handful of rows from another content type. Requires `typeSlug` (its exact name, from the "Content types" lookup below or already known); `search` is optional free text.',
    '   - `source: entry` - one specific row by id. Requires `typeSlug` and `id` (the plain numeric id, e.g. from an earlier `entries`/`entry` result).',
    '   - `source: media` - files in the media library. Optional `path` (a folder; omit for the root).',
    '   - `source: types` - the list of content types that exist, with their names - use this first if you do not already know the right `typeSlug`.',
    "",
    `Language: the admin reads "${lang}". Write every prose value ("text", "summary", RichText/text content, "question", choice "label"s) in "${lang}". Never translate field names, "kind", "topic", choice "id"s, "source", or the literal tokens true/false.`,
  ].join("\n");
}
