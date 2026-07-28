export type InlineFormat = "bold" | "italic" | "underline";

/** The 4 alignments this field's menu offers - Lexical's own
 * `ElementFormatType` also has `'start' | 'end' | ''`, which this field
 * never sets and folds back to `"left"` for display (see readAlign in
 * `useRichTextEditor.ts`). */
export type TextAlign = "left" | "center" | "right" | "justify";

export interface ActiveFormat {
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

export const NO_FORMAT: ActiveFormat = { bold: false, italic: false, underline: false };

/** Everything a toolbar button's `isActive`/`isDisabled` predicate can read -
 * add a field here (and populate it from `useRichTextEditor`) when a new
 * button needs to react to something beyond these. */
export interface ToolbarState {
  format: ActiveFormat;
  align: TextAlign;
  canUndo: boolean;
  canRedo: boolean;
}

/** Shared by `useRichTextEditor.ts` (reading `ElementNode.getFormatType()`)
 * and `html.ts` (reading a parsed `text-align` style value) - anything else
 * (Lexical's `'start'`/`'end'`/`''`, or garbage from hand-written HTML)
 * folds back to the default. */
export function normalizeTextAlign(value: string | null | undefined): TextAlign {
  return value === "center" || value === "right" || value === "justify" ? value : "left";
}
