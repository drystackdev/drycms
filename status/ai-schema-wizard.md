# AI Schema Builder wizard (Content Types)

Supersedes `status/builder-ai-chat.md` / `status/ai-chat-stream.md`'s free-form
chat direction — that UI was fully removed at some point (confirmed via git
history: no `*Chat*.tsx` component ever existed as a separate file, and
`BuilderContentType.tsx` has zero AI references today) even though its
backend survived. This is a new, independent design: a single-button,
choice-driven schema wizard, not a chat box.

## What already exists (reuse, do not rebuild)

- `dry.config.ts`'s `ai` option / `resolveAiOption` (`src/server/options.ts`):
  `local` (`codex`/`claude` CLI) vs `server` (`openai`/`anthropic`/`google`
  via the `aiKey` collection) — already exactly the local/server split the
  spec asks for.
- `src/server/routes/ai.ts`: authenticated (`requireSuperAdmin`) `/api/ai/chat`
  with SSE streaming, per-conversation history, local CLI spawn
  (`runLocalCli`/`streamLocalCli`), multi-key fallback for server mode
  (`readServerCredentials`, `isAiKeyFallbackError`), plus `/api/ai/check` and
  `/api/ai/models`. Fully implemented and tested
  (`status/ai-chat-stream.md`, `status/ai-key-fallback.md`,
  `status/ai-key-model-check.md`), but has **no client caller right now** —
  this is the backend the new dialog will call, it just needs a structured
  (non-chat) mode added to it.
- `aiKey` singleton (`src/content-types/seed.ts`, sortable `keys` list:
  name/provider/model/URL/write-only key) — the "AI key table" for server
  mode, already readable (list, no secret) by any user with read permission
  on it (`src/server/routes/content-entries.ts`'s `protectSystemMutation`
  only restricts *writes* to super admin).
- `src/content-types/draft-store.ts` (`saveDraft`/`drafts` signal) +
  `ApplyBuildDialog.tsx` + `content-types.ts`'s batch plan/apply — the
  existing stage-locally → dry-run → apply pipeline
  (`status/content-type-staged-apply.md`). This is the landing spot for
  whatever the wizard produces; no second apply path needed.
- `field-registry.ts`'s fixed field-type vocabulary (`text`, `richtext`,
  `number`, `boolean`, `date`, `image`, `select`, `password`, `secretkey`,
  `relation`, `component`; `relationmirror` is auto-generated only) — the
  closed vocabulary the AI must be constrained to when proposing fields.

## Plan

1. **Entry point**: one "Ask AI" button in `BuilderContentType.tsx`'s page
   header (next to "Apply Builder"), opening `AiSchemaWizardDialog`.
2. **No free-text box**: every AI turn renders as a question with a fixed
   set of choices (single/multi-select), plus an "other" escape hatch only
   where the option space is inherently open (e.g. a table name) — never a
   chat transcript.
3. **Structured protocol**: one JSON schema the model must always return,
   e.g. `{kind:"question", question, choices:[{id,label_en,label_vi}],
   multi}` | `{kind:"proposal", tables:[...], question}` |
   `{kind:"done", drafts:[...]}`. Every model turn goes through a
   validate-then-retry loop server-side: parse as JSON against this schema;
   on failure (bad JSON, missing fields, unknown field type/kind, wrong
   shape) send a corrective follow-up quoting the exact violation and ask
   for a resend, up to N retries, before surfacing an error to the client.
   This is the "yêu cầu lại đến khi chuẩn cấu trúc" requirement.
4. **System prompt**: fixed English prompt describing drycms's content-type
   model — kinds (collection/singleton/component), the closed field-type
   vocabulary and their `config`/`validation` shapes, `features` flags,
   naming rules (`naming.ts`) — enough for the model to emit
   `ContentTypeDefinition`/`FieldDefinition` fragments directly instead of
   prose that needs re-interpretation.
5. **Flow**: clarifying choice-driven questions → AI presents suggested
   tables (name, purpose, key fields) and asks the admin to confirm, drop,
   reorder, or adjust before continuing ("gợi ý các bảng và hỏi bạn đồng ý
   hay đóng góp 1 lựa chọn order") → only on explicit confirmation does it
   emit the final `done` payload with concrete field/table changes.
6. **Landing the result**: map each proposed table/field addition into
   `ContentTypeDefinition`/`FieldDefinition` objects (reusing `naming.ts`'s
   id/order helpers) and call `saveDraft()` per type — new tables with
   `isNew: true`, extensions merged onto the live definition. The admin then
   reviews/applies through the existing, untouched `ApplyBuildDialog`. The
   wizard itself never talks to the DB.
7. **Provider combobox**: in server mode, a combobox lists the admin's
   configured `aiKey` entries (name/provider/model only, no secret — same
   read path `AiKeyEditor.tsx` already uses) so the admin can pick which key
   this wizard run uses, overriding the automatic fallback order. In local
   mode there is nothing to pick (single CLI from `dry.config.ts`); the
   combobox is hidden or shows the fixed provider label only.
8. **Output language**: resolved — a new `ai.lang` field on `DryAiOption`
   (`src/server/options.ts`, alongside `mode`/`provider`/`keyName`, e.g.
   `ai: { lang: "vi" }`, default `"en"`). The system prompt itself (schema
   description, field-type vocabulary, instructions) stays English always —
   only user-facing strings inside the structured reply (`question`,
   `choices[].label`) are requested in `lang`, via one line in that same
   English system prompt ("write `question`/`label` values in {lang};
   everything else — field `type` tokens, content-type/field `name`s, ids —
   stays in English/ASCII, never translated"). One field, one call, no
   second translation round-trip: `label_en`/`label_vi` dual-field design is
   dropped in favor of this simpler config-driven single-language output.

## Field deletion via the wizard

Resolved — the wizard CAN propose removing an existing field, but it goes
through the exact same trash mechanism the manual schema editor already uses
(`ContentTypeDefinition.deletedFieldIds`, `FieldTrashDialog.tsx`): the field
id is staged into `deletedFieldIds` on the draft, not spliced out of
`fields[]`. `tree.ts`/`migration.ts` keep generating its column as before
until someone empties it from the trash for real, exactly like a manual
Remove today. The wizard never performs a real `DROP COLUMN` and never
empties the trash itself — that stays a deliberate, separate manual action
in the existing Field Trash UI. No new "archive" concept needed; this is a
straight reuse of what's already there.

## Explicitly out of scope for this pass (confirm before expanding)

- Auto-applying AI-proposed drafts — always lands in the existing manual
  review/apply dialog, never writes the DB directly.
- Permanently emptying the field trash (real `DROP COLUMN`) from the wizard
  — it can stage a deletion into `deletedFieldIds`, never purge it for good.
- Resuming a wizard session across a page reload / a history of past
  sessions — the wizard's conversation lives only for as long as the dialog
  is open.
- Token-by-token streaming for wizard turns — structured JSON isn't
  meaningfully renderable mid-stream choice-by-choice, so wizard turns use
  a single completed-reply request (reusing the same local/server call
  plumbing, just not the SSE delta path), unlike the old prose chat.

## Implementation steps (draft ordering, not started)

1. `src/server/options.ts` — add `lang?: string` to `DryAiOption` /
   `ResolvedAiOption` (default `"en"`), resolved by `resolveAiOption()` like
   every other `ai.*` field.
2. `src/content-types/ai-wizard-protocol.ts` — shared JSON schema types +
   parse/validate function (single source of truth for both the system
   prompt's schema description and client/server validation).
3. `src/server/routes/ai.ts` — add a `wizard` mode: takes the running
   structured turn history, builds the fixed English system prompt (schema
   vocabulary + the one `ai.lang` output-language instruction), calls
   existing local/server AI plumbing (non-streaming), validates the reply,
   auto-retries with a corrective message, returns the parsed structured
   turn. Retry logic lives server-side only.
4. Small read-only listing for the `aiKey` combobox (name/provider/model,
   no secret) — likely just the existing generic content-entries list call
   already used elsewhere, not a new route.
5. `src/pages/content-type-editor/AiSchemaWizardDialog.tsx` — renders the
   current question/choices, multi-select + "other", the table-suggestion
   review/reorder step, and the final step that calls `saveDraft()` per
   proposed type (new tables `isNew: true`; field removals staged into
   `deletedFieldIds` on the merged draft, never spliced out of `fields[]`).
6. Wire the "Ask AI" button into `BuilderContentType.tsx`'s header.
7. Tests: protocol validation unit tests (valid/invalid shapes, retry
   trigger), a route test for the wizard turn + retry-until-valid behavior
   and for `ai.lang` affecting only `question`/`label` strings, and a manual
   Playwright walkthrough of the dialog flow (choices → table review →
   drafts appear with the existing "Edited"/new badge, same as a manual
   edit).
8. Verify: `bun run typecheck`, `bun run test`, manual dev-server pass:
   create one new collection, add one field to an existing collection, and
   stage one field deletion via the wizard, then apply through the existing
   "Apply Builder" dialog and confirm the deleted field lands in the Field
   Trash exactly like a manual delete would.

## Status

Implemented and verified. All 8 steps above are done:

- [x] `ai.lang` added to `DryAiOption`/`ResolvedAiOption` (`src/server/options.ts`,
      default `"en"`).
- [x] `src/content-types/ai-wizard-protocol.ts` - the `question`/`proposal`/
      `done` JSON schema, `parseWizardTurn()` (structural validator with
      precise, quotable error messages) and `extractWizardJson()` (tolerates
      prose/markdown-fenced replies).
- [x] `src/server/routes/ai.ts` - `wizard` slug (`POST /api/ai/wizard`,
      reached automatically through the existing generic `/api/:segment/:slug`
      router, no new route registration needed). Builds the fixed English
      system prompt (content-type model, closed field vocabulary, the
      `naming.ts` reserved-word list so the model doesn't propose e.g.
      `title`/`slug`, and the one `ai.lang` output-language instruction),
      reuses `createChatStream()` (same local-CLI/server-credential-fallback
      path the old chat used) by draining it to a single full reply instead
      of forwarding SSE, validates with `parseWizardTurn`, and retries with a
      corrective follow-up turn up to `WIZARD_MAX_ATTEMPTS` (3) before
      surfacing a clear error. `readServerCredentials`/`createChatStream`
      gained an optional `preferredName` so a per-request AI Key override
      (the combobox) restricts to exactly that key, no silent fallback.
- [x] AI Key picker: no new endpoint - reused the existing generic
      `createContentEntriesApi(...).list()` against `aiKey` client-side
      (secrets already masked server-side for that type). Combobox only
      renders in server mode with more than one configured key.
- [x] `src/pages/content-type-editor/AiSchemaWizardDialog.tsx` +
      `src/content-types/ai-wizard-map.ts` (pure, independently-tested
      mapping from confirmed `done` tables to real `ContentTypeDefinition`/
      `FieldDefinition` drafts, reusing `naming.ts`'s
      `validateContentTypeDefinition`/`normalizeFieldOrder` and
      `field-registry.ts`'s per-type `defaultConfig`). `QuestionStep` (choice
      chips + optional single "other" input), `ProposalStep` (keep/drop
      checkboxes + up/down reorder - the "1 lựa chọn order" contribution),
      `DoneStep` (stages drafts via the existing `saveDraft()`, shows
      per-table staged/error results). New `.ai-wizard-*` CSS added to
      `components.css`, following `.apply-build-dialog`'s fixed-header/
      scrolling-body pattern.
- [x] "Ask AI" button wired into `BuilderContentType.tsx`'s header (new
      `SparkleIcon`, added via `icons.config.json` + `bun run build:icons`).
- [x] Tests: 17 `ai-wizard-protocol` unit tests (valid/invalid shapes for all
      3 turn kinds, duplicate choice ids, unknown field type, missing
      relation target, count caps) + 8 `ai-wizard-map` unit tests (new-table
      build, relation resolution against both existing and same-batch-new
      targets, extend-existing skipping already-present fields, removeFields
      staging into `deletedFieldIds`, name-collision/reserved-name/
      no-longer-exists failure paths) + updated `options.test.ts`/
      `client-config.test.ts` for the new `ai.lang`/`aiMode` fields.
- [x] Verification: `bun run typecheck`, `bun run test` (618/618 passing),
      `bun run build` (client + SSR) all clean. Live smoke test against a
      disposable E2E server (`bun scripts/e2e-server.mjs`, fresh throwaway
      admin, never the developer's real dev database): confirmed CSRF/auth
      gates reject an anonymous `POST /api/ai/wizard`, an authenticated call
      correctly reaches `readServerCredentials` and returns a clean
      `"No usable AI API keys are configured."` error (expected - the E2E
      database has no `aiKey` rows), and a real headless-browser pass
      confirmed the "Ask AI" button opens `.ai-wizard-dialog[open]` and
      renders that error in the dialog's error stage with a working "Try
      again" button, no console errors beyond incidental Vite HMR/WebSocket
      noise from the ad-hoc launch.

### Follow-up round (same day, post-implementation feedback)

- **Real multi-turn AI conversation verified live**: found `codex` isn't on
  this machine's PATH (`runWizardTurn` used to swallow that as a generic
  "AI returned an empty response" - fixed by decoding the SSE `data:` lines
  instead of blindly draining them, so real errors like "Unable to start
  codex" now surface). Verified the full path with `claude` (installed,
  local mode) against a disposable E2E server: real Vietnamese structured
  replies, validated on the first attempt, no retry needed.
- **Selected-choice styling fixed**: `.ai-wizard-choice[aria-pressed="true"]`
  wasn't visually distinguishable - specificity looked sufficient on paper
  but empirically lost to `button.outline`'s own rule (root cause not fully
  pinned down despite CDP-level inspection; fixed pragmatically with a more
  specific selector + `!important`, a pattern already used 30+ times
  elsewhere in this file). Selected = solid filled primary, verified via a
  real computed-style check in a live page, not just visual inspection.
- **Question budget added**: system prompt now caps clarifying questions at
  3 and instructs the model to infer sensible defaults and move to a
  `proposal` as soon as reasonably possible, rather than interrogating.
- **Real token streaming**: `/api/ai/wizard` changed from a single buffered
  JSON response to a genuine SSE stream (`{delta}`/`{retry}`/`{turn}`/
  `{error}` events, same envelope `/api/ai/chat` already used) - the dialog
  shows the model's raw output live in a small scrolling preview while
  waiting, swapping to the parsed choice UI once a turn validates. Known,
  pre-existing limitation carried over from the old chat feature: a local
  CLI (`codex`/`claude`) may flush short replies as one OS-buffered chunk
  rather than token-by-token - only the provider-API (server mode) and
  longer local replies show genuinely incremental delivery.
- **Initial goal step added**: the dialog no longer fires an AI call the
  instant it opens. It now shows a one-time free-text "what do you want to
  build" box first (with a "Skip, let AI ask" escape hatch) - the ONE
  deliberate exception to "no free text box", since it's a single seed
  input before the interview starts, not an ongoing chat. Folded into the
  first priming message server-side (`WizardHttpRequest.goal`) rather than
  sent as a separate history entry, so the conversation still opens with
  exactly one "user" turn (avoids a same-role-twice reject on strict
  providers like Anthropic). Verified live: a concrete goal made the model
  skip clarifying questions entirely and jump straight to a `proposal`.

All of the above verified through real browser passes (Playwright against a
disposable E2E server/database, never the developer's live dev data) plus
`bun run typecheck` / `bun run test` (618/618) / `bun run build` after each
change, not just static review.

### Second follow-up round (same day): progressive reveal, protocol simplification

- **Progressive JSON reveal** ("json dở dang"): considered switching the wire
  format to YAML for its line-oriented partial-parseability, recommended
  against it (would forfeit every provider's native JSON-schema-enforced
  output mode, and YAML's quoting rules are a bigger source of malformed
  output than JSON's) in favor of a partial-JSON repairer that keeps the
  format unchanged. Added `closeOpenJson`/`repairPartialJson`/
  `parsePartialWizardTurn` (`ai-wizard-protocol.ts`): closes whatever
  string/`{}`/`[]` is left open at the streaming cutoff, with a bounded
  (80-char) backoff for cuts that land mid-token (a dangling key with no
  `:` yet, a partial literal) rather than pattern-matching every truncation
  shape. The dialog's loading stage now renders question text and
  choice/table rows as they complete (`PartialPreview`, inert/pulsing until
  the full turn validates) instead of a raw-text SSE preview. 16 new unit
  tests, including one that feeds every prefix length of a real turn and
  asserts the extracted fields only grow, never regress.
- **Icon replaced**: the user supplied an exact SVG (a 3-sparkle mark) not
  found in either installed Iconify set (`solar`/`lucide` - checked by
  distinctive path substring, no match) - hand-written as
  `src/components/AiSparkleIcon.tsx` instead of forcing it through the
  generated `icons.tsx` pipeline (which is `do not edit`, sourced only from
  those two sets). The unused `Sparkle` manifest entry added earlier this
  session was reverted from `icons.config.json` and regenerated out.
- **`ContentTypeFeatures` support added**: the wizard previously had no way
  to propose `slug`/`draft`/`schedule`/`timestamps`/`seo`/`sortable` at
  all - `WizardProposedTable` gained an optional `features` field (closed
  vocabulary `WIZARD_FEATURE_KEYS`, mirroring `ContentTypeFeatures`
  independently rather than importing it, so this protocol module stays
  the one place defining what a model may send), validated the same way as
  everything else, and the system prompt now describes each feature (per
  `FeaturesFieldset.tsx`'s own descriptions) with an explicit
  enable-only-never-disable rule. `ai-wizard-map.ts`'s `mergeFeatures` only
  ever turns a feature on, even if the model sends `false` for something
  already enabled on an existing table.
- **Collapsed `proposal`+`done` into one terminal turn**: the protocol used
  to round-trip a THIRD AI call to turn a confirmed `proposal` into `done`
  before staging anything. Since Content Types already reviews every draft
  again before it touches the database (`ApplyBuildDialog`/"Apply Builder"),
  that AI-mediated confirm step just duplicated an existing one - removed
  `WizardDoneTurn` from the protocol entirely; `proposal` is now terminal
  and stages directly, client-side, no further network call. (The
  keep/drop/reorder review UI this originally landed on was itself removed
  one round later - see below.)
- Verified live end-to-end with a real `claude` call: a Vietnamese goal
  mentioning draft/scheduled publishing produced a staged draft with
  `features: {slug, draft, schedule, timestamps}` all correctly inferred,
  a `relation` field correctly resolved to the real built-in `user` table's
  id, exactly one `/api/ai/wizard` request for the whole flow (zero more
  after confirming), and the new icon rendering correctly - inspected the
  actual staged `localStorage` draft JSON, not just the UI. Progressive
  reveal's live-visual confirmation was inconclusive this run (`claude -p`
  again flushed the whole short reply in one chunk, same CLI-buffering
  characteristic noted in the streaming section above) - covered instead by
  the pure-function monotonic-growth unit test.
- 643/643 tests, typecheck, and build clean throughout.

### Third follow-up round (same day): panel instead of dialog, fully auto-apply

- **Modal dialog → docked side panel**: `AiSchemaWizardDialog.tsx` renamed
  to `AiSchemaWizardPanel.tsx` and rebuilt on a plain `<div>` instead of
  `<dialog>` - a `showModal()` dialog's native backdrop blocks interaction
  with the page behind it, which defeats the actual goal here: the
  content-types list needs to stay live and clickable while the panel is
  open, since the list IS the review surface now (see next point). Docked
  `position: fixed` to the right edge, full height, `translate`-based
  slide transition (same off-canvas technique `.sidebar`'s mobile drawer
  already used, mirrored to the opposite edge and available at every
  width, not just mobile) - no backdrop, no dimming. Lost `useDialogSync`'s
  native focus-trap/Escape handling that came for free with `<dialog>`;
  replaced Escape with a manual `keydown` listener. `.ai-wizard-dialog`'s
  CSS (which inherited padding/header/footer layout from the base
  `dialog { }` rule) became a self-contained `.ai-wizard-panel` block since
  a plain `div` inherits none of that.
- **`proposal` is now fully automatic**: previously confirmed by the admin
  via a keep/drop/reorder review screen inside the panel (added earlier
  this same day) before staging. That whole review UI is now gone - the
  moment a `proposal` turn validates, every table in it is staged as a
  draft immediately and the panel closes on its own, no click. Only stays
  open (with an error) if every table in the proposal failed to stage (a
  name collision, most likely); a partial success still stages what it can
  and closes, telling the admin via toast which one(s) need manual
  attention. Rationale is the same one behind removing the AI-mediated
  confirm round-trip earlier: content-types' own "Apply Builder" already
  reviews every draft before it touches the database, and now that the
  list is visibly live behind the panel, even the CLIENT-SIDE review step
  was redundant on top of that - "xem chỉnh thêm nếu cần" (view/adjust more
  if needed) happens in the normal list/schema editor, not in this panel.
- `WizardMapResult`/`ArrowUpIcon`/`ArrowDownIcon`/`CheckCircleIcon`/
  `XCircleIcon` and the whole `ProposalStep` component are gone - the panel
  now only ever renders `start` → `loading` → `question` (looping) → either
  auto-closes (success) or `error`. `useMemo`'s only remaining use is the
  partial-preview parse.
- Verified live: panel mounts docked exactly to the viewport's right edge
  (`x + width === viewport width`, full height) once open, slide transition
  settles correctly, content-types list stays visible and clickable behind
  it throughout. Drove a full run with `claude`: submitted a goal, AI
  proposed 2 tables, panel closed itself with zero clicks, and the
  content-types list immediately showed both new rows with "Draft" badges
  live, no reload - confirming the list-as-review-surface design actually
  works, not just closes.
- 644/644 tests (one new elsewhere, unrelated to this work), typecheck, and
  build clean.

### Known concurrent-editing note

Mid-session, an unrelated automated commit (`b511d9f`, message "push") landed
on this branch while this work was in progress - matches this project's
already-known pattern of another process periodically committing/pushing the
shared working tree (see `[[feedback_concurrent_repo_editing]]` in the auto
memory). Not caused by this work and not acted on (no history rewrite) -
noted here in case that intermediate snapshot matters later.

## Speed

Implemented in one session, directly following the approved plan (no scope
changes to the core design). Three same-day follow-up rounds addressed
live-usage feedback in sequence - styling/UX/error-surfacing fixes and real
token streaming; then progressive JSON reveal, an icon swap, features
support, and dropping a redundant AI round-trip; then dropping the modal
dialog and its in-panel review step entirely in favor of a docked side
panel that auto-applies straight into the (now live-updating) content-types
list. Each round simplified the interaction model further, converging on
"the list itself is the review UI." Every change across all three rounds
was verified against a real running instance (typecheck/test/build plus a
live browser pass, most against real local-AI output) rather than left as
"should work" - most of the added time went to that verification loop
rather than the code changes themselves, which were each fairly small and
well-isolated.
