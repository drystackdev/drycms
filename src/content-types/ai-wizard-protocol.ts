/**
 * The structured question/proposal/done protocol the Content Types "Ask AI"
 * wizard (`AiSchemaWizardDialog.tsx`) speaks with the model, over
 * `/api/ai/chat`'s `wizard` mode (`src/server/routes/ai.ts`). Deliberately a
 * closed, narrow shape - the wizard never shows a free-text chat box, so
 * every model reply must parse into exactly one of these three turn kinds or
 * it's rejected and the model is asked to resend (see `describeWizardIssue`
 * below, used to build that corrective follow-up).
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
}

export interface WizardProposalTurn {
  kind: "proposal";
  question: string;
  tables: WizardProposedTable[];
}

export interface WizardDoneTurn {
  kind: "done";
  summary: string;
  tables: WizardProposedTable[];
}

export type WizardTurn = WizardQuestionTurn | WizardProposalTurn | WizardDoneTurn;

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
  return {
    name: raw.name,
    label: raw.label,
    kind: raw.kind as WizardTableKind,
    description: typeof raw.description === "string" ? raw.description : undefined,
    isNew: raw.isNew,
    fields,
    removeFields,
  };
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
  if (kind === "done") {
    if (!isNonEmptyString(raw.summary)) return { ok: false, error: '"summary" must be a non-empty string.' };
    const tables = validateTables(raw.tables, "tables");
    if (typeof tables === "string") return { ok: false, error: tables };
    return { ok: true, turn: { kind: "done", summary: raw.summary, tables } };
  }
  return { ok: false, error: `"kind" ("${String(kind)}") must be one of: "question", "proposal", "done".` };
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
