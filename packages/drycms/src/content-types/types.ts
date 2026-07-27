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
  /** True for fields that shipped as part of a `system` content type's
   * default shape (see `seed.ts`) - can't be removed, though it can still be
   * reordered or edited. Enforced server-side against the stored (not
   * client-submitted) definition, in `naming.ts`'s
   * `validateSystemProtections`. */
  locked?: boolean;
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
  /** Optimistic-lock counter, incremented on every successful save. */
  version: number;
  /** True for the built-in defaults seeded at first boot (`user`, `menu`,
   * `menuItem` - see `seed.ts`). Protects the type itself from deletion and
   * blocks un-marking it back to `false`; its `locked` fields and any
   * feature already on stay required too - see `validateSystemProtections`.
   * New fields can still be added and everything can still be reordered. */
  system?: boolean;
  /** Only takes effect when `system` is also true. Freezes the shape
   * entirely: no new fields can be added and no feature can be toggled at
   * all (stricter than plain `system`, which still allows both) - the type
   * is display-only in the schema editor. Used by `role`/`permission`/
   * `aiKeyManagement` (see `seed.ts`); enforced in `naming.ts`'s
   * `validateSystemProtections`. */
  structureLocked?: boolean;
}
