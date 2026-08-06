# RichText "Rewrite selection" joins the shared Magic Chat conversation

## Plan

User request (Vietnamese, paraphrased): the RichText toolbar's "Rewrite
selection with AI" should stop being an isolated one-shot request. It should:
1. Share the SAME conversation/history as the Magic Chat bubble (so the model
   knows what the whole entry is about, not just the isolated passage).
2. Never show its own AI Key/Model picker - it silently uses whatever
   key/model Magic Chat itself is using (which Magic Chat already remembers
   in `localStorage`, `AiKeyPicker.tsx`'s `drycms.aiKeySelection`).

Confirmed design decisions (asked via AskUserQuestion):
- A rewrite request shows up as a normal turn (user + assistant bubble) in
  the Magic Chat panel - one history mechanism, no hidden side-channel.
- `RichTextField` also renders places with NO entry/Magic Chat (e.g.
  `FieldDialog.tsx`'s content-type schema default-value editor) - the
  "Rewrite selection" toolbar button hides entirely there, same as
  `MagicChat` itself doesn't render outside `ContentEntryEditor`.

### Architecture
- New turn kind `kind: rewrite` added to the Magic Write YAML dialect
  (`ai-magic-write-protocol.ts`) alongside `chat`/`fields`/`question`/`fetch`.
  Only valid as a reply to an explicit per-turn "rewrite this exact passage"
  request (never spontaneously during ordinary chat).
- `ContentEntryEditor.tsx` lifts `useAiKeySelection` out of `MagicChat.tsx`
  (so it's available immediately, not just after the bubble is first opened)
  and provides a new `RichTextRewriteContext`
  (`src/components/RichTextField/ai-rewrite-context.ts`) wrapping both the
  field tree and `<MagicChat>`. The context value's `requestRewrite` is
  backed by an imperative function `MagicChat` publishes into a ref every
  render (`rewriteFnRef`), since the actual turn-running logic
  (`historyRef`/`runAssistant`/session persistence) all lives inside
  `MagicChat`.
- `AiRewriteButton` (`ai-rewrite-button.tsx`) drops `AiKeyPicker`/
  `useAiKeySelection` and its own `/api/ai/rewrite-selection` fetch entirely;
  it reads `RichTextRewriteContext` and hides (`return <></>`) when absent.
- Old standalone endpoint (`ai.ts`'s `handleRewriteSelection` and everything
  under it) removed - dead code once nothing calls it.

## Status

Done. Files touched:
- [x] `ai-magic-write-protocol.ts` - `kind: rewrite` turn + validator
- [x] `ai-magic-write-prompt.ts` - system prompt doc + `buildRewriteTurnMessage`
- [x] `ai-magic-write.ts` (server route) - `rewritePassage`/`rewriteInline` request
      fields, dispatch, server-side sanitize
- [x] `ai.ts` (server route) - removed old `rewrite-selection` endpoint + its
      now-dead helpers entirely
- [x] `ai-rewrite-context.ts` (new) - `RichTextRewriteContext`/`RichTextRewriteApi`
- [x] `MagicChat.tsx` - `aiKey`/`rewriteFnRef` props (aiKey lifted out of this
      file), `requestRewrite`, per-kind turn handling incl. `rewrite`
- [x] `ContentEntryEditor.tsx` - lifted `useAiKeySelection`, provides
      `RichTextRewriteContext` around the field tree + `<MagicChat>`
- [x] `ai-rewrite-button.tsx` - consumes context instead of its own
      AiKeyPicker/fetch; hides entirely when no context (`FieldDialog.tsx`)
- [x] Added unit tests: `kind: rewrite` parsing (`ai-magic-write-protocol.test.ts`),
      `buildRewriteTurnMessage` + prompt doc (`ai-magic-write-prompt.test.ts`)
- [x] `bun run typecheck` clean, `bun run test` - 933/933 pass
- [x] Server smoke-tested via curl against a freshly-restarted dev server
      (authenticated as super admin): old `/api/ai/rewrite-selection` route is
      gone (falls through to the generic chat 502, not a dedicated handler),
      `/api/ai/magic-write` accepts `rewritePassage`/`rewriteInline` and
      validates them without crashing.

**Not verified**: the actual browser UI flow (select text in a RichText
field → "Rewrite selection" → shared Magic Chat bubble showing the turn →
Replace) - no browser/Playwright tool was available in this session. Worth
a manual click-through before considering this fully done.

## Speed

Single pass, done. One false alarm mid-verification: the ALREADY-RUNNING
dev server (started by an earlier/different session) kept serving stale
route logic for `ai.ts` despite its own Vite log claiming a reload -
restarting it (`bun run dev`) fixed it. Not a bug in this change.
