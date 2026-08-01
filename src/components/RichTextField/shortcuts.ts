import type { Command } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";

export const RICH_TEXT_SHORTCUT_EVENT = "dry-richtext-shortcut";

export type RichTextShortcut = "color" | "link" | "image" | "component" | "fullscreen";

export function displayShortcut(shortcut: string): string {
  const platform = typeof navigator === "undefined" ? "" : `${navigator.platform} ${navigator.userAgent}`;
  return shortcut.replace("Ctrl/Cmd", /Mac|iPhone|iPad|iPod/.test(platform) ? "Cmd" : "Ctrl");
}

/** Opens an existing toolbar UI from the editor keymap without duplicating
 * that UI's dialog/popover state inside ProseMirror. */
export function openRichTextShortcut(name: RichTextShortcut): Command {
  return (_state, _dispatch, view) => {
    if (!view) return false;
    view.dom.ownerDocument.dispatchEvent(
      new CustomEvent(RICH_TEXT_SHORTCUT_EVENT, { detail: { name, view } }),
    );
    return true;
  };
}
