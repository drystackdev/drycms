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
  timestamps?: boolean;
  /** Flattens the built-in `seo` component's fields (Title/Description/Image
   * - see `seed.ts`) in as `seo_metaTitle`/`seo_description`/`seo_image`. */
  seo?: boolean;
  /** Marks this singleton as the site-wide fallback SEO source - only
   * meaningful combined with `features.seo` itself. `dry()`'s reader
   * (`dry-seo.ts`'s `seoTierFor`) auto-seeds every render's "Default" SEO
   * layer from whichever singleton has this set, so a page that never sets
   * its own SEO still gets sensible `<title>`/meta tags. `singleton` only -
   * there's exactly one site to default for, not one per entry. */
  seoDefault?: boolean;
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
  /** Ids (from `fields[]`) sent to the trash by the schema editor's Remove
   * button - the `FieldDefinition` itself deliberately stays in `fields[]`,
   * untouched, so `tree.ts`/`migration.ts` keep generating its column exactly
   * as before and `naming.ts`'s uniqueness check still catches a new field
   * reusing its name. Only hidden from the active Fields list and the entry
   * editor/API (see `system-fields.ts`'s `activeFields`) - the real
   * `DROP COLUMN` only happens once an id is actually spliced out of
   * `fields[]` for good (deleted forever from the trash). Only ever
   * populated when editing an EXISTING content type - `ContentTypeEditor.tsx`
   * deletes for real immediately on a brand-new one, since there's no live
   * column yet to protect. */
  deletedFieldIds?: string[];
  /** `features` keys turned off through the trash the same way
   * `deletedFieldIds` stages a field - `features[key]` itself deliberately
   * stays `true` (so `tree.ts`'s `resolveTableTree`, which reads `features`
   * directly, keeps generating its column/s) until the feature is deleted
   * forever from the trash, which is what actually flips it to `false`. Only
   * hidden from the active Features checkboxes and the Fields/entry editor
   * display (`system-fields.ts`'s `activeSystemFieldsFor`) in the meantime. */
  deletedFeatureKeys?: (keyof ContentTypeFeatures)[];
  /** Optimistic-lock counter, incremented on every successful save. */
  version: number;
  /** True for a content type that must never appear anywhere a person picks
   * or browses content types by hand: the Content Types list
   * (`BuilderContentType.tsx`), the sidebar's Content dropdown
   * (`DryLayout.tsx`), and every
   * relation/component target picker (`ContentTypeEditor.tsx`'s
   * `dynamicOptions`). Still fully functional underneath (own table, own
   * entries API) - just reached through a dedicated page instead of the
   * generic content-type machinery (`role` via `Roles.tsx`/`RoleEditor.tsx`,
   * `aiKey` via its own pinned nav entry). Set on `role`, `aiKey` (see
   * `seed.ts`) and on the `seo` component (hidden
   * from the component-target picker specifically, since it's only ever
   * embedded via `features.seo`, never picked by hand). */
  hidden?: boolean;
  /** True for a content type whose TABLE itself can never be deleted - the
   * schema editor's Danger Zone is hidden/rejected client-side, and
   * `routes/content-types.ts`'s `DELETE` rejects it server-side too. Its
   * fields/features stay otherwise freely addable/editable/removable,
   * except whichever field ids are individually listed in
   * `protectedFieldIds`. Set on `user` (needed for login) and `seo` (needed
   * for `features.seo`); `role`/`aiKey` are covered by `frozen`
   * below instead, which already implies this. */
  locked?: boolean;
  /** True for a content type whose schema (fields, features, name - the
   * whole `ContentTypeDefinition` besides its actual data rows) can never be
   * changed via the generic content-types API at all, not just deleted -
   * `routes/content-types.ts` rejects any `PUT`/`DELETE` outright. Only ever
   * paired with `hidden: true`: these are fixed system infrastructure
   * (`permissions.ts` hardcodes their table/column shape) with no legitimate
   * reason for an admin to reshape them through the schema editor. Set on
   * `role`, `aiKey`. */
  frozen?: boolean;
  /** Field ids (from `fields[]`) that can never be edited or removed once
   * seeded, even though the type itself isn't `frozen` - critical to
   * another system's behavior (login, permissions) but otherwise an
   * ordinary type an admin can keep customizing. Still shown normally in the
   * Fields list and still openable in `FieldDialog` (so an admin can SEE
   * their configuration), just read-only once opened and never removable.
   * `routes/content-types.ts`'s `validateProtectedFields` (see `naming.ts`)
   * rejects a save that changes or drops one. Only ever populated on `user`
   * today (`email`/`password`/`roles` - see `seed.ts`). */
  protectedFieldIds?: string[];
}
