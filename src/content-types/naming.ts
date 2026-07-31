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
  "sortindex",
  "parent_id",
  "position",
  "target_id",
]);

function isReserved(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    RESERVED_NAMES.has(lower) ||
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

export function validateContentTypeName(
  name: string,
  allTypes: ContentTypeDefinition[],
): void {
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
    throw new NamingError(
      `Content type name "${name}" is already used by "${collision.name}".`,
    );
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
      throw new NamingError(
        `Field name "${field.name}" is used more than once on "${definition.name}".`,
      );
    }
    seen.set(lower, field.name);

    // `migration.ts`'s `diffColumns` keys columns by field id - a duplicate
    // id (only reachable by calling the API directly, bypassing the UI's
    // `crypto.randomUUID()`) would silently collapse two real columns into
    // one during diffing without this check ever catching it.
    if (seenIds.has(field.id)) {
      throw new NamingError(
        `Field id "${field.id}" is used more than once on "${definition.name}".`,
      );
    }
    seenIds.add(field.id);
  }
}

/** Rejects any save of a `frozen` content type outright - see `types.ts`'s
 * doc comment on `ContentTypeDefinition.frozen` for why (`role`/`permission`/
 * `aiKey` are fixed system infrastructure with hardcoded table/column shape
 * elsewhere, e.g. `permissions.ts`). `existing` is the type's current
 * stored definition (`undefined` for a brand-new save, which can never be
 * frozen - nothing's seeded it yet). */
export function assertNotFrozen(existing: ContentTypeDefinition | undefined): void {
  if (!existing?.frozen) return;
  throw new NamingError(
    `"${existing.label || existing.name}" is managed automatically and can't be edited here.`,
  );
}

/** Rejects a save that changes or removes any of `existing`'s
 * `protectedFieldIds` (see `types.ts`) - `next` is the incoming definition,
 * about to be saved over `existing`. A no-op when `existing` is `undefined`
 * (brand-new save) or has no protected fields. Compares each protected
 * field's full `FieldDefinition` by value (not just presence) so a rename,
 * retype, or config/validation change is caught exactly like an outright
 * removal - `protectedFieldIds` means the field is frozen in place, not just
 * un-deletable. */
export function validateProtectedFields(
  existing: ContentTypeDefinition | undefined,
  next: ContentTypeDefinition,
): void {
  if (!existing?.protectedFieldIds?.length) return;
  for (const id of existing.protectedFieldIds) {
    if (next.deletedFieldIds?.includes(id)) {
      throw new NamingError(
        `Field "${id}" on "${existing.name}" is required and can't be removed.`,
      );
    }
    const before = existing.fields.find((f) => f.id === id);
    const after = next.fields.find((f) => f.id === id);
    if (!after) {
      throw new NamingError(
        `Field "${before?.label ?? id}" on "${existing.name}" is required and can't be removed.`,
      );
    }
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      throw new NamingError(
        `Field "${before?.label ?? id}" on "${existing.name}" is required and can't be edited.`,
      );
    }
  }
}

/** Overwrites every field's `order` to match its current position in
 * `fields[]` - the array is always the real source of truth for order; this
 * makes that position an explicit, durable property instead of only ever
 * being implicit, regardless of what a client submits. Called once, right
 * before validating/planning a save (`routes/content-types.ts`). */
export function normalizeFieldOrder(
  definition: ContentTypeDefinition,
): ContentTypeDefinition {
  return {
    ...definition,
    fields: definition.fields.map((field, index) => ({
      ...field,
      order: index,
    })),
  };
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
      throw new NamingError(
        `Cannot encode non-finite number ${value} as a SQL literal.`,
      );
    }
    return String(value);
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}
