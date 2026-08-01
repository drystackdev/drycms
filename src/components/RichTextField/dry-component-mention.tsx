import { useEffect, useRef, useState } from "preact/hooks";
import type { RefObject } from "preact";
import type { Node as PMNode } from "prosemirror-model";
import { NodeSelection, TextSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import fuzzysort from "fuzzysort";
import { ComponentIcon } from "../icons.js";
import { useOverlayScrollbars } from "../overlayscrollbars.js";
import type { DryComponentRecord } from "./component-registry-types.js";
import { flattenDryComponentRecords } from "./component-registry-types.js";
import { loadRichtextComponents } from "./component-registry.js";

interface Props {
  viewRef: RefObject<EditorView | null>;
  ready: boolean;
  disabled?: boolean;
}

interface Candidate {
  record: DryComponentRecord;
  path: string;
  label: string;
  name: string;
}

interface ComponentContext {
  pos: number;
  node: PMNode;
  record: DryComponentRecord;
  path: string;
}

interface MentionMatch {
  from: number;
  to: number;
  raw: string;
  query: string;
  topLevel: boolean;
  key: string;
}

interface MentionState extends MentionMatch {
  candidates: Candidate[];
  selectedIndex: number;
  top: number;
  left: number;
}

function componentContext(view: EditorView, records: DryComponentRecord[]): ComponentContext | null {
  const selection = view.state.selection;
  if (!selection.empty) return null;
  const byName = new Map(flattenDryComponentRecords(records).map((record) => [record.name, record]));
  const names: string[] = [];
  let nearest: ComponentContext | null = null;
  for (let depth = 1; depth <= selection.$from.depth; depth++) {
    const node = selection.$from.node(depth);
    if (!node.type.name.startsWith("dry_")) continue;
    const name = node.type.name.slice("dry_".length);
    names.push(name);
    const record = byName.get(name);
    if (record) nearest = { pos: selection.$from.before(depth), node, record, path: "" };
  }
  if (!nearest) return null;
  nearest.path = names.reverse().join(".");
  return nearest;
}

function mentionAtCursor(view: EditorView): MentionMatch | null {
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

function scopedCandidates(
  records: DryComponentRecord[],
  context: ComponentContext | null,
  topLevel: boolean,
): Candidate[] {
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

function filteredCandidates(candidates: Candidate[], query: string): Candidate[] {
  if (!query) return candidates;
  return fuzzysort
    .go(query, candidates, { keys: ["path", "label", "name"], threshold: -10000 })
    .map((result) => result.obj);
}

function createComponentNode(view: EditorView, record: DryComponentRecord): PMNode | null {
  const nodeType = view.state.schema.nodes[`dry_${record.name}`];
  if (!nodeType) return null;
  return record.children
    ? nodeType.create({ props: record.defaults }, view.state.schema.nodes.paragraph!.createAndFill()!)
    : nodeType.create({ props: record.defaults });
}

function insertMention(view: EditorView, match: MentionMatch, record: DryComponentRecord, context: ComponentContext | null): boolean {
  const child = createComponentNode(view, record);
  if (!child) return false;
  let tr = view.state.tr.delete(match.from, match.to);

  if (context) {
    const parentPos = tr.mapping.map(context.pos);
    const parentNode = tr.doc.nodeAt(parentPos);
    if (!parentNode || parentNode.type.name !== `dry_${context.record.name}` || !parentNode.type.spec.content) return false;
    let insertPos = parentPos + parentNode.nodeSize - 1;
    if (child.type.isInline) {
      let textblockStart: number | null = null;
      parentNode.descendants((descendant, offset) => {
        if (textblockStart === null && descendant.isTextblock) {
          textblockStart = parentPos + 1 + offset;
          return false;
        }
        return textblockStart === null;
      });
      if (textblockStart !== null) {
        const textblock = tr.doc.nodeAt(textblockStart);
        insertPos = textblockStart + 1 + (textblock?.content.size ?? 0);
      } else {
        const paragraph = view.state.schema.nodes.paragraph!.create(null, child);
        tr = tr.insert(insertPos, paragraph);
        const childPos = insertPos + 1;
        if (!tr.doc.nodeAt(childPos)) return false;
        tr = tr.setSelection(NodeSelection.create(tr.doc, childPos)).scrollIntoView();
        view.dispatch(tr);
        view.focus();
        return true;
      }
    }
    tr = tr.insert(insertPos, child).setSelection(NodeSelection.create(tr.doc, insertPos)).scrollIntoView();
  } else {
    tr = tr.replaceSelectionWith(child);
    if (record.children) {
      let nodePos: number | null = null;
      tr.doc.descendants((candidate, pos) => {
        if (nodePos !== null) return false;
        if (candidate === child) {
          nodePos = pos;
          return false;
        }
        return true;
      });
      if (nodePos !== null) tr = tr.setSelection(TextSelection.near(tr.doc.resolve(nodePos + 1), 1));
    }
    tr = tr.scrollIntoView();
  }
  view.dispatch(tr);
  view.focus();
  return true;
}

export default function DryComponentMention({ viewRef, ready, disabled = false }: Props) {
  const [records, setRecords] = useState<DryComponentRecord[]>([]);
  const [mention, setMention] = useState<MentionState | null>(null);
  const mentionRef = useRef<MentionState | null>(null);
  const dismissedKeyRef = useRef<string | null>(null);
  const dismissedUntilInputRef = useRef(false);
  const { ref: listRef } = useOverlayScrollbars<HTMLDivElement>([!!mention]);

  useEffect(() => {
    if (!ready || disabled) return;
    let cancelled = false;
    loadRichtextComponents().then((loaded) => {
      if (!cancelled) setRecords(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [ready, disabled]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !ready || disabled) return;

    const refresh = () => {
      const current = viewRef.current;
      if (!current || records.length === 0) return;
      if (dismissedUntilInputRef.current) return;
      const match = mentionAtCursor(current);
      if (!match || dismissedKeyRef.current === match.key) {
        mentionRef.current = null;
        setMention(null);
        return;
      }
      const context = componentContext(current, records);
      const candidates = filteredCandidates(scopedCandidates(records, context, match.topLevel), match.query);
      if (candidates.length === 0) {
        mentionRef.current = null;
        setMention(null);
        return;
      }
      const coords = current.coordsAtPos(current.state.selection.from);
      const next: MentionState = {
        ...match,
        candidates,
        selectedIndex: Math.min(mentionRef.current?.selectedIndex ?? 0, candidates.length - 1),
        top: coords.bottom + 4,
        left: coords.left,
      };
      dismissedKeyRef.current = null;
      mentionRef.current = next;
      setMention(next);
    };

    const close = (dismiss = false) => {
      const current = mentionRef.current;
      if (dismiss && current) {
        dismissedKeyRef.current = current.key;
        dismissedUntilInputRef.current = true;
      }
      mentionRef.current = null;
      setMention(null);
    };

    const onInput = () => {
      dismissedUntilInputRef.current = false;
      queueMicrotask(refresh);
    };
    const onSelectionChange = () => {
      if (document.activeElement === view.dom || view.dom.contains(document.activeElement)) queueMicrotask(refresh);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const current = mentionRef.current;
      if (!current) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        const selectedIndex = (current.selectedIndex + delta + current.candidates.length) % current.candidates.length;
        const next = { ...current, selectedIndex };
        mentionRef.current = next;
        setMention(next);
      } else if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        const candidate = current.candidates[current.selectedIndex];
        if (candidate) {
          const context = componentContext(view, records);
          if (insertMention(view, current, candidate.record, current.topLevel ? context : context)) close();
        }
      } else if (event.key === "Escape" || event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === " ") {
        close(true);
      } else if (event.key === "Backspace" || event.key === "Delete") {
        queueMicrotask(refresh);
      }
    };

    view.dom.addEventListener("input", onInput);
    view.dom.addEventListener("keydown", onKeyDown);
    document.addEventListener("selectionchange", onSelectionChange);
    return () => {
      view.dom.removeEventListener("input", onInput);
      view.dom.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, [viewRef, ready, disabled, records]);

  if (!mention) return null;
  return (
    <div
      class="dry-component-mention-popup"
      role="listbox"
      aria-label="Components"
      style={{ position: "fixed", top: `${mention.top}px`, left: `${mention.left}px` }}
    >
      <div class="dry-component-mention-list" ref={listRef}>
        {mention.candidates.map((candidate, index) => (
          <button
            type="button"
            role="option"
            aria-selected={index === mention.selectedIndex}
            class={index === mention.selectedIndex ? "selected" : undefined}
            key={`${candidate.path}:${candidate.record.name}`}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              const view = viewRef.current;
              if (!view) return;
              const context = componentContext(view, records);
              if (insertMention(view, mention, candidate.record, context)) {
                mentionRef.current = null;
                setMention(null);
              }
            }}
          >
            <ComponentIcon />
            <span class="dry-component-mention-path">{candidate.path}</span>
            <small>{candidate.label}</small>
          </button>
        ))}
      </div>
    </div>
  );
}
