# drycms docs

**Read the relevant file(s) here before writing code in this repo.** They
capture decisions, conventions, and gotchas that aren't obvious from reading
a single file in isolation - several were arrived at only after a bug shipped
or after the user corrected an approach. Re-deriving them from scratch tends
to reproduce the same mistakes.

- [ARCHITECTURE.md](ARCHITECTURE.md) - how the app is put together: server
  request flow, the two pluggable content engines, the content-type/field
  model, storage backends, RichText. Read before touching `src/server/**`,
  `src/content-types/**`, `src/storage/**`, or `src/components/RichTextField/**`.
- [DESIGN.md](DESIGN.md) - the visual system and its CSS conventions
  (design tokens, the class-vs-attribute rule, control size scale,
  scrollbars). Read before touching any `.css` file or any component markup.
- [SPACING.md](SPACING.md) - the de facto spacing scale, layout primitives
  (`.stack`/`.row`/`.grid`/`.container`), page structure, and per-component
  padding/gap reference. Read before laying out a new page, dialog, or card.
- [APP-ROUTER.md](APP-ROUTER.md) - the file-based router for the site's own
  public content pages (`pagesSourceStorage/pages/**`): routing conventions, `dry()`,
  the async-vs-sync/hooks rule, Tailwind-only styling, MPA navigation. A
  completely separate design system from the admin UI above - read this
  instead of DESIGN.md/SPACING.md before touching page/component/style source.
- [CODING-PRINCIPLES.md](CODING-PRINCIPLES.md) - standing rules about how
  changes get made in this codebase (dependencies, comments, validation UX,
  testing/QA method, config-resolution timing, concurrent-editing hazards).
  Read before making any non-trivial change.
- [DEPLOYMENT.md](DEPLOYMENT.md) - how to run drycms in production on Node or
  Cloudflare Workers. Covers configuration, build steps, and runtime setup for
  both platforms. Read before deploying.
- [MCP.md](MCP.md) - the Model Context Protocol server for external AI
  clients (Claude Desktop, Claude Code, ...): auth, and the full tool list
  for reading/writing content and page source. A different surface from
  this Page Editor chat you're reading this index in.

For the project layout and dev/build/test commands, see
[`AGENTS.md`](../AGENTS.md) at the repo root (`CLAUDE.md` is a symlink to it).
For narrower, point-in-time write-ups of specific past features, see
`status/*.md` - those are historical working notes, not standing reference
docs; the files above are the durable ones and take precedence if they
ever disagree.
