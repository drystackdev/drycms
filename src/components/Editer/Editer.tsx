import { useEffect, useRef } from "preact/hooks";
import type { JSX } from "preact/jsx-runtime";
import type { PrismEditor } from "prism-code-editor";
import {
  autoComplete,
  type Completion,
  fuzzyFilter,
  registerCompletions,
} from "prism-code-editor/autocomplete";
import autocompleteIconsCss from "prism-code-editor/autocomplete-icons.css?raw";
import autocompleteCss from "prism-code-editor/autocomplete.css?raw";
import { cursorPosition } from "prism-code-editor/cursor";
import "prism-code-editor/prism/languages/tsx";
import { basicEditor } from "prism-code-editor/setups";
import type { IncludedTheme } from "prism-code-editor/themes";
import { tailwindCompletionSource } from "./tailwind-completions.js";
import type { EditerDiagnostic, EditerResult } from "./types.js";
import { EditerWorkerClient } from "./worker-client.js";
import type { EditerCompletionItem } from "./worker-protocol.js";

export interface EditerProps {
  value: string;
  onChange: (result: EditerResult) => void;
  /** Path -> content of other `.tsx`/`.ts` files the code being edited can import from -
   * see `ts-worker.ts`'s module resolution. Not watched/discovered automatically. */
  extraFiles?: Record<string, string>;
  /** Set once at mount - not live-updatable, matching `basicEditor`'s own contract. */
  theme?: IncludedTheme;
  class?: string;
  style?: JSX.CSSProperties;
}

interface InstanceState {
  client: EditerWorkerClient;
  /** Per-position cache bridging the worker's async completions onto
   * `CompletionSource`'s synchronous return contract - see `tsCompletionSource`. */
  cache: Map<number, EditerCompletionItem[]>;
}

/** Keyed by editor instance so the (registered once, globally) "tsx" completion
 * sources below can find the right worker/cache for whichever `Editer` is
 * currently querying - entries drop on their own once an editor is GC'd. */
const instances = new WeakMap<PrismEditor, InstanceState>();

function toCompletion(item: EditerCompletionItem): Completion {
  return {
    label: item.label,
    insert: item.insert,
    detail: item.detail,
    icon: item.kind,
    boost: item.boost,
  };
}

function wordStart(before: string): number {
  let i = before.length;
  while (i > 0 && /[A-Za-z0-9_$]/.test(before[i - 1]!)) i--;
  return i;
}

/**
 * Bridges `EditerWorkerClient.getCompletions` (async, via `postMessage`) onto
 * `prism-code-editor`'s `CompletionSource`, which must return synchronously:
 * the first time a position is queried, kicks off the request and returns
 * `null` (nothing cached yet), then forces the tooltip to re-query once the
 * response lands - by which point this same function finds the position
 * already in `cache` and returns it synchronously instead of re-fetching.
 *
 * That cache-miss check is not an optimization, it's load-bearing: `update`
 * (mount effect below) clears `cache` on every keystroke, but `startQuery`
 * itself runs on nearly every keystroke too (any selection change with
 * nothing selected) - so re-fetching unconditionally on every call would
 * mean every `startQuery` re-triggering *this* re-query, which re-triggers
 * `startQuery` again, forever, the moment two calls ever raced (which they
 * always eventually do). Hit this once as an infinite loop that froze the
 * tab - only fire a request when this exact position has never been asked
 * about since the last edit.
 */
function tsCompletionSource(context: { pos: number; before: string }, editor: PrismEditor) {
  const state = instances.get(editor);
  if (!state) return null;
  const { client, cache } = state;
  const cached = cache.get(context.pos);
  if (cached === undefined) {
    client.getCompletions(context.pos).then((items) => {
      cache.set(context.pos, items);
      if (instances.get(editor) === state) editor.extensions.autoComplete?.startQuery();
    });
    return null;
  }
  if (!cached.length) return null;
  return { from: wordStart(context.before), options: cached.map(toCompletion) };
}

let completionsRegistered = false;
function ensureCompletionsRegistered() {
  if (completionsRegistered) return;
  completionsRegistered = true;
  registerCompletions(["tsx"], { sources: [tailwindCompletionSource, tsCompletionSource] });
}

const ERROR_LINE_CLASS = "editer-line-error";
const WARNING_LINE_CLASS = "editer-line-warning";

/**
 * Marks each line with a diagnostic (background tint + left bar, see the
 * injected CSS below) instead of precise squiggly underlines under the
 * exact `column`/`length` range - `editor.lines[n]` already holds
 * syntax-highlighted HTML for that line (nested spans from tokenizing), and
 * slicing a plain character range out of that without corrupting it needs
 * hooking `onTokenize` to split tokens at the right boundaries. Line-level
 * marking gets "errors visible in the editor" without that - precise
 * per-range underlines are a possible follow-up, not implemented here.
 */
function applyLineDiagnostics(editor: PrismEditor, errors: EditerDiagnostic[]): void {
  const lines = editor.lines;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    line?.classList.remove(ERROR_LINE_CLASS, WARNING_LINE_CLASS);
    line?.removeAttribute("title");
  }
  const byLine = new Map<number, { source: EditerDiagnostic["source"]; messages: string[] }>();
  for (const error of errors) {
    const entry = byLine.get(error.line) ?? { source: error.source, messages: [] };
    if (error.source === "syntax") entry.source = "syntax"; // syntax outranks type when a line has both
    entry.messages.push(error.message);
    byLine.set(error.line, entry);
  }
  for (const [lineNumber, { source, messages }] of byLine) {
    const line = lines[lineNumber];
    if (!line) continue;
    line.classList.add(source === "syntax" ? ERROR_LINE_CLASS : WARNING_LINE_CLASS);
    line.title = messages.join("\n");
  }
}

/**
 * TSX/Preact code editor: `prism-code-editor` (mounted in its own Shadow DOM
 * by `basicEditor` - see `plans/code-editer.md` mục 6) for the surface, a
 * `typescript` Language Service running in a Web Worker for diagnostics and
 * completions (`ts-worker.ts`), and `tailwindcss`'s design system for class
 * name suggestions (`tailwind-completions.ts`). Full panel, no card chrome -
 * sizing/border is the caller's call via `class`/`style`.
 */
export default function Editer({
  value,
  onChange,
  extraFiles,
  theme = "vs-code-dark",
  class: className,
  style,
}: EditerProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<PrismEditor>();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const extraFilesRef = useRef(extraFiles ?? {});
  extraFilesRef.current = extraFiles ?? {};
  // `onChange`'s `result.code` is a snapshot from whenever the debounced
  // worker round-trip started - by the time it comes back, the user may
  // already have typed further keystrokes the editor itself has, but this
  // echo doesn't. Tracks what we last reported so the `value`-sync effect
  // below can tell "parent echoed our own onChange back at us" (skip - the
  // editor's current, possibly newer, content wins) apart from "parent set
  // a genuinely different value" (apply it).
  const lastReportedCodeRef = useRef(value);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const client = new EditerWorkerClient((result) => {
      lastReportedCodeRef.current = result.code;
      if (editorRef.current) applyLineDiagnostics(editorRef.current, result.errors);
      onChangeRef.current(result);
    });
    // Every cached position is only valid against the code it was computed
    // from - stale entries would otherwise resurface via `tsCompletionSource`
    // if the cursor ever returns to a position number it previously visited.
    const cache = new Map<number, EditerCompletionItem[]>();
    const editor = basicEditor(host, {
      language: "tsx",
      value,
      theme,
      tabSize: 2,
      onUpdate: (code) => {
        cache.clear();
        client.update(code, extraFilesRef.current);
      },
    });
    editorRef.current = editor;
    instances.set(editor, { client, cache });
    ensureCompletionsRegistered();
    editor.addExtensions(cursorPosition(), autoComplete({ filter: fuzzyFilter }));

    const shadowRoot = host.shadowRoot;
    if (shadowRoot) {
      const style = document.createElement("style");
      // `.prism-code-editor` (layout.css, loaded by `basicEditor` itself) has
      // no explicit height - it sizes to its content (line count) by
      // default. Without this override the "full panel" host div (mục 6)
      // stays empty space below a content-height editor, and - non-obviously
      // - the autocomplete tooltip's max-height (computed off the editor's
      // own `clientHeight`) then gets squeezed to a couple px too, since
      // there's barely any container height to work with.
      style.textContent = `.prism-code-editor{height:100%}
.${ERROR_LINE_CLASS}{background:color-mix(in srgb, red 15%, transparent);box-shadow:inset 2px 0 0 0 red;}
.${WARNING_LINE_CLASS}{background:color-mix(in srgb, orange 12%, transparent);box-shadow:inset 2px 0 0 0 orange;}
${autocompleteCss}
${autocompleteIconsCss}`;
      shadowRoot.append(style);
    }

    client.update(value, extraFilesRef.current);

    return () => {
      editorRef.current = undefined;
      editor.remove();
      client.dispose();
    };
    // Mount once; `value`/`extraFiles`/`theme` prop changes are synced by
    // the effects below instead of remounting the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || value === lastReportedCodeRef.current) return;
    if (editor.value !== value) editor.setOptions({ value });
  }, [value]);

  useEffect(() => {
    const editor = editorRef.current;
    const state = editor && instances.get(editor);
    if (editor && state) state.client.update(editor.value, extraFilesRef.current);
  }, [extraFiles]);

  return (
    <div
      ref={hostRef}
      class={className}
      style={{ width: "100%", height: "100%", ...style }}
    />
  );
}
