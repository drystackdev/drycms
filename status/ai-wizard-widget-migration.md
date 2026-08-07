# AI Schema Wizard: grid/tab panel → floating bubble+panel widget

## Plan

User request (Vietnamese, paraphrased): the Content Types page's "Ask AI"
(the schema wizard, `AiSchemaWizardPanel.tsx`) should switch to the same
floating bubble + non-modal popover-panel presentation `MagicChat.tsx` uses,
instead of its current grid-column (`>= 64rem`) / tab-switch (`< 64rem`)
layout.

Scope: presentation only. The wizard keeps its own choice-driven interview
model, its own JSON protocol (`ai-wizard-protocol.ts`), and its own
history/state - it does NOT merge into Magic's conversation (different
domain: proposing new content-type schemas, not writing into an entry).
Only the outer shell (bubble button, `popover="manual"` floating panel,
positioning, mobile full-screen-sheet breakpoint) is ported.

Precedent followed: Magic itself removed its topbar buttons once its own
bubble existed ("a second entry point doing the same job is just
duplication" - `status/magic-chat.md`'s Phase A). Applied here too: the old
header "Ask AI" button and the `< 64rem` tablist are both removed, replaced
by the one floating bubble (visible at every width).

## Status

Done.

- `AiSchemaWizardPanel.tsx`: `open` is now internal state (was a prop) -
  `popover="manual"` + `showPopover()` on mount, bubble/panel mutually
  exclusive render (same pattern as `MagicChat.tsx`), new `<header>` with a
  "-" minimize button, busy-spinner badge on the bubble while `stage ===
"loading"` (mirrors `.magic-chat-bubble.busy`). Internal stage machine
  (start/loading/error/turn) and `applyProposal`'s "reset to start, don't
  close" behavior are unchanged.
- `BuilderContentType.tsx`: removed `aiWizardOpen` state, the header
  button, the `.builder-content-type-tabs` tablist, and the `.ai-open` grid
  modifier - `<AiSchemaWizardPanel allDefinitions={...} />` now renders
  unconditionally as a self-contained floating widget, same as `<MagicChat>`
  in `ContentEntryEditor.tsx`. Dead imports (`SparkleIcon`, unused `XIcon`
  in the panel file) removed.
- CSS: new `.ai-wizard-widget`/`button.ai-wizard-bubble`/
  `.ai-wizard-bubble-spinner` (mirror `.magic-chat-widget`/
  `.magic-chat-bubble`/`.magic-chat-bubble-spinner`). `.ai-wizard-panel`
  rebuilt for floating (was grid-cell `display:none`/`.open`) - kept its
  distinct "sized by content, capped height" trait rather than Magic's
  fixed height (the wizard has no long scrolling transcript to justify one).
  Added the `< 48rem` full-screen-sheet breakpoint, mirroring
  `.magic-chat-panel`'s own. Removed now-dead `.builder-content-type-tabs`/
  `.builder-ai-header-button`/`.builder-content-type-layout`'s `.ai-open`
  rules.
- Verified in a real browser (Playwright, not just typecheck/build): old
  tablist/header button gone; bubble renders bottom-right; opening the panel
  leaves the collections list visible/interactive underneath; AI Key/Model
  correctly restored from the same `localStorage` selection Magic uses;
  minimize returns to the bubble; `< 48rem` viewport renders a true
  full-screen sheet. One early screenshot showed the panel appearing to
  translucently overlap a header button - confirmed via a settled (post-
  animation) screenshot that this was just the 120ms `dry-dialog-in`
  transition being mid-flight, not a real rendering bug: the settled panel
  is fully opaque and simply covers whatever's beneath it, matching Magic's
  own non-modal-but-floating trade-off.
- Typecheck clean, 933 tests pass, client+SSR build clean.

## Speed

Single pass, no blockers.
