import type { EntryFieldNode } from "./engine/entry-tree.js";
import type { EntryValue } from "./engine/entry-codec.js";
import type { SelectFieldConfig } from "./field-registry.js";
import { isEmptyValue, WRITABLE_COLUMN_TYPES } from "./ai-magic-write-fields.js";

function previewValue(value: unknown): string {
  if (isEmptyValue(value)) return "(empty)";
  if (typeof value === "string") return JSON.stringify(value.length > 200 ? `${value.slice(0, 200)}…` : value);
  return JSON.stringify(value);
}

function describeNode(node: EntryFieldNode, value: unknown, indent: string): string[] {
  if (node.kind === "relation" || node.kind === "relation-mirror") return [];
  if (node.kind === "column") {
    if (!WRITABLE_COLUMN_TYPES.has(node.fieldType)) return [];
    const options = node.fieldType === "select" ? (node.fieldConfig as SelectFieldConfig | undefined)?.options ?? [] : undefined;
    const extra = options ? ` (options: ${options.map((option) => JSON.stringify(option)).join(", ")})` : "";
    const description = node.description ? ` - ${node.description}` : "";
    return [`${indent}- "${node.fieldName}" (${node.fieldType})${extra}${description} - current value: ${previewValue(value)}`];
  }
  if (node.kind === "flatten") {
    const nested = (value as EntryValue | undefined) ?? {};
    const lines = node.children.flatMap((child) => describeNode(child, nested[child.fieldName], `${indent}    `));
    if (lines.length === 0) return [];
    return [`${indent}- "${node.fieldName}" (a group of fields - nest under this name in "fields"):`, ...lines];
  }
  if (node.kind === "component-repeat") {
    const items = Array.isArray(value) ? value : [];
    const itemShape = node.itemFields.flatMap((child) => describeNode(child, undefined, `${indent}    `));
    if (itemShape.length === 0) return [];
    return [
      `${indent}- "${node.fieldName}" (a repeatable list, currently ${items.length} item${items.length === 1 ? "" : "s"} - a block sequence of mappings under this name) - each item has:`,
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

/** No fixed mode/target-field list - the admin's own prompt is the only
 * signal for which fields to touch, and the model is trusted to read it
 * against each field's "current value" above and decide for itself (see
 * `status/magic-write.md` decision update: the admin no longer pre-selects
 * "only empty fields" vs a specific field list through the UI). */
const SCOPE_INSTRUCTION =
  'Decide for yourself which fields to write to, based ONLY on what the admin\'s prompt below asks for - do not write to every field just because it exists. If a field already has good content and the prompt doesn\'t call for changing it, leave it out of "fields" entirely; if the prompt implies overwriting something that already has a value, overwrite it.';

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
    `You are Magic Write, a writing assistant inside drycms that fills in content fields for "${typeLabel}" entries. The admin gives you a short prompt describing what they want; you write the actual field content directly - you are not designing a schema, only authoring content for one that already exists.`,
    "",
    "Fields on this entry:",
    fieldsDescription,
    "",
    SCOPE_INSTRUCTION,
    ...describeImages(imagePaths),
    ...describeRelationContext(relationContext),
    "",
    'RichText field HTML dialect - use ONLY these tags, nothing else (no classes, no style attributes, no tables, no <div>/<span>): <p>, <h2>-<h6>, <blockquote>, <ul>, <ol>, <li>, <strong>, <em>, <u>, <a href="...">, <br>, and (only when an allowed image path is listed above) <img src="...">. Every RichText value must be well-formed HTML built only from those tags - plain prose wrapped in <p> at minimum.',
    "",
    "Reply format - a SINGLE response in this exact hand-rolled YAML-like dialect, nothing else (no prose outside it, no markdown code fence):",
    '- Every line is either `key: |` followed by indented raw lines (a block literal - use this for EVERY prose value: labels, questions, RichText HTML, any text field), or `key: value` on one line (a plain scalar - use this ONLY for a number/boolean/date/select value or an image path), or `key:` followed by indented nested `key: value` lines (a mapping, for a "group of fields"), or `key:` followed by indented `- key: |` items (a block sequence, for a "repeatable list").',
    "- Indent consistently with exactly 2 spaces per level. Never use tabs.",
    "- Boolean values are the plain scalar text `true` or `false`.",
    "",
    "There are two possible top-level replies:",
    "",
    '1. `kind: fields` - your normal reply, writing content. Shape:',
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
    '2. `kind: question` - ONLY if you genuinely cannot produce good content without asking (rare - prefer writing something reasonable over asking). Cap: at most 2 questions total for this whole task. Shape (same fields as the schema wizard, same dialect):',
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
    `Language: the admin reads "${lang}". Write every prose value ("summary", RichText/text content, "question", choice "label"s) in "${lang}". Never translate field names, "kind", "topic", choice "id"s, or the literal tokens true/false.`,
  ].join("\n");
}
