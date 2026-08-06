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
import { highlightText } from "prism-code-editor/prism";
import "prism-code-editor/prism/languages/tsx";
import { basicEditor } from "prism-code-editor/setups";
import type { IncludedTheme } from "prism-code-editor/themes";
import { addTooltip } from "prism-code-editor/tooltips";
import { insertText } from "prism-code-editor/utils";
import { toast } from "../Toast.js";
import { tailwindCompletionSource } from "./tailwind-completions.js";
import type { EditerDiagnostic, EditerResult } from "./types.js";
import { EditerWorkerClient } from "./worker-client.js";
import type {
  EditerCodeFix,
  EditerCompletionItem,
  EditerLanguageConfig,
  EditerSignatureHelp,
  EditerTextEdit,
} from "./worker-protocol.js";

export interface EditerProps {
  value: string;
  onChange: (result: EditerResult) => void;
  /** Path -> content of other `.tsx`/`.ts` files the code being edited can import from -
   * see `ts-worker.ts`'s module resolution. Not watched/discovered automatically. */
  extraFiles?: Record<string, string>;
  /** Set once at mount - not live-updatable, matching `basicEditor`'s own contract. */
  theme?: IncludedTheme;
  /** Merged on top of `ts-worker.ts`'s own defaults (ES2022/bundler resolution/preact
   * JSX/strict) - set once at mount, like `theme`. */
  compilerOptions?: EditerLanguageConfig["compilerOptions"];
  /** Merged on top of `ts-worker.ts`'s own default `Shift+Alt+F` formatting style - set
   * once at mount, like `theme`. */
  formatOptions?: EditerLanguageConfig["formatOptions"];
  /** @default 2 */
  tabSize?: number;
  /** Delay after the last keystroke before diagnostics recompute and `onChange` fires.
   * @default 300 */
  debounceMs?: number;
  /** Whether `className`/`class` JSX attribute strings offer Tailwind class-name
   * completions (see `tailwind-completions.ts`) - per-instance, since the completion
   * source itself is registered once, globally, the first time any `Editer` mounts.
   * @default true */
  tailwindCompletions?: boolean;
  /** Diagnostics/hover/completions/signature-help stay fully active (useful for
   * reviewing generated/example code with type errors surfaced) - only typing,
   * `Shift+Alt+F`, and applying a quick fix are disabled. @default false */
  readOnly?: boolean;
  class?: string;
  style?: JSX.CSSProperties;
}

interface InstanceState {
  client: EditerWorkerClient;
  /** Per-position cache bridging the worker's async completions onto
   * `CompletionSource`'s synchronous return contract - see `tsCompletionSource`. */
  cache: Map<number, EditerCompletionItem[]>;
  /** Positions with a `getCompletions` request already in flight - see `tsCompletionSource`. */
  pending: Set<number>;
  tailwindCompletions: boolean;
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

const WORD_CHAR_RE = /[A-Za-z0-9_$]/;

/**
 * Index right after the quote that opens a still-unterminated string literal on `line`,
 * or -1 if the cursor isn't inside one. Walks the line quote-by-quote (respecting `\`
 * escapes) rather than a single regex match ending at the cursor - a naive "nearest
 * preceding quote with none after it" match (the previous approach here) can't tell an
 * actually-open string apart from a *closed* one earlier on the same line with nothing
 * but non-quote characters since (e.g. `import x from "pre/hooks"; useS` - the closing
 * quote after "hooks" has no further quote before the cursor either, so it looked
 * identical to a genuinely open string and silently broke every completion after any
 * string literal already typed on the line).
 */
function openStringStart(line: string): number {
  let quote: string | undefined;
  let start = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = undefined;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      start = i;
    }
  }
  return quote ? start + 1 : -1;
}

/** Import-specifier completions (`./Button.tsx`, `preact/hooks`...) replace the whole
 * typed path, not just a trailing identifier run - `.`/`/` aren't `WORD_CHAR_RE`, so the
 * generic scan below would otherwise stop mid-path and duplicate the already-typed
 * prefix on insert. Being inside a string at all is enough of a signal: nothing else
 * this editor completes from inside one. Scoped to the current line only - JS/TS string
 * literals can't span lines, and scoping avoids treating an already-closed string on an
 * *earlier* line as still open (see `openStringStart`). */
function wordStart(before: string): number {
  const lineStart = before.lastIndexOf("\n") + 1;
  const openQuote = openStringStart(before.slice(lineStart));
  if (openQuote !== -1) return lineStart + openQuote;
  let i = before.length;
  while (i > 0 && WORD_CHAR_RE.test(before[i - 1]!)) i--;
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
 *
 * `pending` closes a second, subtler gap on top of that: a cache miss alone
 * doesn't mean "nothing in flight for this position" - it means "nothing
 * *resolved* yet". While a request for a position is still in flight, every
 * `startQuery` re-check (there are many - each stale response from an
 * *earlier* position also re-triggers one, per the `.then` below) saw the
 * same `undefined` cache entry and fired its own duplicate request for that
 * same position, all racing the worker independently - confirmed via a
 * temporary debug log: typing a single word could fire 30+ duplicate
 * `getCompletions` calls for its final position alone, all resolving in a
 * burst once typing stopped. Harmless once `wordStart` (below) is correct -
 * each duplicate just replays the same result - but pure waste. `pending`
 * ensures at most one request per position is ever in flight.
 *
 * Also gates the query itself: implicit (while-typing) queries only fire
 * while the character right before the cursor is part of an identifier -
 * punctuation like `,` `.` `;` shouldn't pop the tooltip back open with an
 * unfiltered completion list. Ctrl+Space (`explicit`) bypasses this, same as
 * TS's own behavior.
 */
function tsCompletionSource(
  context: { pos: number; before: string; explicit: boolean },
  editor: PrismEditor,
) {
  if (!context.explicit && !WORD_CHAR_RE.test(context.before.slice(-1))) return null;
  const state = instances.get(editor);
  if (!state) return null;
  const { client, cache, pending } = state;
  const cached = cache.get(context.pos);
  if (cached === undefined) {
    if (!pending.has(context.pos)) {
      pending.add(context.pos);
      client.getCompletions(context.pos).then((items) => {
        pending.delete(context.pos);
        cache.set(context.pos, items);
        if (instances.get(editor) === state) editor.extensions.autoComplete?.startQuery();
      });
    }
    return null;
  }
  if (!cached.length) return null;
  return { from: wordStart(context.before), options: cached.map(toCompletion) };
}

/** `registerCompletions` is global (once for every `Editer` on the page, first-mount
 * wins), but `tailwindCompletions` is a per-instance prop - gated here via the same
 * `instances` map the other sources already key off, rather than registering a
 * different source list per instance (which `registerCompletions` doesn't support). */
function scopedTailwindCompletionSource(
  context: Parameters<typeof tailwindCompletionSource>[0],
  editor: PrismEditor,
) {
  if (instances.get(editor)?.tailwindCompletions === false) return null;
  return tailwindCompletionSource(context, editor);
}

let completionsRegistered = false;
function ensureCompletionsRegistered() {
  if (completionsRegistered) return;
  completionsRegistered = true;
  registerCompletions(["tsx"], { sources: [scopedTailwindCompletionSource, tsCompletionSource] });
}

const DIAGNOSTIC_CLASS = "editer-diagnostic";
const ERROR_CLASS = "editer-diagnostic-error";
const WARNING_CLASS = "editer-diagnostic-warning";

function clearDiagnostics(editor: PrismEditor): void {
  for (let i = 1; i < editor.lines.length; i++) {
    editor.lines[i]?.querySelectorAll(`.${DIAGNOSTIC_CLASS}`).forEach((el) => el.remove());
  }
}

/** Sum of the lengths of every line before `line` (1-indexed), plus `column - 1` -
 * i.e. the absolute character offset `{line, column}` (both 1-indexed, as `ts-worker.ts`
 * reports them) points to in the full text. */
function absoluteOffset(lineTexts: string[], line: number, column: number): number {
  let offset = 0;
  for (let i = 0; i < line - 1; i++) offset += (lineTexts[i]?.length ?? 0) + 1;
  return offset + (column - 1);
}

/**
 * Renders precise squiggly underlines (VS Code-style) at each diagnostic's exact
 * column/length instead of tinting the whole line: `.pce-line` is already
 * `position: relative` (layout.css), and since the editor is monospace, a
 * diagnostic's column converts losslessly to a `ch`-unit horizontal offset - no
 * need to touch the tokenizer's own nested `<span>` output at all. Purely visual -
 * the real `<textarea>` `basicEditor` stacks transparently *over* these lines (to
 * capture input) always wins hit-testing, so hover/click on a diagnostic is instead
 * resolved geometrically against `errors` from the host effect (see `offsetFromPoint`
 * and `findDiagnosticAt`), not from a listener on the underline itself.
 */
function applyDiagnostics(editor: PrismEditor, errors: EditerDiagnostic[]): void {
  clearDiagnostics(editor);
  if (!errors.length) return;
  const lineTexts = editor.value.split("\n");
  for (const error of errors) {
    const line = editor.lines[error.line];
    const lineText = lineTexts[error.line - 1];
    if (!line || lineText === undefined) continue;
    const maxLength = Math.max(1, lineText.length - (error.column - 1));
    const span = document.createElement("span");
    span.className = `${DIAGNOSTIC_CLASS} ${error.source === "syntax" ? ERROR_CLASS : WARNING_CLASS}`;
    span.style.left = `calc(var(--padding-left) + ${error.column - 1}ch)`;
    span.style.width = `${Math.min(error.length, maxLength)}ch`;
    line.append(span);
  }
}

/** First diagnostic (if any) whose `{line, column, length}` range contains `pos`. */
function findDiagnosticAt(
  errors: EditerDiagnostic[],
  lineTexts: string[],
  pos: number,
): EditerDiagnostic | undefined {
  return errors.find((error) => {
    const start = absoluteOffset(lineTexts, error.line, error.column);
    return pos >= start && pos <= start + error.length;
  });
}

/** Width of one `ch` (one monospace character cell) in the editor, in CSS pixels -
 * measured with a throwaway probe rather than assumed, since it depends on the
 * theme's font. Used by `offsetFromPoint` to convert a mouse position to a column. */
function measureChWidth(editor: PrismEditor): number {
  const probe = document.createElement("span");
  probe.style.cssText = "position:absolute;visibility:hidden;width:1ch";
  const line = editor.lines[1] ?? editor.wrapper;
  line.append(probe);
  const width = probe.getBoundingClientRect().width;
  probe.remove();
  return width || 8;
}

/**
 * Locates the character an `(x, y)` viewport point falls on, as an absolute offset
 * into `editor.value` - used to resolve hover requests from a mouse event. Deliberately
 * geometric (which `.pce-line` row contains `clientY`, then a `ch`-width division for the
 * column) rather than `caretPositionFromPoint`/`caretRangeFromPoint`: the editor's real
 * `<textarea>` is transparently stacked *over* the highlighted lines to capture input, so
 * those point-based caret APIs resolve to the textarea's own (identical, but differently
 * parented) text instead of the `.pce-line` spans this needs to map back to a line number.
 */
function offsetFromPoint(editor: PrismEditor, clientX: number, clientY: number, chPx: number): number | null {
  let lineNumber = -1;
  for (let i = 1; i < editor.lines.length; i++) {
    const rect = editor.lines[i]?.getBoundingClientRect();
    if (rect && clientY >= rect.top && clientY < rect.bottom) {
      lineNumber = i;
      break;
    }
  }
  if (lineNumber < 1) return null;
  const line = editor.lines[lineNumber]!;
  const paddingLeft = parseFloat(getComputedStyle(line).paddingLeft) || 0;
  const column = Math.max(0, Math.round((clientX - line.getBoundingClientRect().left - paddingLeft) / chPx));
  const lineTexts = editor.value.split("\n");
  const lineText = lineTexts[lineNumber - 1] ?? "";
  return absoluteOffset(lineTexts, lineNumber, Math.min(column, lineText.length) + 1);
}

/** Renders `code` with the same TSX token colors as the editor itself (`.token.*`
 * classes styled by the theme CSS already loaded into the shadow root - no ancestor
 * scoping needed) instead of a flat, single-color string. */
function highlightTsx(code: string): string {
  return highlightText(code, "tsx");
}

/** Quick Info hover: `text` is a code signature (highlighted), `documentation` is prose. */
function renderHoverPanel(panel: HTMLDivElement, text: string, documentation: string): void {
  panel.replaceChildren();
  if (text) {
    const sig = document.createElement("pre");
    sig.className = "editer-hover-sig";
    sig.innerHTML = highlightTsx(text);
    panel.append(sig);
  }
  if (documentation) {
    const doc = document.createElement("div");
    doc.className = "editer-hover-doc";
    doc.textContent = documentation;
    panel.append(doc);
  }
}

/** Diagnostic-message hover: prose only, never run through the TSX tokenizer. */
function renderHoverMessage(panel: HTMLDivElement, message: string): void {
  panel.replaceChildren();
  const doc = document.createElement("div");
  doc.className = "editer-hover-doc";
  doc.textContent = message;
  panel.append(doc);
}

/** Diagnostics are otherwise only visible - a squiggly underline plus a mouse-hover-only
 * message (see `scheduleHover`) - which a screen reader user gets no signal from at all.
 * `aria-live="polite"` on this (visually-hidden, but not `display:none` - screen readers
 * ignore that) region announces a summary on every diagnostics update instead. */
function announceDiagnostics(liveRegion: HTMLDivElement, errors: EditerDiagnostic[]): void {
  if (!errors.length) {
    liveRegion.textContent = "No problems";
    return;
  }
  const errorCount = errors.filter((error) => error.source === "syntax").length;
  const warningCount = errors.length - errorCount;
  const parts: string[] = [];
  if (errorCount) parts.push(`${errorCount} error${errorCount === 1 ? "" : "s"}`);
  if (warningCount) parts.push(`${warningCount} warning${warningCount === 1 ? "" : "s"}`);
  liveRegion.textContent = parts.join(", ");
}

function renderSignatureTooltip(el: HTMLDivElement, help: EditerSignatureHelp): void {
  el.replaceChildren();
  const label = document.createElement("div");
  label.className = "editer-sig-label";
  const active = help.label.slice(help.activeParameterStart, help.activeParameterEnd);
  label.innerHTML =
    highlightTsx(help.label.slice(0, help.activeParameterStart)) +
    (active ? `<span class="editer-sig-active-param">${highlightTsx(active)}</span>` : "") +
    highlightTsx(help.label.slice(help.activeParameterEnd));
  el.append(label);
  if (help.documentation) {
    const doc = document.createElement("div");
    doc.className = "editer-hover-doc";
    doc.textContent = help.documentation;
    el.append(doc);
  }
}

// `border-style` has no "wavy" keyword (that only exists for `text-decoration-style`,
// which needs real glyphs to underline - these are empty overlay spans) - a repeating
// SVG wave, recolored per diagnostic kind via `mask-image` + `background-color`, is the
// standard CSS-only way to draw a VS Code-style squiggle without either.
const SQUIGGLE_MASK =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='4'%3E%3Cpath d='M0 3 Q2 0.5 4 3 T8 3' stroke='white' stroke-width='1.4' fill='none'/%3E%3C/svg%3E\")";
const shadowStyles = `.prism-code-editor{height:100%}
.${DIAGNOSTIC_CLASS}{position:absolute;bottom:0;height:4px;width:0;cursor:pointer;pointer-events:auto;background-color:var(--editer-diagnostic-color);-webkit-mask-image:${SQUIGGLE_MASK};mask-image:${SQUIGGLE_MASK};-webkit-mask-repeat:repeat-x;mask-repeat:repeat-x;-webkit-mask-size:8px 4px;mask-size:8px 4px}
.${ERROR_CLASS}{--editer-diagnostic-color:#f14c4c}
.${WARNING_CLASS}{--editer-diagnostic-color:#cca700}
.editer-hover-panel,.editer-quickfix-menu{position:fixed;z-index:20;max-width:32em;background:var(--pce-widget-bg);color:var(--pce-widget-color);border:1px solid var(--pce-widget-border);border-radius:.3em;box-shadow:0 2px 8px rgba(0,0,0,.35);pointer-events:auto;display:none}
.editer-hover-panel{padding:.5em .7em;font:12px/1.5 ui-monospace,Menlo,Consolas,monospace}
.editer-hover-sig{margin:0;white-space:pre-wrap;font-family:inherit}
.editer-hover-doc{margin-top:.4em;white-space:pre-wrap;font-family:ui-sans-serif,system-ui,sans-serif;opacity:.85}
.editer-sig-tooltip,.editer-hover-tooltip{padding:.4em .6em;font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;background:var(--pce-widget-bg);color:var(--pce-widget-color);border:1px solid var(--pce-widget-border);border-radius:.3em;box-shadow:0 2px 8px rgba(0,0,0,.35)}
.editer-sig-label{white-space:pre-wrap}
.editer-sig-active-param{font-weight:700;text-decoration:underline}
.editer-quickfix-menu{padding:.25em;display:flex;flex-direction:column;gap:2px}
.editer-quickfix-menu button{all:unset;cursor:pointer;padding:.3em .5em;border-radius:.2em;white-space:nowrap;font:12px ui-sans-serif,system-ui,sans-serif}
.editer-quickfix-menu button:hover,.editer-quickfix-menu button:focus-visible{background:var(--pce-widget-bg-hover)}
.editer-sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
${autocompleteCss}
${autocompleteIconsCss}`;

/**
 * TSX/Preact code editor: `prism-code-editor` (mounted in its own Shadow DOM
 * by `basicEditor` - see `plans/code-editer.md` mục 6) for the surface, a
 * `typescript` Language Service running in a Web Worker for diagnostics,
 * completions, mouse hover and `Mod+I` (cursor-based, also the only
 * non-mouse way to reach it) Quick Info, signature help, quick fixes, and
 * `Shift+Alt+F` formatting (`ts-worker.ts`), and `tailwindcss`'s design
 * system for class name suggestions (`tailwind-completions.ts`). The worker
 * is watched for hangs and transparently restarted (`worker-client.ts`) -
 * surfaced via a toast, not silent. A visually-hidden `aria-live` region
 * announces diagnostic counts for screen readers.
 * `basicEditor` itself already wires up bracket/tag matching, indent guides,
 * comment toggling, line move/copy/delete, undo/redo, and Ctrl/Cmd+F find &
 * replace (`searchWidget`) - see its own bundle for that command list. Full
 * panel, no card chrome - sizing/border is the caller's call via `class`/`style`.
 */
export default function Editer({
  value,
  onChange,
  extraFiles,
  theme = "vs-code-dark",
  compilerOptions,
  formatOptions,
  tabSize = 2,
  debounceMs = 300,
  tailwindCompletions = true,
  readOnly = false,
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

    let currentErrors: EditerDiagnostic[] = [];
    const client = new EditerWorkerClient(
      (result) => {
        lastReportedCodeRef.current = result.code;
        currentErrors = result.errors;
        if (editorRef.current) applyDiagnostics(editorRef.current, result.errors);
        announceDiagnostics(liveRegion, result.errors);
        onChangeRef.current(result);
      },
      { compilerOptions, formatOptions },
      debounceMs,
      () =>
        toast.add({
          type: "error",
          title: "Code editor restarted",
          description: "The language service stopped responding and was restarted.",
        }),
    );
    // Every cached position is only valid against the code it was computed
    // from - stale entries would otherwise resurface via `tsCompletionSource`
    // if the cursor ever returns to a position number it previously visited.
    const cache = new Map<number, EditerCompletionItem[]>();
    const pending = new Set<number>();
    // Lazily measured (needs a mounted line to probe) and cached - the font never
    // changes after mount, so one measurement covers every hover/click lookup.
    let chPx: number | undefined;
    const getChPx = () => (chPx ??= measureChWidth(editor));
    const editor = basicEditor(host, {
      language: "tsx",
      value,
      theme,
      tabSize,
      readOnly,
      onUpdate: (code) => {
        cache.clear();
        client.update(code, extraFilesRef.current);
        checkSignatureHelp(editor.getSelection()[0]);
      },
    });
    editorRef.current = editor;
    instances.set(editor, { client, cache, pending, tailwindCompletions });
    ensureCompletionsRegistered();
    editor.addExtensions(cursorPosition(), autoComplete({ filter: fuzzyFilter }));

    /**
     * Applies a quick-fix/format response's edits through `prism-code-editor/utils`'
     * `insertText` - the same primitive the library's own completion-insert path uses -
     * instead of `editor.setOptions({ value })`. Not just a style choice: `basicEditor`'s
     * `editHistory` extension treats *any* `setOptions({ value })` call as "a whole new
     * document" (its own `update()` hook checks `editor.value != textarea.value`) and
     * collapses the entire undo stack down to one entry - so a `setOptions`-based apply
     * doesn't add one undo step, it silently discards every earlier one. `insertText`
     * goes through the real `beforeinput`/`input` pipeline, which both `editHistory` and
     * this component's own `onUpdate` see as a normal edit.
     */
    function commitEdits(edits: EditerTextEdit[]): void {
      if (!edits.length) return;
      cache.clear();
      // Descending `start` - so a not-yet-applied edit's position is never shifted by
      // one already applied later in the loop (i.e. earlier in the document).
      for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
        insertText(editor, edit.newText, edit.start, edit.start + edit.length);
      }
      client.update(editor.value, extraFilesRef.current);
    }

    let quickFixMenu: HTMLDivElement | undefined;
    function hideQuickFixMenu(): void {
      quickFixMenu?.remove();
      quickFixMenu = undefined;
      document.removeEventListener("click", hideQuickFixMenu);
    }
    function showQuickFixMenu(fixes: EditerCodeFix[], x: number, y: number): void {
      hideQuickFixMenu();
      // Both are positioned off the same click point and neither knows about the
      // other - without this a lingering hover message (shown by hovering the
      // diagnostic just before clicking it) stays stacked underneath the menu.
      hideHover();
      const menu = document.createElement("div");
      menu.className = "editer-quickfix-menu";
      menu.style.left = `${x}px`;
      menu.style.top = `${y}px`;
      menu.style.display = "flex";
      for (const fix of fixes) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = fix.description;
        button.addEventListener("click", () => {
          commitEdits(fix.edits);
          hideQuickFixMenu();
        });
        menu.append(button);
      }
      editor.container.append(menu);
      quickFixMenu = menu;
      document.addEventListener("click", hideQuickFixMenu, { once: true });
    }
    async function handleDiagnosticClick(pos: number, clientX: number, clientY: number): Promise<void> {
      // `insertText` (see `commitEdits`) already no-ops under `readOnly` on its own, so
      // skipping here isn't needed for correctness - it's to avoid a pointless worker
      // round trip and an actionable-looking menu that would do nothing if clicked.
      if (readOnly) return;
      const fixes = await client.getCodeFixes(pos);
      if (!fixes.length) {
        toast.add({ type: "default", title: "No quick fix available." });
        return;
      }
      showQuickFixMenu(fixes, clientX, clientY);
    }
    /** Diagnostics are purely visual (see `applyDiagnostics`) - the real `<textarea>`
     * sits transparently on top of them and always wins hit-testing, so a click on one
     * has to be resolved the same geometric way as hover (`offsetFromPoint`), not from a
     * listener on the underline `<span>` itself (which would never receive the event). */
    const onClick = (event: MouseEvent) => {
      if (!currentErrors.length) return;
      const pos = offsetFromPoint(editor, event.clientX, event.clientY, getChPx());
      if (pos === null) return;
      const diagnostic = findDiagnosticAt(currentErrors, editor.value.split("\n"), pos);
      if (!diagnostic) return;
      void handleDiagnosticClick(pos, event.clientX, event.clientY);
    };
    host.addEventListener("click", onClick);

    // Not `addEditorHotkey(editor, "shift+alt+f", ...)`: that keys off `event.key`,
    // which is layout-dependent - on a real Mac keyboard, Option (Alt) turns letter
    // keys into special characters (`Option+F` types "ƒ", `Shift+Option+F` a different
    // accented letter, never "f"), so `event.key` is never "f" and the hotkey silently
    // never fires. The library special-cases this for `Shift+Meta+<letter>` but not for
    // `Alt+<letter>`. `event.code` is the physical key position ("KeyF") regardless of
    // what character modifiers produce, so it works the same on every keyboard layout.
    const onFormatKeydown = (event: KeyboardEvent) => {
      if (readOnly) return;
      if (event.code === "KeyF" && event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        client.getFormatting().then(commitEdits);
      }
    };
    editor.textarea.addEventListener("keydown", onFormatKeydown);

    // Every other way to see a symbol's type or a diagnostic's message in this editor
    // (`scheduleHover` below, and the click handler for quick fixes) is mouse-only - a
    // keyboard-only or touch/mobile user has no way to reach either. `Mod+I` (own choice,
    // not tied to any single-key VS Code default - "Show Hover" there is a two-key
    // `Mod+K Mod+I` chord) shows Quick Info/the diagnostic message for the symbol at the
    // *cursor* instead of the mouse position. `event.code`-based for the same
    // layout-independence reason as `onFormatKeydown`, though `Mod` alone (unlike
    // `Alt+<letter>`) doesn't actually hit the Option-key character-substitution problem -
    // kept consistent with the other custom binding regardless.
    let keyboardHoverToken = 0;
    const onKeyboardHoverKeydown = (event: KeyboardEvent) => {
      if (event.code === "Escape") return hideKeyboardHover?.();
      if (event.code !== "KeyI" || event.altKey || event.shiftKey || !(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      const pos = editor.getSelection()[0];
      const diagnostic = findDiagnosticAt(currentErrors, editor.value.split("\n"), pos);
      if (diagnostic) {
        renderHoverMessage(keyboardHoverElement, diagnostic.message);
        return showKeyboardHover?.();
      }
      const token = ++keyboardHoverToken;
      client.getHover(pos).then((info) => {
        if (token !== keyboardHoverToken) return;
        if (!info) return hideKeyboardHover?.();
        renderHoverPanel(keyboardHoverElement, info.text, info.documentation);
        showKeyboardHover?.();
      });
    };
    editor.textarea.addEventListener("keydown", onKeyboardHoverKeydown);
    // Cursor moved away (typing counts too) - the popover's content is no longer about
    // whatever's now at the cursor, so it shouldn't linger.
    editor.on("selectionChange", () => hideKeyboardHover?.());

    let showKeyboardHover: (() => void) | undefined;
    let hideKeyboardHover: (() => void) | undefined;

    let sigSeq = 0;
    let showSig: (() => void) | undefined;
    let hideSig: (() => void) | undefined;
    function checkSignatureHelp(pos: number): void {
      const seq = ++sigSeq;
      client.getSignatureHelp(pos).then((help) => {
        if (seq !== sigSeq || !editorRef.current) return;
        if (help) {
          renderSignatureTooltip(sigElement, help);
          showSig?.();
        } else {
          hideSig?.();
        }
      });
    }
    editor.on("selectionChange", (selection) => checkSignatureHelp(selection[0]));

    let hoverTimer: ReturnType<typeof setTimeout> | undefined;
    let hoverToken = 0;
    function hideHover(): void {
      clearTimeout(hoverTimer);
      hoverPanel.style.display = "none";
    }
    function positionHoverPanel(clientX: number, clientY: number): void {
      hoverPanel.style.left = `${clientX + 12}px`;
      hoverPanel.style.top = `${clientY + 20}px`;
      hoverPanel.style.display = "block";
    }
    function scheduleHover(clientX: number, clientY: number): void {
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => {
        const pos = offsetFromPoint(editor, clientX, clientY, getChPx());
        if (pos === null) return hideHover();
        // A diagnostic's message takes priority over quick info when both are under
        // the cursor - it's more actionable, and doesn't need a worker round trip.
        const diagnostic = findDiagnosticAt(currentErrors, editor.value.split("\n"), pos);
        if (diagnostic) {
          renderHoverMessage(hoverPanel, diagnostic.message);
          return positionHoverPanel(clientX, clientY);
        }
        const token = ++hoverToken;
        client.getHover(pos).then((info) => {
          if (token !== hoverToken) return;
          if (!info) return hideHover();
          renderHoverPanel(hoverPanel, info.text, info.documentation);
          positionHoverPanel(clientX, clientY);
        });
      }, 200);
    }
    const onMouseMove = (event: MouseEvent) => scheduleHover(event.clientX, event.clientY);
    host.addEventListener("mousemove", onMouseMove);
    host.addEventListener("mouseleave", hideHover);
    editor.container.addEventListener("scroll", hideHover);

    const shadowRoot = host.shadowRoot;
    let sigElement!: HTMLDivElement;
    let hoverPanel!: HTMLDivElement;
    let keyboardHoverElement!: HTMLDivElement;
    let liveRegion!: HTMLDivElement;
    if (shadowRoot) {
      // `.prism-code-editor` (layout.css, loaded by `basicEditor` itself) has
      // no explicit height - it sizes to its content (line count) by
      // default. Without this override the "full panel" host div (mục 6)
      // stays empty space below a content-height editor, and - non-obviously
      // - the autocomplete tooltip's max-height (computed off the editor's
      // own `clientHeight`) then gets squeezed to a couple px too, since
      // there's barely any container height to work with.
      const styleEl = document.createElement("style");
      styleEl.textContent = shadowStyles;
      shadowRoot.append(styleEl);
    }
    // The theme (loaded async by `basicEditor` itself) defines `--pce-widget-*` as
    // custom properties scoped to `.prism-code-editor` (`editor.container`) - a sibling
    // of it in the shadow root wouldn't inherit them and would render unstyled/
    // transparent, so this mounts *inside* `editor.container` instead. It uses
    // `position: fixed`, which escapes `editor.container`'s `overflow: auto` and takes
    // it out of its `display: grid` layout, so nesting it here is otherwise inert - and
    // `editor.remove()` then cleans it up for free. (`sigElement` doesn't need the same
    // treatment - `addTooltip` below already parents it under `editor`'s own overlays.)
    hoverPanel = document.createElement("div");
    hoverPanel.className = "editer-hover-panel";
    editor.container.append(hoverPanel);

    sigElement = document.createElement("div");
    sigElement.className = "editer-sig-tooltip";
    [showSig, hideSig] = addTooltip(editor, sigElement);

    keyboardHoverElement = document.createElement("div");
    keyboardHoverElement.className = "editer-hover-tooltip";
    [showKeyboardHover, hideKeyboardHover] = addTooltip(editor, keyboardHoverElement);

    liveRegion = document.createElement("div");
    liveRegion.className = "editer-sr-only";
    liveRegion.setAttribute("aria-live", "polite");
    liveRegion.setAttribute("role", "status");
    editor.container.append(liveRegion);

    client.update(value, extraFilesRef.current);

    return () => {
      editorRef.current = undefined;
      clearTimeout(hoverTimer);
      hideQuickFixMenu();
      host.removeEventListener("mousemove", onMouseMove);
      host.removeEventListener("mouseleave", hideHover);
      host.removeEventListener("click", onClick);
      editor.textarea.removeEventListener("keydown", onFormatKeydown);
      editor.textarea.removeEventListener("keydown", onKeyboardHoverKeydown);
      editor.remove();
      client.dispose();
    };
    // Mount once; `value`/`extraFiles` prop changes are synced by the effects
    // below instead of remounting the editor. `theme`/`compilerOptions`/
    // `formatOptions`/`tabSize`/`debounceMs`/`tailwindCompletions` are all
    // captured here at their current value and stay fixed for the editor's
    // lifetime - like `theme`, changing any of them requires remounting
    // (changing `key` on the `Editer` element) rather than updating a prop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || value === lastReportedCodeRef.current) return;
    if (editor.value !== value) {
      editor.setOptions({ value });
      // Mark it reported immediately, not just once the worker's debounced
      // echo eventually lands - otherwise a THIRD value change back to
      // whatever `lastReportedCodeRef` still held from before this one
      // (e.g. a consumer flipping between two fixed `value`s, like
      // `PageComponents.tsx`'s file tabs) would look like "parent echoed
      // our own change" and get silently skipped, leaving the editor
      // showing the wrong file's content.
      lastReportedCodeRef.current = value;
    }
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
