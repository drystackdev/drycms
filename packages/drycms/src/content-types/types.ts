export interface FieldValidation {
  required?: boolean;
  unique?: boolean;
  min?: number | Date;
  max?: number | Date;
  maxLength?: number;
}

export interface FieldDefinition {
  id: string;
  name: string;
  label: string;
  type: string;
  config: unknown;
  validation: FieldValidation;
  default?: unknown;
}

export interface ContentTypeFeatures {
  slug?: boolean;
  draft?: boolean;
  schedule?: boolean;
  fullSearch?: boolean;
}

export type ContentTypeKind = "collection" | "singleton" | "component";

export interface ContentTypeDefinition {
  id: string;
  kind: ContentTypeKind;
  name: string;
  label: string;
  description?: string;
  features?: ContentTypeFeatures;
  fields: FieldDefinition[];
  /** Optimistic-lock counter, incremented on every successful save. */
  version: number;
}
