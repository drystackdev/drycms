export interface FieldValidation {
  required?: boolean;
  unique?: boolean;
  min?: number | Date;
  max?: number | Date;
  minLength?: number;
  maxLength?: number;
  regex?: string;
  format?: "none" | "email" | "url" | "slug";
}

export interface FieldDefinition {
  id: string;
  name: string;
  label: string;
  type: string;
  description?: string;
  config: unknown;
  validation: FieldValidation;
  default?: unknown;
  /** Explicit position among this type's other custom fields - always kept
   * equal to this field's index in `fields[]` (the array itself stays the
   * real source of order; this is just a durable, explicit mirror of it, so
   * consumers don't have to rely on array position alone). Normalized
   * server-side on every save via `normalizeFieldOrder()` in `naming.ts`,
   * regardless of what a client submits - see `routes/content-types.ts`. */
  order: number;
}

export interface ContentTypeFeatures {
  slug?: boolean;
  draft?: boolean;
  schedule?: boolean;
  fullSearch?: boolean;
  timestamps?: boolean;
  /** Flattens the built-in `seo` component's fields (Title/Description/Image
   * - see `seed.ts`) in as `seo_metaTitle`/`seo_description`/`seo_image`. */
  seo?: boolean;
  /** Adds a system `sortIndex` column (see `system-fields.ts`) so this
   * collection's entries can be manually drag-reordered, independent of the
   * `FieldDefinition.order` mirror of a content TYPE's own field order -
   * this is about entry ROWS, not the schema's fields. `collection` only. */
  sortable?: boolean;
}

export type ContentTypeKind = "collection" | "singleton" | "component";

export interface ContentTypeDefinition {
  id: string;
  kind: ContentTypeKind;
  name: string;
  label: string;
  description?: string;
  /** URL (optionally templated, e.g. `https://example.com/posts/{slug}`) the
   * entry editor will eventually open for a live preview. `collection`/
   * `singleton` only - a `component` has no page of its own to preview. */
  livePreviewUrl?: string;
  features?: ContentTypeFeatures;
  fields: FieldDefinition[];
  /** Display order for the unified system+custom fields list (the schema
   * editor's field list and the entry editor's form) - a permutation of
   * `SYSTEM_FIELD_IDS` values (for whichever `features` are on) and this
   * type's own field ids, `id` itself excluded (always shown/reordered
   * separately, pinned first - see `ContentTypeEditor.tsx`'s
   * `systemFieldsForUi`). Purely cosmetic: it never affects the real column
   * order in the database (see `tree.ts`'s `resolveTableTree`, which always
   * puts system columns first) - only where things appear on screen. Applied
   * via `system-fields.ts`'s `applyFieldOrder`, which is self-healing: an id
   * missing here (a field just added, or a feature just turned on) is
   * appended in its natural default position instead of erroring. */
  fieldOrder?: string[];
  /** Which column (the entry editor's left "main content" column vs. right
   * "showcase" column - see `ContentEntryEditor.tsx`) each unified system+
   * custom field displays in, keyed the same way as `fieldOrder`. Missing ids
   * fall back to a computed default (`system-fields.ts`'s
   * `defaultFieldSide`: Relation/Component fields and the Draft/Schedule
   * system fields default to `"right"`, everything else `"left"`) - same
   * self-healing shape as `fieldOrder`, just for column instead of sequence.
   * Purely cosmetic, like `fieldOrder`: never affects the real column order
   * in the database. */
  fieldSides?: Record<string, "left" | "right">;
  /** Per-id description override, keyed the same way as `fieldOrder`/
   * `fieldSides` - but unlike those, only ever meaningful for a synthetic
   * `relationmirror` row (see `system-fields.ts`'s `relationMirrorFieldsFor`),
   * which has no `FieldDefinition.description` of its own to edit since it
   * isn't a real entry in `fields[]`. A real field's description just lives
   * on the field itself and never touches this map. Same self-healing shape:
   * a stale id (the relation it described no longer exists) is simply never
   * looked up again. */
  fieldDescriptions?: Record<string, string>;
  /** Optimistic-lock counter, incremented on every successful save. */
  version: number;
  /** True for the built-in defaults seeded at first boot (`user`, `menu`,
   * `menuItem`, `seo`, `aiKey`, `role`, `permission` - see `seed.ts`).
   * Purely for identification in the admin UI (a "System" badge, and the
   * ability to filter them out of the Content nav) - imposes no editing
   * restrictions of its own; fields, features, name, and the type itself
   * can all be freely changed or deleted, same as any other content type. */
  system?: boolean;
}
