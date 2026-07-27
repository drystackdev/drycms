import CheckField from "../../components/CheckField.js";
import type { ContentTypeFeatures, ContentTypeKind } from "../../content-types/types.js";

interface FeatureDescriptor {
  key: keyof ContentTypeFeatures;
  label: string;
  description: string;
}

/** Plain-language description per feature, for people who aren't going to
 * read the schema to understand what a toggle does. */
export const FEATURES_BY_KIND: Record<ContentTypeKind, FeatureDescriptor[]> = {
  collection: [
    { key: "slug", label: "Slug", description: "Adds a URL-friendly Slug field, and a Title field to go with it." },
    { key: "draft", label: "Draft", description: "Lets you save an entry as a private draft before publishing it." },
    {
      key: "schedule",
      label: "Schedule",
      description: "Lets you set a future date/time for an entry to go live automatically.",
    },
    {
      key: "fullSearch",
      label: "Full-text search",
      description: "Makes every text field on this content type searchable.",
    },
    {
      key: "timestamps",
      label: "Timestamps",
      description: "Automatically records when each entry was created and last updated.",
    },
    {
      key: "seo",
      label: "SEO",
      description: "Adds Title, Description, and Image fields for search engines and social previews.",
    },
    {
      key: "sortable",
      label: "Sortable",
      description: "Lets you manually drag-reorder this collection's entries.",
    },
  ],
  singleton: [
    { key: "slug", label: "Slug", description: "Adds a URL-friendly Slug field, and a Title field to go with it." },
    {
      key: "seo",
      label: "SEO",
      description: "Adds Title, Description, and Image fields for search engines and social previews.",
    },
  ],
  component: [],
};

export interface FeaturesFieldsetProps {
  kind: ContentTypeKind;
  features: ContentTypeFeatures | undefined;
  onChange: (key: keyof ContentTypeFeatures, value: boolean) => void;
  /** When true, this content type's structure is fully frozen (`role`/
   * `permission`/`aiKeyManagement` - see `types.ts`'s `structureLocked`):
   * disables every toggle. */
  disabled?: boolean;
  /** Individual feature keys that can't be turned off because the built-in
   * seed default already requires them on (e.g. `timestamps` on `User`/
   * `Menu` - see `naming.ts`'s `LOCKABLE_FEATURES`). Ignored when `disabled`
   * is already true (the whole fieldset is frozen either way). */
  requiredKeys?: ReadonlySet<keyof ContentTypeFeatures>;
}

export default function FeaturesFieldset({ kind, features, onChange, disabled, requiredKeys }: FeaturesFieldsetProps) {
  const items = FEATURES_BY_KIND[kind];
  if (items.length === 0) return null;
  return (
    <fieldset>
      <legend>Features</legend>
      <div class="stack" style={{marginBottom: '1rem'}}>
        {items.map(({ key, label, description }) => (
          <div key={key}>
            <CheckField
              role="switch"
              disabled={disabled || requiredKeys?.has(key)}
              description={description}
              label={label}
              value={!!features?.[key]}
              onChange={(value) => onChange(key, value)}
            />
          </div>
        ))}
      </div>
    </fieldset>
  );
}
