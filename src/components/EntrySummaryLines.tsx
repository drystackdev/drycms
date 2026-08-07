import type { SummaryItem, SummaryLine } from "../content-types/engine/entry-summary.js";
import { encodePath } from "../storage/http-source.js";

const { path } = window.__DRY_CONFIG__;

export interface EntrySummaryLinesProps {
  lines: SummaryLine[];
}

/**
 * Renders `entry-summary.ts`'s `buildEntrySummary` output: one "Label:
 * value" line per configured display field, in order. A `relation`/
 * `component-repeat` display field (`kind: "list-items"`) renders its own
 * label, then a nested, indented `<ul>` of its items - each item recursing
 * back into this same component for its OWN lines, so "list trong list"
 * indents further at every level purely through normal DOM nesting (see
 * `.entry-summary-nested`'s CSS), no depth-tracking needed here.
 *
 * Shared by every "list component" summary in the app -
 * `RelationField.tsx`'s chosen-item chips, `ComponentField.tsx`'s item list,
 * `ContentEntryList.tsx`'s relation column - so all three stay visually and
 * behaviorally identical.
 */
export default function EntrySummaryLines({ lines }: EntrySummaryLinesProps) {
  if (lines.length === 0) return null;
  return (
    <div class="entry-summary-lines">
      {lines.map((line) => (
        <div class="entry-summary-line" key={line.fieldName}>
          <strong>{line.label}:</strong>{" "}
          {line.kind === "image" ? (
            <ImageValue imageIds={line.imageIds} />
          ) : line.kind === "list-items" ? (
            <ListItemsValue items={line.items} truncated={line.truncated} />
          ) : (
            <span>{line.text}</span>
          )}
        </div>
      ))}
    </div>
  );
}

function ImageValue({ imageIds }: { imageIds?: string[] }) {
  if (!imageIds || imageIds.length === 0) return <small class="hint">-</small>;
  return (
    <span class="row" style={{ display: "inline-flex", gap: "0.25rem", verticalAlign: "middle" }}>
      {imageIds.map((id) => (
        <img key={id} class="cell-image" src={`${path}/api/storage/${encodePath(id)}`} alt="" />
      ))}
    </span>
  );
}

function ListItemsValue({ items, truncated }: { items?: SummaryItem[]; truncated?: boolean }) {
  if (truncated) return <small class="hint">…</small>;
  if (!items || items.length === 0) return <small class="hint">-</small>;
  return (
    <ul class="entry-summary-nested">
      {items.map((item) => (
        <li key={item.id}>
          <EntrySummaryLines lines={item.lines} />
        </li>
      ))}
    </ul>
  );
}
