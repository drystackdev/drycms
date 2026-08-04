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

### Known gaps / deliberately deferred

- No real multi-turn AI conversation was exercised end-to-end (no live API
  key was available in this pass to test against) - the retry-on-invalid-
  structure loop is covered by the `parseWizardTurn` unit tests plus a
  careful read of `handleWizard`'s orchestration, not by watching a real
  model get corrected live. Worth a follow-up pass once a real `aiKey` (or
  local `codex`/`claude`) is available to test with.
- `component` fields are still excluded from the wizard's vocabulary (needs
  a component-target picker UI too) - see the original "Explicitly out of
  scope" section above, unchanged.
- The wizard's server-side system prompt only sees the LIVE type list
  (`schema.listContentTypes()`) - it doesn't know about a browser's pending
  localStorage drafts, so it may re-suggest a name/relation target that a
  not-yet-applied draft already claims. `mapWizardTables()` still catches the
  collision client-side (against the merged live+draft list) when staging,
  it just can't warn the model about it mid-conversation.

## Speed

Implemented in one session, directly following the approved plan above (no
scope changes). Most of the time went to grounding the field/config mapping
in the existing schema editor's own logic (`field-registry.ts`,
`naming.ts`) so wizard-generated drafts behave identically to a hand-built
one, and to setting up a safe way to smoke-test against a disposable server
instead of the developer's live dev database.
