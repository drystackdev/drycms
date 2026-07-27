import type { ContentTypeDefinition } from "./types.js";

const CONTENT_TYPE_NAME_RE = /^[a-z][a-z0-9-]*$/i;
const FIELD_NAME_RE = /^[a-z][a-z0-9]*$/i;

/** Reserved regardless of case: the shared metadata table, every suffix/prefix
 * this engine's own generated DDL uses for scratch/derived objects, and the
 * synthetic system column names baked into every generated table. A field or
 * content type literally named e.g. `slug` would otherwise silently collide
 * with the synthetic `slug` system column when `features.slug` is on. */
const RESERVED_NAMES = new Set([
  "metadata",
  "id",
  "title",
  "slug",
  "draft",
  "schedule",
  "parent_id",
  "position",
  "target_id",
]);

function isReserved(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    RESERVED_NAMES.has(lower) ||
    lower.endsWith("_fts") ||
    lower === "__migrate_tmp" ||
    lower.startsWith("__rename_tmp_")
  );
}

export class NamingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NamingError";
  }
}

export function validateContentTypeName(name: string, allTypes: ContentTypeDefinition[]): void {
  if (!CONTENT_TYPE_NAME_RE.test(name)) {
    throw new NamingError(
      `Content type name "${name}" must start with a letter and contain only letters, digits, and hyphens.`,
    );
  }
  if (isReserved(name)) {
    throw new NamingError(`Content type name "${name}" is reserved.`);
  }
  const lower = name.toLowerCase();
  const collision = allTypes.find((t) => t.name.toLowerCase() === lower);
  if (collision) {
    throw new NamingError(`Content type name "${name}" is already used by "${collision.name}".`);
  }
}

export function validateFieldName(name: string): void {
  if (!FIELD_NAME_RE.test(name)) {
    throw new NamingError(
      `Field name "${name}" must start with a letter and contain only letters and digits (no "_" - it's used as the flatten-prefix separator).`,
    );
  }
  if (isReserved(name)) {
    throw new NamingError(`Field name "${name}" is reserved.`);
  }
}

/** Wraps a SQL identifier in double quotes, escaping embedded quotes. Every
 * DDL-generating function must route identifiers through this rather than
 * concatenating them raw, even though `validateContentTypeName`/
 * `validateFieldName` already restrict the input alphabet - belt and
 * suspenders around the one place user input becomes SQL syntax. */
export function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/**
 * Full validation for a content-type save: the type's own name (unique
 * among every OTHER existing type), plus every declared field's name (valid
 * + unique within this definition's own field list - two custom fields
 * can't collide, case-insensitively, since they'd become the same SQL
 * column). Doesn't touch fields belonging to OTHER content types (a
 * component's own fields are validated when that component itself is
 * saved, not by every dependent that embeds it).
 */
export function validateContentTypeDefinition(
  definition: ContentTypeDefinition,
  allTypes: ContentTypeDefinition[],
): void {
  const others = allTypes.filter((t) => t.id !== definition.id);
  validateContentTypeName(definition.name, others);

  const seen = new Map<string, string>();
  const seenIds = new Set<string>();
  for (const field of definition.fields) {
    validateFieldName(field.name);
    const lower = field.name.toLowerCase();
    const existing = seen.get(lower);
    if (existing) {
      throw new NamingError(`Field name "${field.name}" is used more than once on "${definition.name}".`);
    }
    seen.set(lower, field.name);

    // `migration.ts`'s `diffColumns` keys columns by field id - a duplicate
    // id (only reachable by calling the API directly, bypassing the UI's
    // `crypto.randomUUID()`) would silently collapse two real columns into
    // one during diffing without this check ever catching it.
    if (seenIds.has(field.id)) {
      throw new NamingError(`Field id "${field.id}" is used more than once on "${definition.name}".`);
    }
    seenIds.add(field.id);
  }
}

/** Feature flags whose synthetic fields (see `system-fields.ts`) a `system`
 * content type is allowed to depend on for its default shape - only these
 * are checked against being turned back off. */
const LOCKABLE_FEATURES = ["slug", "draft", "schedule", "timestamps"] as const;

/**
 * Guards a `system` content type's built-in shape (see `seed.ts`) against
 * deletion-shaped edits: un-marking it back to a plain (non-`system`) type,
 * removing a field the stored definition has `locked: true` on, or turning
 * off a `features` flag the stored definition already has on. Everything
 * else - adding fields, reordering, editing a locked field's label/
 * description/validation/config, renaming the type - is left alone.
 *
 * Checks against `existing` (the version already in storage), never against
 * `next`'s own `locked`/`system` claims - a single request can't strip
 * `locked` off a field and remove it in the same save, since the removal is
 * caught against what was actually stored beforehand.
 */
export function validateSystemProtections(next: ContentTypeDefinition, existing: ContentTypeDefinition | undefined): void {
  if (!existing?.system) return;

  if (!next.system) {
    throw new NamingError(`"${existing.label}" is a built-in content type and can't be un-marked as system.`);
  }

  const nextFieldIds = new Set(next.fields.map((f) => f.id));
  for (const field of existing.fields) {
    if (field.locked && !nextFieldIds.has(field.id)) {
      throw new NamingError(`Field "${field.label}" is required by "${existing.label}" and can't be removed.`);
    }
  }

  for (const key of LOCKABLE_FEATURES) {
    if (existing.features?.[key] && !next.features?.[key]) {
      throw new NamingError(`"${key}" can't be turned off on "${existing.label}" - a built-in field depends on it.`);
    }
  }
}

/** Encodes an already-`serialize()`d field value as a SQL literal, for use in
 * generated `DEFAULT` clauses. Not used for query values in general (those
 * are always bound parameters) - `ALTER TABLE ... ADD COLUMN ... DEFAULT`
 * support for bound parameters is inconsistent across the 3 local sqlite
 * drivers and D1, while a literal encoder is portable everywhere. */
export function toSqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new NamingError(`Cannot encode non-finite number ${value} as a SQL literal.`);
    }
    return String(value);
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}
