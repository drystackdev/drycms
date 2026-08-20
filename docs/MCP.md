# MCP server

A Model Context Protocol server (`src/server/routes/mcp.ts`) exposing this
instance's content and page-source tree as MCP tools, so an external MCP
client (Claude Desktop, Claude Code, ...) can read/write it directly instead
of going through the admin UI. This is a different surface from the Page
Editor's own in-app Magic Chat (`APP-ROUTER.md` doesn't apply here - that
doc is about writing page-source code; this one is about the tool-call
protocol an external client speaks). Connect a client and review what it's
done under the admin's own Profile page ("AI Activity").

## Auth

A single POST endpoint (`/api/mcp`, the MCP "Streamable HTTP" transport,
stateless mode), authenticated by a bearer Personal Access Token created
from Profile. Every tool call re-runs the exact same permission checks the
admin UI itself uses (Page Builder access for the page-source tools,
per-content-type view/create/update access for the content tools) - an MCP
client can never do anything the token's owner couldn't already do by hand.

## Tools

**Content:**
- `list_content_types` - every collection/singleton defined here.
- `list_entries` / `get_entry` - list or fetch entries of one collection (or
  a singleton's own entry), optionally filtered by free-text search.
- `create_entry` / `update_entry_fields` - write plain scalar fields
  (text/richtext/number/boolean/date/select) only; relation and image
  fields still need the admin UI.
- `list_media` - files/folders in the media library.

**Page source** (the same `pages/`/`component/`/`styles/`/`md/` roots
`APP-ROUTER.md` documents):
- `list_page_source` / `read_page_source` - browse and read one file. Start
  with `md/README.md` for this project's own admin-authored notes, if any.
- `write_page_source` - create or overwrite one file's raw text. Saves
  straight to storage (no draft/Save step, unlike the Page Builder UI) - the
  change still needs a Build (from the admin's Page Builder) to reach the
  live site.
- `preview_page_source` - compile and render a static `page.tsx` route to
  check it works. `dry()` resolves to empty/null here, so this checks
  compile/render correctness, not real content.

**History** (read-only - see `Settings -> Versions` in the admin for the
restore side, which is deliberately not a tool):
- `list_versions` - every commit on this project's branch, newest first, code
  and content together. A `[CONTENT] `-prefixed message is a content change
  (entries or the content-type document); anything else is page-source code.
- `read_version` - one commit's message/author/date plus every file it
  changed inside the two roots drycms owns, with the diffs.
- `read_version_file` - one file's full contents AS IT WAS at a commit.

**Reference:**
- `read_dry_types` - this project's generated `dry()` ambient types
  (`dry.generated.d.ts`) - the REAL, current collection/singleton names and
  field shapes. Always check this before writing or editing a `dry()` call;
  see `APP-ROUTER.md`'s own warning about not guessing field names.
- `list_docs` / `read_doc` - this repo's own `docs/*.md` files (this one
  included) - read `docs/APP-ROUTER.md` before writing page-source code.

**Schema:**
- `propose_content_type` - the one tool that does NOT apply immediately.
  Give it a full content-type definition as a JSON string; matching by
  `name` against an existing type proposes an UPDATE to it, a `name` that
  doesn't exist yet proposes a new one. Either way it's saved as a pending
  draft the admin reviews and applies (or discards) themselves under
  Content Types -> Apply and build - exactly like a draft they typed by
  hand, badged "AI" in that review dialog. Deleting a content type isn't
  supported by this tool.

The `initialize` response's `instructions` field gives a client a short
orientation covering the points above, so a well-behaved MCP client
generally reaches for `read_dry_types`/`read_doc` on its own before writing
code - but nothing enforces that; a client can still call `write_page_source`
directly.

## AI-proposed schema drafts never touch the live schema directly

`propose_content_type` writes to a server-side KV staging area
(`src/server/ai-content-type-drafts.ts`), never to the live content-type
table - the same "index + per-draft record" shape `auth-security.ts` already
uses for Personal Access Tokens, capped at 20 pending drafts per user with a
30-day TTL as a backstop if nothing ever reviews them. The admin's browser
pulls pending drafts into the same IndexedDB-backed draft store a
human-typed draft already uses (`content-types/draft-store.ts`,
`content-type-draft-db.ts`) the next time they open Content Types, so it
shows up in the exact same "Apply and build" flow - no separate review
screen. If a pulled AI draft conflicts with a different draft already
sitting there for the same content type, the admin is asked to overwrite or
keep their own before anything is merged. Applying, discarding, or
explicitly keeping a conflicting local draft instead all clear the
server-side staging entry.
