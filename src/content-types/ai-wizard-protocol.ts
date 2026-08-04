/**
 * The structured question/proposal protocol the Content Types "Ask AI"
 * wizard (`AiSchemaWizardDialog.tsx`) speaks with the model, over
 * `/api/ai/wizard` (`src/server/routes/ai.ts`). Deliberately a closed,
 * narrow shape - the wizard never shows a free-text chat box, so every
 * model reply must parse into exactly one of these two turn kinds or it's
 * rejected and the model is asked to resend.
 *
 * `proposal` is the terminal turn - there is no separate "done"/confirm
 * round-trip with the model. Content Types already has its own staged-
 * draft review (`status/content-type-staged-apply.md`'s "Apply Builder"),
 * so asking the model to confirm a SECOND time before staging would just
 * duplicate that: the admin reviews/keeps/drops/reorders the proposed
 * tables directly in the dialog, and confirming there stages them as
 * drafts immediately (client-side, `ai-wizard-map.ts`) - no further AI call.
 *
 * Field vocabulary is intentionally a subset of `field-registry.ts`'s full
 * set: `password`/`secretkey` are security-sensitive internal types not
 * meant to be casually proposed by a model, `component`/`relationmirror`
 * need a target component/relation picked first and are deferred to a later
 * pass (see `status/ai-schema-wizard.md`).
 */

export const WIZARD_FIELD_TYPES = [
  "text",
  "richtext",
  "number",
  "boolean",
  "date",
  "image",
  "select",
] as const;
export type WizardFieldType = (typeof WIZARD_FIELD_TYPES)[number] | "relation";

export const WIZARD_RELATION_CARDINALITIES = ["manyToOne", "oneToMany", "manyToMany"] as const;
export type WizardRelationCardinality = (typeof WIZARD_RELATION_CARDINALITIES)[number];

export const WIZARD_TABLE_KINDS = ["collection", "singleton"] as const;
export type WizardTableKind = (typeof WIZARD_TABLE_KINDS)[number];

/** Mirrors `ContentTypeFeatures` (`content-types/types.ts`) - kept as its
 * own closed list here (rather than importing that type directly) so this
 * protocol module stays the single place that defines what a model is
 * allowed to send, independent of the app's internal type ever growing a
 * field the wizard isn't ready to offer yet. */
export const WIZARD_FEATURE_KEYS = ["slug", "draft", "schedule", "timestamps", "seo", "sortable"] as const;
export type WizardFeatureKey = (typeof WIZARD_FEATURE_KEYS)[number];

export interface WizardChoice {
  id: string;
  label: string;
}

export interface WizardQuestionTurn {
  kind: "question";
  /** Stable English machine key for this question round (e.g. "table-purpose") - never shown to the user, lets the client correlate an answer with what was asked without depending on the (translatable) `question` text. */
  topic: string;
  question: string;
  choices: WizardChoice[];
  multi: boolean;
  /** Whether the UI should also offer a short free-value "other" choice - only for inherently open-ended questions (e.g. a table name), never a substitute for the fixed-choice format itself. */
  allowOther?: boolean;
}

export interface WizardProposedField {
  name: string;
  label: string;
  description?: string;
  type: WizardFieldType;
  required?: boolean;
  /** `select` only. */
  options?: string[];
  /** `relation` only - another proposed table's `name`, or an existing content type's `name`. */
  relationTarget?: string;
  /** `relation` only. @default "manyToOne" */
  relationCardinality?: WizardRelationCardinality;
}

export interface WizardProposedTable {
  /** Machine name (`ContentTypeDefinition.name`) - for an existing table (`isNew: false`) this must match it exactly. */
  name: string;
  label: string;
  kind: WizardTableKind;
  description?: string;
  isNew: boolean;
  fields: WizardProposedField[];
  /** Existing field names to stage into the trash (`ContentTypeDefinition.deletedFieldIds`) - `isNew: false` only, ignored otherwise. */
  removeFields?: string[];
  /** Only `true` values are ever applied (see `ai-wizard-map.ts`'s
   * `mergeFeatures`) - the wizard can enable a feature but never disable one
   * an admin already turned on for an existing table. */
  features?: Partial<Record<WizardFeatureKey, boolean>>;
}

export interface WizardProposalTurn {
  kind: "proposal";
  question: string;
  tables: WizardProposedTable[];
}

export type WizardTurn = WizardQuestionTurn | WizardProposalTurn;

export type WizardValidationResult =
  | { ok: true; turn: WizardTurn }
  | { ok: false; error: string };

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateChoices(value: unknown): string | WizardChoice[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 8) {
    return '"choices" must be an array of 1 to 8 items.';
  }
  const seen = new Set<string>();
  const choices: WizardChoice[] = [];
  for (const [index, raw] of value.entries()) {
    if (!isPlainObject(raw) || !isNonEmptyString(raw.id) || !isNonEmptyString(raw.label)) {
      return `"choices[${index}]" must be an object with non-empty "id" and "label" strings.`;
    }
    if (seen.has(raw.id)) return `"choices[${index}].id" ("${raw.id}") is duplicated - every choice id must be unique.`;
    seen.add(raw.id);
    choices.push({ id: raw.id, label: raw.label });
  }
  return choices;
}

function validateField(raw: unknown, path: string): string | WizardProposedField {
  if (!isPlainObject(raw)) return `"${path}" must be an object.`;
  if (!isNonEmptyString(raw.name)) return `"${path}.name" must be a non-empty string.`;
  if (!isNonEmptyString(raw.label)) return `"${path}.label" must be a non-empty string.`;
  const type = raw.type;
  if (typeof type !== "string" || !(WIZARD_FIELD_TYPES as readonly string[]).includes(type) && type !== "relation") {
    return `"${path}.type" ("${String(type)}") must be one of: ${[...WIZARD_FIELD_TYPES, "relation"].join(", ")}.`;
  }
  if (raw.description !== undefined && typeof raw.description !== "string") {
    return `"${path}.description" must be a string when present.`;
  }
  if (raw.required !== undefined && typeof raw.required !== "boolean") {
    return `"${path}.required" must be a boolean when present.`;
  }
  if (type === "select") {
    if (!Array.isArray(raw.options) || raw.options.length === 0 || raw.options.some((option) => !isNonEmptyString(option))) {
      return `"${path}.options" must be a non-empty array of non-empty strings for a "select" field.`;
    }
  } else if (raw.options !== undefined) {
    return `"${path}.options" is only valid for a "select" field.`;
  }
  if (type === "relation") {
    if (!isNonEmptyString(raw.relationTarget)) {
      return `"${path}.relationTarget" must be a non-empty string for a "relation" field.`;
    }
    if (raw.relationCardinality !== undefined && !(WIZARD_RELATION_CARDINALITIES as readonly string[]).includes(raw.relationCardinality as string)) {
      return `"${path}.relationCardinality" must be one of: ${WIZARD_RELATION_CARDINALITIES.join(", ")}.`;
    }
  } else {
    if (raw.relationTarget !== undefined || raw.relationCardinality !== undefined) {
      return `"${path}.relationTarget"/"relationCardinality" are only valid for a "relation" field.`;
    }
  }
  return {
    name: raw.name,
    label: raw.label,
    description: typeof raw.description === "string" ? raw.description : undefined,
    type: type as WizardFieldType,
    required: typeof raw.required === "boolean" ? raw.required : undefined,
    options: type === "select" ? (raw.options as string[]) : undefined,
    relationTarget: type === "relation" ? (raw.relationTarget as string) : undefined,
    relationCardinality: type === "relation" && raw.relationCardinality !== undefined ? (raw.relationCardinality as WizardRelationCardinality) : undefined,
  };
}

function validateTable(raw: unknown, path: string): string | WizardProposedTable {
  if (!isPlainObject(raw)) return `"${path}" must be an object.`;
  if (!isNonEmptyString(raw.name)) return `"${path}.name" must be a non-empty string.`;
  if (!isNonEmptyString(raw.label)) return `"${path}.label" must be a non-empty string.`;
  if (typeof raw.kind !== "string" || !(WIZARD_TABLE_KINDS as readonly string[]).includes(raw.kind)) {
    return `"${path}.kind" ("${String(raw.kind)}") must be one of: ${WIZARD_TABLE_KINDS.join(", ")}.`;
  }
  if (typeof raw.isNew !== "boolean") return `"${path}.isNew" must be a boolean.`;
  if (raw.description !== undefined && typeof raw.description !== "string") {
    return `"${path}.description" must be a string when present.`;
  }
  if (!Array.isArray(raw.fields) || raw.fields.length > 20) {
    return `"${path}.fields" must be an array of at most 20 items.`;
  }
  if (raw.isNew && raw.fields.length === 0) {
    return `"${path}.fields" must include at least one field for a new table.`;
  }
  const fields: WizardProposedField[] = [];
  for (const [index, rawField] of raw.fields.entries()) {
    const result = validateField(rawField, `${path}.fields[${index}]`);
    if (typeof result === "string") return result;
    fields.push(result);
  }
  let removeFields: string[] | undefined;
  if (raw.removeFields !== undefined) {
    if (raw.isNew) return `"${path}.removeFields" is only valid when "isNew" is false.`;
    if (!Array.isArray(raw.removeFields) || raw.removeFields.some((name) => !isNonEmptyString(name))) {
      return `"${path}.removeFields" must be an array of non-empty strings when present.`;
    }
    removeFields = raw.removeFields as string[];
  }
  const features = validateFeatures(raw.features, `${path}.features`);
  if (typeof features === "string") return features;
  return {
    name: raw.name,
    label: raw.label,
    kind: raw.kind as WizardTableKind,
    description: typeof raw.description === "string" ? raw.description : undefined,
    isNew: raw.isNew,
    fields,
    removeFields,
    features,
  };
}

function validateFeatures(value: unknown, path: string): string | Partial<Record<WizardFeatureKey, boolean>> | undefined {
  if (value === undefined) return undefined;
  if (!isPlainObject(value)) return `"${path}" must be an object when present.`;
  const result: Partial<Record<WizardFeatureKey, boolean>> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!(WIZARD_FEATURE_KEYS as readonly string[]).includes(key)) {
      return `"${path}.${key}" is not a recognized feature - allowed: ${WIZARD_FEATURE_KEYS.join(", ")}.`;
    }
    if (typeof entry !== "boolean") return `"${path}.${key}" must be a boolean.`;
    result[key as WizardFeatureKey] = entry;
  }
  return result;
}

function validateTables(value: unknown, path: string): string | WizardProposedTable[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 6) {
    return `"${path}" must be an array of 1 to 6 items.`;
  }
  const tables: WizardProposedTable[] = [];
  for (const [index, raw] of value.entries()) {
    const result = validateTable(raw, `${path}[${index}]`);
    if (typeof result === "string") return result;
    tables.push(result);
  }
  return tables;
}

/**
 * Parses and structurally validates one model reply. Returns a precise,
 * quotable error string on failure - `routes/ai.ts`'s wizard mode feeds that
 * straight back to the model as a corrective follow-up turn and retries,
 * rather than duplicating validation logic client-side. This only checks
 * *shape* (the "yêu cầu lại đến khi chuẩn cấu trúc" requirement) - app-level
 * rules (name collisions, reserved words, etc.) are enforced separately when
 * the client maps a `done` turn onto real `ContentTypeDefinition` drafts.
 */
export function parseWizardTurn(raw: unknown): WizardValidationResult {
  if (!isPlainObject(raw)) return { ok: false, error: 'The reply must be a single JSON object, not an array or scalar.' };
  const kind = raw.kind;
  if (kind === "question") {
    if (!isNonEmptyString(raw.topic)) return { ok: false, error: '"topic" must be a non-empty string.' };
    if (!isNonEmptyString(raw.question)) return { ok: false, error: '"question" must be a non-empty string.' };
    const choices = validateChoices(raw.choices);
    if (typeof choices === "string") return { ok: false, error: choices };
    if (raw.multi !== undefined && typeof raw.multi !== "boolean") return { ok: false, error: '"multi" must be a boolean.' };
    if (raw.allowOther !== undefined && typeof raw.allowOther !== "boolean") return { ok: false, error: '"allowOther" must be a boolean when present.' };
    return {
      ok: true,
      turn: {
        kind: "question",
        topic: raw.topic,
        question: raw.question,
        choices,
        multi: raw.multi === true,
        allowOther: raw.allowOther === true ? true : undefined,
      },
    };
  }
  if (kind === "proposal") {
    if (!isNonEmptyString(raw.question)) return { ok: false, error: '"question" must be a non-empty string.' };
    const tables = validateTables(raw.tables, "tables");
    if (typeof tables === "string") return { ok: false, error: tables };
    return { ok: true, turn: { kind: "proposal", question: raw.question, tables } };
  }
  return { ok: false, error: `"kind" ("${String(kind)}") must be one of: "question", "proposal".` };
}

/** Extracts the first top-level `{...}` JSON object from a model reply,
 * tolerating surrounding prose or a ```json fenced block - CLI/provider
 * output isn't always guaranteed to be bare JSON even when asked. Returns
 * `undefined` if nothing parseable is found. */
export function extractWizardJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced?.[1] ?? text;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return undefined;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

/** Closes an open string and any open `{}`/`[]` left on the stack at the
 * end of `text`, tracking escape sequences so an escaped quote/backslash
 * inside a string is never mistaken for its unescaped counterpart. Doesn't
 * attempt to fix anything else - a dangling key with no `:` yet, or a
 * trailing `:`/`,`, still won't parse after this alone (see
 * `repairPartialJson`, which backs off past those). */
function closeOpenJson(text: string): string {
  let result = "";
  const stack: Array<"}" | "]"> = [];
  let inString = false;
  let escaped = false;

  for (const char of text) {
    if (inString) {
      result += char;
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      result += char;
      continue;
    }
    if (char === "{" || char === "[") {
      stack.push(char === "{" ? "}" : "]");
      result += char;
    } else if (char === "}" || char === "]") {
      if (stack[stack.length - 1] === char) stack.pop();
      result += char;
    } else {
      result += char;
    }
  }

  if (inString) result += '"';
  while (stack.length > 0) result += stack.pop();
  return result;
}

/** How far `repairPartialJson` will back off from the end of the buffer
 * looking for a prefix that parses - generous enough to skip past any
 * dangling key name in this protocol's schema (the longest,
 * "relationCardinality", is 20 characters) plus quoting/whitespace, without
 * risking real cost: this only ever runs on a wizard turn's own JSON
 * (at most a few KB), and the fast path (no backoff needed) is the common
 * case - most cut points land mid-string-value or mid-array, which
 * `closeOpenJson` alone already makes valid. */
const PARTIAL_JSON_BACKOFF_LIMIT = 80;

/**
 * Best-effort completion of a JSON string truncated mid-stream, for a live
 * PREVIEW only - `parseWizardTurn` on the final, complete text is still the
 * only result ever treated as authoritative or acted on. Closes what's
 * unambiguously still open (`closeOpenJson`); if that alone doesn't parse
 * (the cutoff landed mid-token - a dangling key with no `:` yet, a partial
 * number/`true`/`false`/`null` literal, a trailing `,`), backs off one
 * character at a time until some prefix does, rather than pattern-matching
 * every possible truncation shape individually.
 */
export function repairPartialJson(text: string): string {
  const limit = Math.min(PARTIAL_JSON_BACKOFF_LIMIT, text.length);
  for (let trim = 0; trim <= limit; trim++) {
    const candidate = closeOpenJson(text.slice(0, text.length - trim));
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      // Try one character shorter.
    }
  }
  return "{}";
}

export interface PartialWizardChoice {
  id?: string;
  label?: string;
}

export interface PartialWizardTable {
  name?: string;
  label?: string;
  kind?: string;
  isNew?: boolean;
  /** `fields.length` so far - the array itself isn't surfaced, a streaming
   * table's field list is too noisy to render field-by-field. */
  fieldCount: number;
}

export interface PartialWizardTurn {
  kind?: string;
  question?: string;
  choices?: PartialWizardChoice[];
  tables?: PartialWizardTable[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Loose, tolerant read of whatever's parseable from a wizard turn still
 * streaming in - unlike `parseWizardTurn`, this never rejects: it just
 * returns however much of `question`/`choices`/`tables` is legible right
 * now (an in-progress choice's `label` may end mid-word; that's fine, it
 * finishes filling in on the next delta). Returns `undefined` only when
 * nothing in the buffer parses as a JSON object at all yet.
 */
export function parsePartialWizardTurn(rawText: string): PartialWizardTurn | undefined {
  const fenced = rawText.match(/```(?:json)?\s*([\s\S]*)$/i);
  const candidate = fenced?.[1] ?? rawText;
  const start = candidate.indexOf("{");
  if (start === -1) return undefined;

  let parsed: unknown;
  try {
    parsed = JSON.parse(repairPartialJson(candidate.slice(start)));
  } catch {
    return undefined;
  }
  if (!isRecord(parsed)) return undefined;

  const result: PartialWizardTurn = {};
  if (typeof parsed.kind === "string") result.kind = parsed.kind;
  if (typeof parsed.question === "string") result.question = parsed.question;
  if (Array.isArray(parsed.choices)) {
    result.choices = parsed.choices
      .filter(isRecord)
      .map((choice) => ({
        id: typeof choice.id === "string" ? choice.id : undefined,
        label: typeof choice.label === "string" ? choice.label : undefined,
      }))
      .filter((choice) => choice.label);
  }
  if (Array.isArray(parsed.tables)) {
    result.tables = parsed.tables
      .filter(isRecord)
      .map((table) => ({
        name: typeof table.name === "string" ? table.name : undefined,
        label: typeof table.label === "string" ? table.label : undefined,
        kind: typeof table.kind === "string" ? table.kind : undefined,
        isNew: typeof table.isNew === "boolean" ? table.isNew : undefined,
        fieldCount: Array.isArray(table.fields) ? table.fields.length : 0,
      }))
      .filter((table) => table.label || table.name);
  }
  return result;
}
