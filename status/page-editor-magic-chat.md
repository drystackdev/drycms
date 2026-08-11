# Page Editor Magic Chat (AI code assistant on /dry/page-editor)

## Plan

Full plan: `/Users/kcoder/.claude/plans/soft-hopping-lightning.md` (approved).

Summary: new sibling feature to the existing content-entry Magic Write, not a
modification of it.

- Server: `src/server/routes/ai-page-source-write.ts` (new route, `code`/
  `chat`/`read` turns), `src/server/routes/ai-page-source-read.ts` (read-hop
  executor, two allowed roots: `pagesSourceStorage` + repo `docs/`),
  `src/page-components/ai-page-source-prompt.ts` (system prompt, always
  embeds `docs/README.md`), `src/page-components/ai-page-source-protocol.ts`
  (YAML-subset turn types, reusing `ai-magic-write-protocol.ts` parser
  primitives). Dispatch wired into `src/server/handler.ts`.
- Client: `src/pages/page-editor/PageSourceMagicChat.tsx` (widget, reuses
  `.magic-chat-widget` CSS + `AiKeyPicker`), `src/pages/page-editor/
  page-source-magic-chat-store.ts` (IndexedDB session persistence). Mounted
  in `src/pages/PageEditor.tsx` as a trailing sibling (~line 2119), gated on
  existing `canEdit` (`PAGE_BUILDER_RESOURCE_ID`, "setting").
- Apply model: direct-write-while-streaming into `sourceByPath[path]` (no
  diff UI) — user explicitly chose this over a diff-preview gate. Safety net
  is existing `handleReset`/diagnostics/build-failure surfaces, not new code.
- AI writes only to the file open when the turn started, even if the admin
  navigates away mid-stream (pinned target path).

## Status

Plan approved 2026-08-11. Implementation done same day:

- New: `src/page-components/ai-page-source-protocol.ts` (+ `.test.ts`, 18
  passing), `ai-page-source-docs.ts`, `ai-page-source-prompt.ts`,
  `src/server/routes/ai-page-source-read.ts`, `ai-page-source-write.ts`,
  `src/pages/page-editor/page-source-magic-chat-store.ts`,
  `PageSourceMagicChat.tsx`.
- Edited: `src/server/handler.ts` (dispatch + `PAGE_BUILDER_RESOURCE_ID`
  gate for new `page-source-ai` segment), `src/server/request-limits.ts`
  (body-size cap for that segment), `src/pages/PageEditor.tsx` (mounts the
  widget, `handleMagicCodeChange`), `src/server/routes/pages-source.ts`
  (exported `isPageSourceFileName`/`requirePageSourceFileName`),
  `src/server/routes/mcp.ts` (added `list_page_source`/`read_page_source`/
  `write_page_source` tools per the user's explicit ask to expose this on
  the existing MCP server too - `write_page_source` writes immediately,
  unlike the in-app widget which never touches storage itself).
- `bun run typecheck`: clean. `bun run test`: new suite 18/18 passing; full
  suite has 4 pre-existing unrelated failures (component-preview.test.ts
  hex-color assertion, sitemap.test.ts static-route-tree assertion, 2x
  auth.test.ts missing `avatar` field) - confirmed via `git status` none of
  those files were touched by this work.

**Dev-server hot-reload gap confirmed + fixed**: same class of issue this
project's memory already documents for `API_ROUTES`-style module-scope
registration - the server needed a restart to pick up the new
`page-source-ai` segment (user approved restarting it). After restart,
verified via curl against the live dev server (logged in as the real
super-admin account):
- `POST /api/page-source-ai` with an empty body → `400 invalid_request,
  "Magic requires a file to be open."` - confirms dispatch + the
  `PAGE_BUILDER_RESOURCE_ID` permission gate both work.
- `tools/list` on `/api/mcp` now includes `list_page_source`/
  `read_page_source`/`write_page_source` alongside the existing 6 tools.
- `list_page_source` (root) → `component/`, `pages/`, `styles/`. `list_page_source`
  on `pages/` → `pages/page.tsx`. `read_page_source` on `pages/page.tsx` →
  its real current content, verbatim.

**Still unverified**: the in-app widget's own UI (bubble/popover/streaming
into the `Editer` buffer) and a real end-to-end AI turn. The Playwright
browser tool stayed locked ("already in use") by what looks like a separate
active session on this machine the whole time, including after the dev
server restart - didn't force it. Separately, this dev instance has no
`aiKey` entry configured (`list_entries typeSlug:aiKey` → none), so even a
curl-only turn against `/api/page-source-ai` can't exercise a real model
call right now regardless of the browser - would need an AI Key added via
`/dry/content/aiKey/new` first.

## Speed

Implementation complete + typecheck/tests clean + server-side (route,
permission, MCP tools) verified live against the real dev server, same day
as plan approval. Only remaining step is a human (or a free browser session)
clicking through the widget itself in `/dry/page-editor`.
