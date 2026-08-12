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
  straight to storage (no draft/Save step, unlike the Page Editor UI) - the
  change still needs a Build (from the admin's Page Editor) to reach the
  live site.
- `preview_page_source` - compile and render a static `page.tsx` route to
  check it works. `dry()` resolves to empty/null here, so this checks
  compile/render correctness, not real content.

**Reference:**
- `read_dry_types` - this project's generated `dry()` ambient types
  (`dry.generated.d.ts`) - the REAL, current collection/singleton names and
  field shapes. Always check this before writing or editing a `dry()` call;
  see `APP-ROUTER.md`'s own warning about not guessing field names.
- `list_docs` / `read_doc` - this repo's own `docs/*.md` files (this one
  included) - read `docs/APP-ROUTER.md` before writing page-source code.

The `initialize` response's `instructions` field gives a client a short
orientation covering the points above, so a well-behaved MCP client
generally reaches for `read_dry_types`/`read_doc` on its own before writing
code - but nothing enforces that; a client can still call `write_page_source`
directly.
