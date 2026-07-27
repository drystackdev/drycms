import type { ContentTypeDefinition, FieldDefinition } from "./types.js";

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
} as const;

/** The synthetic fields implied by `type.features`, in front of `type.fields`
 * every time a table tree is resolved. `title` is NOT a standalone default -
 * it's bundled with `slug` (turning `slug` on adds both); `id` is never in
 * here at all, unconditionally on every root table (see `migration.ts`'s
 * `CREATE TABLE ... INTEGER PRIMARY KEY AUTOINCREMENT` codegen) - it is
 * baked directly into the DDL rather than being a diffable field. `draft`/
 * `schedule`/`timestamps` are collection-only; `singleton` only ever gets
 * `slug` (+ the `title` it brings with it); `component` has no table of its
 * own and never calls this. */
export function systemFieldsFor(type: ContentTypeDefinition): FieldDefinition[] {
  const fields: FieldDefinition[] = [];

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

  return fields;
}
