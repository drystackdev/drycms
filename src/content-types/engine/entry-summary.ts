import type { ContentTypeDefinition } from "../types.js";
import { buildEntryFieldTree, flattenSummaryCandidates, type EntryFieldNode, type SummaryFieldCandidate } from "./entry-tree.js";

/** How deep `buildEntrySummary` will recurse into nested `relation`/
 * `component-repeat` display fields before giving up - belt-and-suspenders
 * alongside `visitedTypeIds`' cycle detection below: a chain that never
 * revisits the same TARGET type (e.g. A -> B -> C -> D -> ...) would
 * otherwise recurse forever even without a literal cycle. */
const MAX_SUMMARY_DEPTH = 4;

export interface SummaryItem {
  /** The related/embedded row's own id - a real entry id for a `relation`
   * item, a synthetic per-render index (`String(i)`) for a `component-repeat`
   * item (those have no id of their own - see `ComponentField.tsx`). */
  id: string;
  lines: SummaryLine[];
}

export interface SummaryLine {
  fieldName: string;
  label: string;
  /** `image`/`list-items` get their own rendering; everything else
   * (text/richtext/number/boolean/date/select) is pre-formatted into `text`
   * by `formatScalarText` below - `EntrySummaryLines.tsx` doesn't need to
   * know about every scalar field type individually. */
  kind: "text" | "image" | "list-items";
  /** `kind: "text"` only. */
  text?: string;
  /** `kind: "image"` only - storage ids to render as thumbnails. */
  imageIds?: string[];
  /** `kind: "list-items"` only (a `relation`/`component-repeat` display
   * field) - one entry per related/embedded item, each already resolved to
   * its OWN summary lines (recursing with that field's own `displayFields`). */
  items?: SummaryItem[];
  /** `kind: "list-items"` only - set instead of resolving `items` once
   * `MAX_SUMMARY_DEPTH` or a repeated target type stops recursion (see
   * `visitedTypeIds` below), so the UI can render "..." rather than silently
   * showing an empty list. */
  truncated?: boolean;
}

/** Fetches one related entry's already-populated value (relation/component
 * child arrays included, same shape `entriesApi.get()` returns) so
 * `buildEntrySummary` can recurse into it - injected rather than called
 * directly so this module stays a pure function of its inputs, testable with
 * a fake resolver instead of a real API/DB round trip. Returning `undefined`
 * (deleted/unreadable id) degrades to a bare id line, same as a dangling
 * relation elsewhere in this codebase. */
export type ResolveRelation = (
  targetTypeId: string,
  id: string,
) => Promise<Record<string, unknown> | undefined>;

function getPath(value: Record<string, unknown>, dottedFieldName: string): unknown {
  return dottedFieldName
    .split(".")
    .reduce<unknown>((v, segment) => (v && typeof v === "object" ? (v as Record<string, unknown>)[segment] : undefined), value);
}

/** Strips tags from a `richtext` value down to a plain-text preview - never
 * renders raw HTML inline in a summary line (same reasoning as
 * `ContentEntryList.tsx`'s own block-richtext cell, just without that cell's
 * "open a dialog for the full HTML" escape hatch - a summary line has no
 * dialog of its own to open). */
function stripHtml(html: string): string {
  const text = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text.length > 140 ? `${text.slice(0, 140)}…` : text;
}

function formatScalarText(fieldType: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (fieldType === "boolean") return value ? "On" : "Off";
  if (fieldType === "richtext") return stripHtml(String(value));
  if (Array.isArray(value)) return value.map((v) => String(v)).join(", ");
  return String(value);
}

async function buildItemsForRelation(
  candidate: Extract<SummaryFieldCandidate, { kind: "relation" }>,
  rawValue: unknown,
  allTypes: ContentTypeDefinition[],
  resolveRelation: ResolveRelation,
  depth: number,
  visitedTypeIds: ReadonlySet<string>,
): Promise<{ items: SummaryItem[]; truncated: boolean }> {
  const ids = candidate.cardinality === "manyToOne"
    ? typeof rawValue === "string" && rawValue !== ""
      ? [rawValue]
      : []
    : Array.isArray(rawValue)
      ? rawValue.map((id) => String(id))
      : [];
  if (ids.length === 0) return { items: [], truncated: false };
  if (depth >= MAX_SUMMARY_DEPTH || visitedTypeIds.has(candidate.targetTypeId)) {
    return { items: [], truncated: true };
  }

  const targetType = allTypes.find((t) => t.id === candidate.targetTypeId);
  const targetFieldNodes = targetType ? buildEntryFieldTree(targetType, allTypes) : [];
  const nextVisited = new Set([...visitedTypeIds, candidate.targetTypeId]);

  const items = await Promise.all(
    ids.map(async (id): Promise<SummaryItem> => {
      const targetValue = targetType ? await resolveRelation(candidate.targetTypeId, id) : undefined;
      if (!targetValue) {
        return { id, lines: [{ fieldName: "id", label: "ID", kind: "text", text: id }] };
      }
      const lines = await buildEntrySummary(
        candidate.displayFields,
        targetFieldNodes,
        targetValue,
        allTypes,
        resolveRelation,
        depth + 1,
        nextVisited,
      );
      return { id, lines };
    }),
  );
  return { items, truncated: false };
}

async function buildItemsForComponentRepeat(
  candidate: Extract<SummaryFieldCandidate, { kind: "component-repeat" }>,
  rawValue: unknown,
  allTypes: ContentTypeDefinition[],
  resolveRelation: ResolveRelation,
  depth: number,
  visitedTypeIds: ReadonlySet<string>,
): Promise<{ items: SummaryItem[]; truncated: boolean }> {
  const rows = Array.isArray(rawValue) ? (rawValue as Record<string, unknown>[]) : [];
  if (rows.length === 0) return { items: [], truncated: false };
  // Component items are already inline data (no fetch involved), but still
  // count against the depth cap - a component nested inside itself through a
  // chain of relations is otherwise just as capable of recursing forever.
  if (depth >= MAX_SUMMARY_DEPTH) return { items: [], truncated: true };

  const items = await Promise.all(
    rows.map(async (row, index): Promise<SummaryItem> => ({
      id: String(index),
      lines: await buildEntrySummary(
        candidate.displayFields,
        candidate.itemFields,
        row,
        allTypes,
        resolveRelation,
        depth + 1,
        visitedTypeIds,
      ),
    })),
  );
  return { items, truncated: false };
}

/**
 * Resolves a `RelationFieldConfig.displayFields`/`ComponentFieldConfig.displayFields`
 * pick into actual `SummaryLine`s for one item's already-fetched `value` -
 * the shared logic behind every "list component" summary in the app
 * (`RelationField.tsx`'s chosen-item chips, `ComponentField.tsx`'s item
 * list, `ContentEntryList.tsx`'s relation column). Framework-agnostic (no
 * JSX) so it's unit-testable without rendering anything; async because a
 * `relation` display field needs `resolveRelation` to fetch its target
 * entry before it can be summarized in turn.
 *
 * Empty/undefined `displayFields` falls back to the FIRST candidate field -
 * exactly the hardcoded "first field" behavior every one of the three call
 * sites used before this existed, so an existing content type with no
 * `displayFields` set renders identically to before.
 */
export async function buildEntrySummary(
  displayFields: string[] | undefined,
  fieldNodes: EntryFieldNode[],
  value: Record<string, unknown>,
  allTypes: ContentTypeDefinition[],
  resolveRelation: ResolveRelation,
  depth = 0,
  visitedTypeIds: ReadonlySet<string> = new Set(),
): Promise<SummaryLine[]> {
  const candidates = flattenSummaryCandidates(fieldNodes);
  const byName = new Map(candidates.map((c) => [c.fieldName, c]));
  const chosen = displayFields && displayFields.length > 0
    ? displayFields.map((name) => byName.get(name)).filter((c): c is SummaryFieldCandidate => !!c)
    : candidates.slice(0, 1);

  return Promise.all(
    chosen.map(async (candidate): Promise<SummaryLine> => {
      if (candidate.kind === "column") {
        const raw = getPath(value, candidate.fieldName);
        if (candidate.fieldType === "image") {
          const ids = raw === null || raw === undefined || raw === "" ? [] : Array.isArray(raw) ? raw.map(String) : [String(raw)];
          return { fieldName: candidate.fieldName, label: candidate.label, kind: "image", imageIds: ids };
        }
        return { fieldName: candidate.fieldName, label: candidate.label, kind: "text", text: formatScalarText(candidate.fieldType, raw) };
      }
      if (candidate.kind === "relation") {
        const { items, truncated } = await buildItemsForRelation(
          candidate,
          value[candidate.fieldName],
          allTypes,
          resolveRelation,
          depth,
          visitedTypeIds,
        );
        return { fieldName: candidate.fieldName, label: candidate.label, kind: "list-items", items, truncated };
      }
      const { items, truncated } = await buildItemsForComponentRepeat(
        candidate,
        value[candidate.fieldName],
        allTypes,
        resolveRelation,
        depth,
        visitedTypeIds,
      );
      return { fieldName: candidate.fieldName, label: candidate.label, kind: "list-items", items, truncated };
    }),
  );
}
