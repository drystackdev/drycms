import fuzzysort from "fuzzysort";
import { useEffect, useRef, useState } from "preact/hooks";
import type { JSX } from "preact";
import { closeHistory } from "prosemirror-history";
import { toggleMark } from "prosemirror-commands";
import type { Command } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import type { FileManagerSource } from "../../storage/entry-types.js";
import { useOverlayScrollbars } from "../../hooks/overlayscrollbars.js";
import {
  AlignCenterIcon,
  AlignJustifyIcon,
  AlignLeftIcon,
  AlignRightIcon,
  BaselineIcon,
  BoldIcon,
  BulletListIcon,
  ClearFormatIcon,
  ComponentIcon,
  GridIcon,
  ItalicIcon,
  LinkIcon,
  MediaIcon,
  OrderedListIcon,
  ParagraphIcon,
  TableIcon,
  UnderlineIcon,
} from "../icons/index.js";
import { runCommand, removeAllMarks, setBlockTypeCommand, setTextAlign } from "./commands.js";
import { insertGrid } from "./grid.js";
import { toggleList } from "./lists.js";
import { schema } from "./schema.js";
import { insertTable } from "./table.js";
import { displayShortcut, openRichTextShortcut } from "./shortcuts.js";
import type { ToolbarState } from "./types.js";

interface Props {
  viewRef: { current: EditorView | null };
  ready: boolean;
  disabled?: boolean;
  state: ToolbarState;
  source?: FileManagerSource;
}

interface SlashMatch {
  from: number;
  to: number;
  query: string;
  key: string;
  replaceToken: boolean;
}

interface SlashAction {
  key: string;
  group: "inline" | "block" | "insert" | "history";
  label: string;
  search: string;
  Icon: (props: { class?: string }) => JSX.Element;
  run: Command;
  shortcut?: string;
  available?: (state: ToolbarState, source?: FileManagerSource) => boolean;
}

interface SlashState extends SlashMatch {
  actions: SlashAction[];
  selectedIndex: number;
  top: number;
  left: number;
}

function slashAtCursor(view: EditorView): SlashMatch | null {
  const selection = view.state.selection;
  if (!selection.empty || !selection.$from.parent.isTextblock) return null;
  const text = selection.$from.parent.textBetween(0, selection.$from.parentOffset, "\0", "\0");
  const lastSpace = Math.max(text.lastIndexOf(" "), text.lastIndexOf("\t"), text.lastIndexOf("\n"));
  const token = text.slice(lastSpace + 1);
  if (!/^\/[^\s/]*$/.test(token)) return null;
  return {
    from: selection.from - token.length,
    to: selection.from,
    query: token.slice(1),
    replaceToken: true,
    key: `${selection.from - token.length}:${selection.from}:${token}`,
  };
}

function slashActions(): SlashAction[] {
  return [
    { key: "bold", group: "inline", label: "Bold", search: "bold strong", shortcut: "Ctrl/Cmd+B", Icon: BoldIcon, run: toggleMark(schema.marks.bold!) },
    { key: "italic", group: "inline", label: "Italic", search: "italic emphasis", shortcut: "Ctrl/Cmd+I", Icon: ItalicIcon, run: toggleMark(schema.marks.italic!) },
    { key: "underline", group: "inline", label: "Underline", search: "underline", shortcut: "Ctrl/Cmd+U", Icon: UnderlineIcon, run: toggleMark(schema.marks.underline!) },
    { key: "color", group: "inline", label: "Text color", search: "color text color", shortcut: "Ctrl/Cmd+Alt+C", Icon: BaselineIcon, run: openRichTextShortcut("color"), available: (state) => state.hasSelection },
    { key: "link", group: "inline", label: "Link", search: "link hyperlink", shortcut: "Ctrl/Cmd+K", Icon: LinkIcon, run: openRichTextShortcut("link"), available: (state) => state.hasSelection && !state.link.disabled },
    { key: "clear-format", group: "inline", label: "Clear format", search: "clear remove format", shortcut: "Ctrl+Space", Icon: ClearFormatIcon, run: removeAllMarks(), available: (state) => state.hasSelection && state.clearable },
    { key: "paragraph", group: "block", label: "Paragraph", search: "paragraph normal", shortcut: "Ctrl/Cmd+Shift+N", Icon: ParagraphIcon, run: setBlockTypeCommand("paragraph") },
    { key: "align-left", group: "block", label: "Align left", search: "align left", shortcut: "Ctrl/Cmd+L", Icon: AlignLeftIcon, run: setTextAlign("left") },
    { key: "align-center", group: "block", label: "Align center", search: "align center", shortcut: "Ctrl/Cmd+E", Icon: AlignCenterIcon, run: setTextAlign("center") },
    { key: "align-right", group: "block", label: "Align right", search: "align right", shortcut: "Ctrl/Cmd+R", Icon: AlignRightIcon, run: setTextAlign("right") },
    { key: "align-justify", group: "block", label: "Justify", search: "justify align", shortcut: "Ctrl/Cmd+J", Icon: AlignJustifyIcon, run: setTextAlign("justify") },
    { key: "bullet-list", group: "block", label: "Bullet list", search: "bullet unordered list", shortcut: "Ctrl/Cmd+Shift+L", Icon: BulletListIcon, run: toggleList(schema.nodes.bullet_list!) },
    { key: "ordered-list", group: "block", label: "Numbered list", search: "numbered ordered list", shortcut: "Ctrl/Cmd+.", Icon: OrderedListIcon, run: toggleList(schema.nodes.ordered_list!) },
    { key: "grid", group: "block", label: "Insert grid", search: "grid layout", shortcut: "Ctrl/Cmd+Alt+G", Icon: GridIcon, run: insertGrid() },
    { key: "table", group: "block", label: "Insert table", search: "table layout", shortcut: "Ctrl/Cmd+Alt+T", Icon: TableIcon, run: insertTable() },
    { key: "image", group: "insert", label: "Insert image", search: "image media picture", shortcut: "Ctrl/Cmd+Alt+M", Icon: MediaIcon, run: openRichTextShortcut("image"), available: (_state, source) => !!source },
    { key: "component", group: "insert", label: "Insert component", search: "component dry component", Icon: ComponentIcon, run: openRichTextShortcut("component") },
  ];
}

function filteredActions(actions: SlashAction[], query: string): SlashAction[] {
  if (!query) return actions;
  return fuzzysort.go(query, actions, { keys: ["label", "search"], threshold: -10000 }).map((result) => result.obj);
}

function removeSlashToken(view: EditorView, match: SlashMatch): boolean {
  if (!match.replaceToken) return true;
  const tr = view.state.tr.delete(match.from, match.to).setMeta("addToHistory", false);
  view.dispatch(closeHistory(tr));
  return true;
}

export default function DryRichTextSlash({ viewRef, ready, disabled = false, state, source }: Props) {
  const [slash, setSlash] = useState<SlashState | null>(null);
  const slashRef = useRef<SlashState | null>(null);
  const dismissedRef = useRef(false);
  const { ref: listRef } = useOverlayScrollbars<HTMLDivElement>([!!slash]);
  const selectedActionRef = useRef<HTMLButtonElement | null>(null);
  const actions = useRef(slashActions()).current;
  /** Read through a ref rather than closed over, so the listener effect below
   * can keep `state` OUT of its dependency list: a new `ToolbarState` object
   * used to tear down and re-attach all three listeners (and re-run
   * `refresh`, which forces a layout through `coordsAtPos`) on essentially
   * every transaction. The listeners only ever read the latest state anyway. */
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    selectedActionRef.current?.scrollIntoView({ block: "nearest" });
  }, [slash?.selectedIndex]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !ready || disabled) return;

    const refresh = () => {
      const current = viewRef.current;
      if (!current || dismissedRef.current) return;
      const match = slashAtCursor(current);
      if (!match) {
        slashRef.current = null;
        setSlash(null);
        return;
      }
      const candidates = filteredActions(
        actions.filter((action) => !action.available || action.available(stateRef.current, source)),
        match.query,
      );
      if (!candidates.length) {
        slashRef.current = null;
        setSlash(null);
        return;
      }
      const coords = current.coordsAtPos(current.state.selection.from);
      const next: SlashState = {
        ...match,
        actions: candidates,
        selectedIndex: Math.min(slashRef.current?.selectedIndex ?? 0, candidates.length - 1),
        top: coords.bottom + 4,
        left: coords.left,
      };
      slashRef.current = next;
      setSlash(next);
    };

    const close = (dismiss = false) => {
      dismissedRef.current = dismiss;
      slashRef.current = null;
      setSlash(null);
    };

    // Everything below skips while an IME composition is open. There's no "/"
    // token to find mid-composition (the composing text isn't committed yet),
    // and `refresh`'s `coordsAtPos` forces a layout on a DOM node the IME is
    // actively rewriting - so this is both wasted work and a way to disturb
    // the composition. Vietnamese Telex composes a whole syllable, so this is
    // every keystroke of every accented word, not a rare edge case.
    const onInput = (event: Event) => {
      if ((event as InputEvent).isComposing) return;
      dismissedRef.current = false;
      queueMicrotask(refresh);
    };
    const onSelectionChange = () => {
      if (view.composing) return;
      if (document.activeElement === view.dom || view.dom.contains(document.activeElement)) queueMicrotask(refresh);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      // A live composition owns these keys: Vietnamese Telex commits a
      // syllable with Space, every IME confirms with Enter. Swallowing them
      // here - a capture-phase listener, so ahead of ProseMirror itself -
      // strands the composition mid-syllable and leaves the field looking
      // frozen. `keyCode === 229` is the same "this key belongs to the IME"
      // signal, spelled the way browsers report it when `isComposing` isn't
      // set yet (the keydown that STARTS a composition).
      if (event.isComposing || event.keyCode === 229) return;
      const current = slashRef.current;
      if (!current && (event.metaKey || event.ctrlKey) && event.key === "/") {
        event.preventDefault();
        event.stopPropagation();
        const selection = view.state.selection;
        const coords = view.coordsAtPos(selection.from);
        const candidates = filteredActions(
          actions.filter((action) => !action.available || action.available(stateRef.current, source)),
          "",
        );
        const opened: SlashState = {
          from: selection.from,
          to: selection.from,
          query: "",
          replaceToken: false,
          key: `shortcut:${selection.from}`,
          actions: candidates,
          selectedIndex: 0,
          top: coords.bottom + 4,
          left: coords.left,
        };
        slashRef.current = opened;
        setSlash(opened);
        return;
      }
      if (!current) return;
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        event.stopPropagation();
        const delta = event.key === "ArrowDown" ? 1 : -1;
        const selectedIndex = (current.selectedIndex + delta + current.actions.length) % current.actions.length;
        const next = { ...current, selectedIndex };
        slashRef.current = next;
        setSlash(next);
      } else if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        event.stopPropagation();
        const action = current.actions[current.selectedIndex];
        if (!action) return;
        removeSlashToken(view, current);
        runCommand(view, action.run);
        close();
      } else if (event.key === "Escape" || event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === " ") {
        close(true);
      } else if (event.key === "Backspace" || event.key === "Delete") {
        queueMicrotask(refresh);
      }
    };

    view.dom.addEventListener("input", onInput);
    view.dom.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("selectionchange", onSelectionChange);
    queueMicrotask(refresh);
    return () => {
      view.dom.removeEventListener("input", onInput);
      view.dom.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
    // `state` deliberately absent - read through `stateRef` above so a new
    // toolbar state doesn't re-attach these listeners on every transaction.
  }, [viewRef, ready, disabled, actions, source]);

  if (!slash) return null;
  return (
    <div
      class="dry-component-mention-popup dry-richtext-slash-popup"
      role="listbox"
      aria-label="Formatting commands"
      style={{ position: "fixed", top: `${slash.top}px`, left: `${slash.left}px` }}
    >
      <div class="dry-component-mention-list" ref={listRef}>
        <div class="dry-component-mention-items">
          {slash.actions.map((action, index) => (
            <button
              type="button"
              role="option"
              aria-selected={index === slash.selectedIndex}
              class={index === slash.selectedIndex ? "selected" : undefined}
              ref={index === slash.selectedIndex ? selectedActionRef : undefined}
              key={action.key}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                const view = viewRef.current;
                if (!view) return;
                removeSlashToken(view, slash);
                runCommand(view, action.run);
                slashRef.current = null;
                setSlash(null);
              }}
            >
              <action.Icon />
              <span>{action.label}</span>
              {action.shortcut && <code>{displayShortcut(action.shortcut)}</code>}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
