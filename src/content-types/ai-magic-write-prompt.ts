import type { EntryFieldNode } from "./engine/entry-tree.js";
import type { EntryValue } from "./engine/entry-codec.js";
import type { SelectFieldConfig } from "./field-registry.js";
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

function describeNode(node: EntryFieldNode, value: unknown, indent: string): string[] {
  if (node.kind === "relation" || node.kind === "relation-mirror") return [];
  if (node.kind === "column") {
    if (!WRITABLE_COLUMN_TYPES.has(node.fieldType)) return [];
    const options = node.fieldType === "select" ? (node.fieldConfig as SelectFieldConfig | undefined)?.options ?? [] : undefined;
    const extra = options ? ` (options: ${options.map((option) => JSON.stringify(option)).join(", ")})` : "";
    const description = node.description ? ` - ${node.description}` : "";
    return [`${indent}- "${node.fieldName}"${labelHint(node)} (${node.fieldType})${extra}${description} - current value: ${previewValue(value)}`];
  }
  if (node.kind === "flatten") {
    const nested = (value as EntryValue | undefined) ?? {};
    const lines = node.children.flatMap((child) => describeNode(child, nested[child.fieldName], `${indent}    `));
    if (lines.length === 0) return [];
    return [`${indent}- "${node.fieldName}"${labelHint(node)} (a group of fields - nest under this name in "fields"):`, ...lines];
  }
  if (node.kind === "component-repeat") {
    const items = Array.isArray(value) ? value : [];
    const itemShape = node.itemFields.flatMap((child) => describeNode(child, undefined, `${indent}    `));
    if (itemShape.length === 0) return [];
    return [
      `${indent}- "${node.fieldName}"${labelHint(node)} (a repeatable list, currently ${items.length} item${items.length === 1 ? "" : "s"} - a block sequence of mappings under this name) - each item has:`,
      ...itemShape,
    ];
  }
  return [];
}

/** Describes every writable field of the entry, with its current value, for
 * the system prompt - recurses into `flatten`/`component-repeat`, skips
 * `relation`/`relation-mirror`/`password`/`secretkey`. */
export function describeFieldsForPrompt(nodes: EntryFieldNode[], value: EntryValue): string {
  const lines = nodes.flatMap((node) => describeNode(node, value[node.fieldName], ""));
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
 * fetching the web) nor treats every message as a command to write fields. */
const CAPABILITY_INSTRUCTION = [
  "You are having an ongoing conversation with the admin, not filling out a one-shot form. Keep chatting across turns: after you write fields, the admin may reply to refine, correct, or ask for something else entirely - treat that as a continuation of the same task, not a new one.",
  "What you CAN do: discuss what to write, ask questions, and write content into the fields listed above (a normal `kind: fields` reply).",
  "What you CANNOT do, no matter how the admin phrases it: save or publish the entry, create or modify fields/content types, delete anything, upload files, or fetch anything from outside this conversation (no web access, no other entries). If asked for one of these, say so in a `kind: chat` reply and suggest the closest thing you actually can do instead of pretending to do it.",
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
    "Linked data on this entry (read-only context - relation fields are never a write target, do not include them in \"fields\"):",
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
    "There are three possible top-level replies:",
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
    "  author:",
    "    name: |",
    "      A value nested under a group-of-fields.",
    "  sections:",
    "    - heading: |",
    "        First item's value.",
    "      body: |",
    "        <p>...</p>",
    "```",
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
    "",
    `Language: the admin reads "${lang}". Write every prose value ("text", "summary", RichText/text content, "question", choice "label"s) in "${lang}". Never translate field names, "kind", "topic", choice "id"s, or the literal tokens true/false.`,
  ].join("\n");
}
