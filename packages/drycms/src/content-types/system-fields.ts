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
} as const;

/** The synthetic fields implied by `type.features`, in front of `type.fields`
 * every time a table tree is resolved. `collection` gets every feature;
 * `singleton` only ever gets `slug` (doc: "Features chỉ có [x] slug");
 * `component` has no table of its own and never calls this. */
export function systemFieldsFor(type: ContentTypeDefinition): FieldDefinition[] {
  const fields: FieldDefinition[] = [
    {
      id: SYSTEM_FIELD_IDS.title,
      name: "title",
      label: "Title",
      type: "text",
      config: {},
      validation: { required: true },
    },
  ];

  if (type.features?.slug) {
    fields.push({
      id: SYSTEM_FIELD_IDS.slug,
      name: "slug",
      label: "Slug",
      type: "text",
      config: {},
      validation: { required: true, unique: true },
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
  }

  return fields;
}
