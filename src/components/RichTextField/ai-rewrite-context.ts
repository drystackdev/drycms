import { createContext } from "preact";

export type RichTextRewriteFn = (
  passage: string,
  instruction: string,
  inline: boolean,
  onDelta: (delta: string) => void,
  signal: AbortSignal,
) => Promise<string>;

export interface RichTextRewriteApi {
  /** Mirrors `AiKeySelection.ready` from whichever AI Key/model Magic Chat
   * itself is currently using - `AiRewriteButton` never shows its own
   * picker, it reuses this (`status/richtext-rewrite-shared-chat.md`). */
  ready: boolean;
  requestRewrite: RichTextRewriteFn;
}

/**
 * Bridges `AiRewriteButton` (deep inside a `RichTextField`, anywhere in an
 * entry form) to the single Magic Chat conversation for that entry -
 * `ContentEntryEditor.tsx` provides it, `MagicChat.tsx` implements it. A
 * "rewrite this passage" run is really just one more turn of that SAME chat
 * (shared history, shared AI key/model), not an isolated request -
 * `status/richtext-rewrite-shared-chat.md`.
 *
 * `null` wherever no entry/Magic Chat exists (e.g. the content-type editor's
 * default-value `RichTextField` in `FieldDialog.tsx`) - `AiRewriteButton`
 * hides itself entirely in that case, the same way `MagicChat` itself never
 * renders there.
 */
export const RichTextRewriteContext = createContext<RichTextRewriteApi | null>(null);
