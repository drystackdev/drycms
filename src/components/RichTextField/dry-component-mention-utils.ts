import type { Node as PMNode } from "prosemirror-model";
import type { EditorView } from "prosemirror-view";
import fuzzysort from "fuzzysort";
import type { DryComponentRecord } from "./component-registry-types.js";
import { flattenDryComponentRecords } from "./component-registry-types.js";

export interface Candidate {
  record: DryComponentRecord;
  path: string;
  label: string;
  name: string;
}

export interface ComponentContext {
  pos: number;
  node: PMNode;
  record: DryComponentRecord;
  path: string;
}

export interface MentionMatch {
  from: number;
  to: number;
  raw: string;
  query: string;
  topLevel: boolean;
  key: string;
}

export function mentionAtCursor(view: EditorView): MentionMatch | null {
  const selection = view.state.selection;
  if (!selection.empty || !selection.$from.parent.isTextblock) return null;
  const text = selection.$from.parent.textBetween(0, selection.$from.parentOffset, "\0", "\0");
  const lastSpace = Math.max(text.lastIndexOf(" "), text.lastIndexOf("\t"), text.lastIndexOf("\n"));
  const token = text.slice(lastSpace + 1);
  if (!/^@{1,2}[^\s@]*$/.test(token)) return null;
  const topLevel = token.startsWith("@@");
  const query = token.slice(topLevel ? 2 : 1);
  const from = selection.from - token.length;
  const to = selection.from;
  return { from, to, raw: token, query, topLevel, key: `${from}:${to}:${token}` };
}

export function scopedCandidates(records: DryComponentRecord[], context: ComponentContext | null, topLevel: boolean): Candidate[] {
  if (topLevel || !context) {
    return records.map((record) => ({ record, path: record.name, label: record.label, name: record.name }));
  }
  const byName = new Map(flattenDryComponentRecords(records).map((record) => [record.name, record]));
  const result: Candidate[] = [];
  const seen = new Set<string>();
  const visit = (record: DryComponentRecord, prefix: string) => {
    for (const refName of record.refs ?? []) {
      const ref = byName.get(refName);
      if (!ref || seen.has(ref.name)) continue;
      seen.add(ref.name);
      const path = `${prefix}.${ref.name}`;
      result.push({ record: ref, path, label: ref.label, name: ref.name });
      visit(ref, path);
    }
  };
  visit(context.record, context.path || context.record.name);
  return result;
}

export function filteredCandidates(candidates: Candidate[], query: string): Candidate[] {
  if (!query) return candidates;
  return fuzzysort.go(query, candidates, { keys: ["path", "label", "name"], threshold: -10000 }).map((result) => result.obj);
}
