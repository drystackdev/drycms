import FieldListItem from "./FieldListItem.js";
import type { FieldDefinition } from "../../content-types/types.js";

export interface SystemFieldEntry {
  id: string;
  label: string;
}

function toFieldDefinition(entry: SystemFieldEntry): FieldDefinition {
  return { id: entry.id, name: entry.id, label: entry.label, config: {}, validation: {}, type: "" };
}

/** The read-only "System fields" list above the custom Fields list - ID
 * always, Title+Slug/Draft/Schedule/Timestamps only when their matching
 * feature is on (see `systemFieldsForUi` in ContentTypeEditor.tsx). */
export default function SystemFieldsList({ items }: { items: SystemFieldEntry[] }) {
  if (items.length === 0) return null;
  return (
    <div>
      <h3>System fields</h3>
      <ul class="content-type-list">
        {items.map((item) => (
          <FieldListItem key={item.id} system field={toFieldDefinition(item)} />
        ))}
      </ul>
    </div>
  );
}
