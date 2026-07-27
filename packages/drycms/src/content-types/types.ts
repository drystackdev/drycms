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
}
