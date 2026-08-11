import CheckField from "../../components/fields/CheckField.js";
import type {
  ContentTypeFeatures,
  ContentTypeKind,
} from "../../content-types/types.js";

interface FeatureDescriptor {
  key: keyof ContentTypeFeatures;
  label: string;
  description: string;
}

/** Plain-language description per feature, for people who aren't going to
 * read the schema to understand what a toggle does. */
export const FEATURES_BY_KIND: Record<ContentTypeKind, FeatureDescriptor[]> = {
  collection: [
    {
      key: "slug",
      label: "Slug",
      description:
        "Adds a URL-friendly Slug field, and a Title field to go with it.",
    },
    {
      key: "draft",
      label: "Draft",
      description:
        "Lets you save an entry as a private draft before publishing it.",
    },
    {
      key: "schedule",
      label: "Schedule",
      description:
        "Lets you set a future date/time for an entry to go live automatically.",
    },
    {
      key: "timestamps",
      label: "Timestamps",
      description:
        "Automatically records when each entry was created and last updated.",
    },
    {
      key: "seo",
      label: "SEO",
      description:
        "Adds Title, Description, and Image fields for search engines and social previews.",
    },
    {
      key: "sortable",
      label: "Sortable",
      description: "Lets you manually drag-reorder this collection's entries.",
    },
  ],
  singleton: [
    {
      key: "seo",
      label: "SEO",
      description:
        "Adds Title, Description, and Image fields for search engines and social previews.",
    },
  ],
  component: [],
};

export interface FeaturesFieldsetProps {
  kind: ContentTypeKind;
  features: ContentTypeFeatures | undefined;
  onChange: (key: keyof ContentTypeFeatures, value: boolean) => void;
}

export default function FeaturesFieldset({
  kind,
  features,
  onChange,
}: FeaturesFieldsetProps) {
  const items = FEATURES_BY_KIND[kind];
  if (items.length === 0) return null;
  return (
    <fieldset>
      <legend>Features</legend>
      <div class="stack" style={{ marginBottom: "0.5rem", gap: "1rem" }}>
        {items.map(({ key, label, description }) => (
          <div key={key}>
            <CheckField
              role="switch"
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
