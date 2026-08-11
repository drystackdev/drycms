import type { RelationFieldConfig, RelationMirrorFieldConfig } from "./field-registry.js";
import type { ContentTypeDefinition, ContentTypeFeatures, FieldDefinition } from "./types.js";

/** `type.fields`, minus whatever's currently sitting in the trash (see
 * `types.ts`'s `deletedFieldIds`) - the DISPLAY-only view every consumer
 * that isn't generating DDL should read: the schema editor's Fields list,
 * the entry editor/API (`entry-tree.ts`'s `buildEntryFieldTree`), and
 * `relationMirrorFieldsFor` below (a trashed `relation` field's reverse
 * mirror on the other type disappears right along with it). `tree.ts`'s
 * `resolveTableTree` deliberately does NOT use this - it needs the RAW
 * `type.fields` (trashed field included) so the column keeps existing until
 * the field is deleted forever from the trash. */
export function activeFields(type: ContentTypeDefinition): FieldDefinition[] {
  const deleted = type.deletedFieldIds;
  if (!deleted || deleted.length === 0) return type.fields;
  const deletedSet = new Set(deleted);
  return type.fields.filter((field) => !deletedSet.has(field.id));
}

/** `type.features`, as if every trashed key (see `types.ts`'s
 * `deletedFeatureKeys`) were really off - the DISPLAY-only view every
 * consumer that isn't generating DDL should read: the Features checkboxes
 * and `activeSystemFieldsFor` below. `type.features[key]` itself
 * deliberately stays untouched (`tree.ts`'s `resolveTableTree` calls the real
 * `type.features` directly, never this) so the column(s) it implies keep
 * existing until the feature is deleted forever from the trash. */
export function effectiveFeatures(type: ContentTypeDefinition): ContentTypeFeatures {
  const deleted = type.deletedFeatureKeys;
  if (!deleted || deleted.length === 0) return type.features ?? {};
  const result: ContentTypeFeatures = { ...type.features };
  for (const key of deleted) result[key] = false;
  return result;
}

/** `systemFieldsFor`, as if every trashed feature were really off - the
 * DISPLAY-only counterpart to `activeFields` above, built on top of
 * `effectiveFeatures`. */
export function activeSystemFieldsFor(type: ContentTypeDefinition): FieldDefinition[] {
  return systemFieldsFor({ ...type, features: effectiveFeatures(type) });
}

/** Fixed, stable synthetic ids for the fields a `features` toggle implies -
 * turning a feature on/off is then exactly "a field with this id
 * appeared/disappeared" to the id-based migration diff, with no special
 * casing needed anywhere else. `id` itself is NOT in here: it's not a
 * diffable field, it's baked directly into every generated `CREATE TABLE`
 * as `INTEGER PRIMARY KEY AUTOINCREMENT` (see `tree.ts`). */
export const SYSTEM_FIELD_IDS = {
  title: "__system_title",
  slug: "__system_slug",
  draft: "__system_draft",
  schedule: "__system_schedule",
  createdAt: "__system_created_at",
  updatedAt: "__system_updated_at",
  seo: "__system_seo",
  sortIndex: "__system_sort_index",
} as const;

/** Fixed ids for the built-in components a feature toggle embeds (as opposed
 * to `SYSTEM_FIELD_IDS`, which are ids for the synthetic FIELDS themselves).
 * Lives here rather than in `seed.ts` so `systemFieldsFor` can reference the
 * component's id without importing `seed.ts` - `seed.ts` already imports
 * from this file, and the reverse would be circular. */
export const SYSTEM_COMPONENT_IDS = {
  seo: "system-seo",
} as const;

/** Fixed id for the built-in "SEO Defaults" singleton (see `seed.ts`) - the
 * one site-wide fallback SEO source. `dry-seo.ts`'s `seoTierFor` and
 * `page-handler.ts` recognize it by this id, not by name/label - both of
 * which stay freely editable (only `locked` against deletion, like `user`),
 * so an id-based check is the only stable way to always find it again. */
export const SEO_DEFAULTS_TYPE_ID = "system-seo-defaults";

/** Fixed id for the built-in "Google Verification" singleton (see `seed.ts`) -
 * a `name`/`content` pair `google-verification.ts` root-serves at
 * `/<name>` with `content` as the raw response body, for Google's HTML
 * site-verification method. Recognized by this fixed id, not by name/label,
 * same reasoning as `SEO_DEFAULTS_TYPE_ID` above. */
export const GOOGLE_VERIFICATION_TYPE_ID = "system-google-verification";

/** Fixed id for the built-in "GitHub Sync" singleton (see `seed.ts`) - repo/
 * branch/token config for pushing a snapshot commit of `pagesSourceStorage`
 * to GitHub on every Build/Build all (`server/github-source-sync.ts`).
 * Recognized by this fixed id, not by name/label, same reasoning as
 * `SEO_DEFAULTS_TYPE_ID` above. */
export const GITHUB_SYNC_TYPE_ID = "system-github-sync";

/** The synthetic fields implied by `type.features` - in front of `type.fields`
 * for the real DB column order (`tree.ts`'s `resolveTableTree`), but AFTER
 * `type.fields` for on-screen display order (`entry-tree.ts`'s
 * `buildEntryFieldTree`, `ContentTypeEditor.tsx`'s `systemFieldsForUi` +
 * `FieldsList.tsx`) - a feature toggled on lands after the fields someone
 * already set up, not shoved in front of them; both are then still freely
 * reorderable via `type.fieldOrder`/`applyFieldOrder`. `title` is NOT a
 * standalone default - it's bundled with `slug` (turning `slug` on adds
 * both); `id` is never in here at all, unconditionally on every root table
 * (see `migration.ts`'s `CREATE TABLE ... INTEGER PRIMARY KEY AUTOINCREMENT`
 * codegen) - it is baked directly into the DDL rather than being a diffable
 * field. `draft`/`schedule`/`timestamps` are collection-only; `singleton` only
 * ever gets `seo` from the UI now (`FeaturesFieldset.tsx`'s
 * `FEATURES_BY_KIND` no longer offers `slug` there - a singleton has exactly
 * one row, so a URL-unique slug never did anything for it) - this function
 * stays kind-agnostic regardless, so an existing singleton saved with the
 * flag on from before keeps generating `slug`/`title` unchanged; `component`
 * has no table of its own and never calls this. */
export function systemFieldsFor(type: ContentTypeDefinition): FieldDefinition[] {
  // `order` is assigned once, below, from final push order - these synthetic
  // fields aren't part of any persisted `fields[]` array (see `types.ts`'s
  // `FieldDefinition.order` doc) and `order` plays no role in how `tree.ts`
  // resolves them, so it's omitted here rather than threaded through every
  // literal below.
  const fields: Omit<FieldDefinition, "order">[] = [];

  if (type.features?.slug) {
    fields.push(
      {
        id: SYSTEM_FIELD_IDS.title,
        name: "title",
        label: "Title",
        type: "text",
        config: {},
        validation: { required: true },
      },
      {
        id: SYSTEM_FIELD_IDS.slug,
        name: "slug",
        label: "Slug",
        type: "text",
        config: {},
        validation: { required: true, unique: true },
      },
    );
  }

  if (type.features?.seo) {
    fields.push({
      id: SYSTEM_FIELD_IDS.seo,
      name: "seo",
      label: "SEO",
      type: "component",
      config: { componentId: SYSTEM_COMPONENT_IDS.seo, repeatable: false },
      validation: {},
    });
  }

  if (type.kind === "collection") {
    if (type.features?.draft) {
      fields.push({
        id: SYSTEM_FIELD_IDS.draft,
        name: "draft",
        label: "Draft",
        type: "boolean",
        config: {},
        validation: {},
      });
    }
    if (type.features?.schedule) {
      fields.push({
        id: SYSTEM_FIELD_IDS.schedule,
        name: "schedule",
        label: "Schedule",
        type: "date",
        config: { time: true },
        validation: {},
      });
    }
    if (type.features?.sortable) {
      // REAL (via the existing `number` field type) rather than INTEGER -
      // manually reordering an entry only needs to set its `sortIndex` to
      // something between its new neighbors (e.g. the average of theirs),
      // never a full renumbering pass over every other row.
      fields.push({
        id: SYSTEM_FIELD_IDS.sortIndex,
        name: "sortIndex",
        label: "Sort Index",
        type: "number",
        config: {},
        validation: {},
      });
    }
    if (type.features?.timestamps) {
      fields.push(
        {
          id: SYSTEM_FIELD_IDS.createdAt,
          name: "createdAt",
          label: "Created at",
          type: "date",
          config: { time: true },
          validation: {},
        },
        {
          id: SYSTEM_FIELD_IDS.updatedAt,
          name: "updatedAt",
          label: "Updated at",
          type: "date",
          config: { time: true },
          validation: {},
        },
      );
    }
  }

  return fields.map((field, index) => ({ ...field, order: index }));
}

/** Stable, deterministic id for the synthetic `relationmirror` field
 * `relationMirrorFieldsFor` generates for a given `(source type, relation
 * field)` pair - both ids are already globally unique, so this is really
 * just a namespaced, debuggable composite of them. */
function mirrorFieldId(sourceTypeId: string, sourceFieldId: string): string {
  return `__mirror_${sourceTypeId}_${sourceFieldId}`;
}

/**
 * The `relationmirror` fields implied by every OTHER content type's
 * `relation` fields that target `type` - the reverse-lookup side of a
 * relation is entirely auto-generated, never hand-added (see
 * `field-registry.ts`'s `relationMirrorFieldType`, `internal: true`). Mixed
 * into `type.fields` the same way `systemFieldsFor`'s output is: by
 * `entry-tree.ts`'s `buildEntryFieldTree` for entry read/write, and by
 * `ContentTypeEditor.tsx`'s `systemFieldsForUi` for the schema editor's
 * Fields list - appearing/disappearing automatically as relations are
 * added/removed/retargeted elsewhere, exactly like a feature-driven system
 * field appears/disappears with its toggle. A self-relation (the source type
 * IS `type` itself) is included - e.g. `Employee.manager` (relation) mirrors
 * back onto `Employee` itself as a synthetic "Employee" field.
 *
 * Only `collection`s are ever valid relation targets (see
 * `ContentTypeEditor.tsx`'s `dynamicOptions.collections`), so this always
 * returns `[]` for `component`/`singleton` types - not just an optimization,
 * a correctness fact worth short-circuiting explicitly.
 *
 * Label collision handling: when the SAME source type has more than one
 * `relation` field targeting `type` (e.g. `User.friends` and
 * `User.blockedUsers` both targeting `User`), the plain `source.label`
 * (e.g. "User") would be ambiguous repeated twice - disambiguated to
 * `"${source.label} (${field.label})"` only for that source type's mirrors,
 * everyone else keeps the plain label.
 *
 * A `source` that's itself `hidden` (e.g. `memory` - see `seed.ts`) is
 * skipped entirely: it's server-managed infrastructure with no legitimate
 * reason for an admin to see it surface as a field on the type it relates
 * to (e.g. a "Memory" field on `user`'s schema editor / entry form). Nothing
 * downstream needs that mirror - `routes/memory.ts` reaches its rows
 * directly by `user` id, never through this reverse side.
 */
export function relationMirrorFieldsFor(
  type: ContentTypeDefinition,
  allTypes: ContentTypeDefinition[],
): FieldDefinition[] {
  if (type.kind !== "collection") return [];

  const matches: { source: ContentTypeDefinition; field: FieldDefinition }[] = [];
  for (const source of allTypes) {
    if (source.hidden) continue;
    for (const field of activeFields(source)) {
      if (field.type !== "relation") continue;
      if ((field.config as RelationFieldConfig).target !== type.id) continue;
      matches.push({ source, field });
    }
  }

  const countBySource = new Map<string, number>();
  for (const { source } of matches) {
    countBySource.set(source.id, (countBySource.get(source.id) ?? 0) + 1);
  }

  return matches.map(({ source, field }, index) => {
    const disambiguate = (countBySource.get(source.id) ?? 0) > 1;
    const id = mirrorFieldId(source.id, field.id);
    return {
      id,
      name: disambiguate ? `${source.name}${field.name.charAt(0).toUpperCase()}${field.name.slice(1)}` : source.name,
      label: disambiguate ? `${source.label} (${field.label})` : source.label,
      type: "relationmirror",
      // `displayFields` has no config field of its own to persist to (a
      // mirror isn't a real entry in `fields[]`) - sourced from `type`'s own
      // `fieldDisplayFields` overlay instead, same "cosmetic per-id map"
      // shape `fieldSides`/`fieldDescriptions` already use for this exact
      // situation (see `types.ts`'s doc comment on that map).
      config: { sourceTypeId: source.id, sourceFieldId: field.id, displayFields: type.fieldDisplayFields?.[id] } satisfies RelationMirrorFieldConfig,
      validation: {},
      order: index,
    };
  });
}

/** Applies a stored display order (a permutation of `items`' own ids, see
 * `types.ts`'s `ContentTypeDefinition.fieldOrder`) on top of their natural
 * order: ids listed in `order` win, in that sequence; anything NOT listed -
 * a field just added, or a system field a feature just turned on - is
 * appended afterward, in its natural relative order. Self-healing by
 * construction: `order` can freely go stale (reference a since-removed
 * field/feature) without ever needing a migration - unresolvable ids are
 * silently skipped. */
export function applyFieldOrder<T extends { id: string }>(items: T[], order: string[] | undefined): T[] {
  if (!order || order.length === 0) return items;
  const byId = new Map(items.map((item) => [item.id, item]));
  const ordered: T[] = [];
  for (const id of order) {
    const item = byId.get(id);
    if (item) {
      ordered.push(item);
      byId.delete(id);
    }
  }
  for (const item of items) {
    if (byId.has(item.id)) ordered.push(item);
  }
  return ordered;
}

export type FieldSide = "left" | "right";

/** System fields that default to the right (side) column despite being
 * plain columns, not `relation`/`component` - `seo` is a `component` field
 * anyway (covered either way), `draft`/`schedule` are the two feature-driven
 * fields that carry a real input control (unlike read-only `createdAt`/
 * `updatedAt`, which are excluded from the entry form entirely - see
 * `ContentEntryEditor.tsx`'s `isTimestampField`). */
const RIGHT_BY_DEFAULT_SYSTEM_FIELD_IDS: ReadonlySet<string> = new Set([
  SYSTEM_FIELD_IDS.seo,
  SYSTEM_FIELD_IDS.draft,
  SYSTEM_FIELD_IDS.schedule,
]);

/** The column a field displays in absent an explicit `fieldSides` override -
 * `isRelationOrComponent` is `field.type === "relation" || field.type ===
 * "component"` for a custom field, or `EntryFieldNode.kind !== "column"` for
 * an already-built entry-tree node (both mean the same thing: a relation or
 * a component, repeatable or not). */
export function defaultFieldSide(id: string, isRelationOrComponent: boolean): FieldSide {
  if (isRelationOrComponent) return "right";
  return RIGHT_BY_DEFAULT_SYSTEM_FIELD_IDS.has(id) ? "right" : "left";
}

/** Applies a stored `fieldSides` override (see `types.ts`'s
 * `ContentTypeDefinition.fieldSides`) on top of `defaultFieldSide` - self-
 * healing the same way `applyFieldOrder` is: an id missing from `sides` (a
 * field just added, or never explicitly moved) just falls back to its
 * computed default instead of erroring. */
export function resolveFieldSide(id: string, isRelationOrComponent: boolean, sides: Record<string, FieldSide> | undefined): FieldSide {
  return sides?.[id] ?? defaultFieldSide(id, isRelationOrComponent);
}
