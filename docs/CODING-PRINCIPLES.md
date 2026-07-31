# Coding principles

Standing rules about *how* changes get made in this codebase, distilled from
past corrections and confirmed decisions. Read before making any non-trivial
change; see [ARCHITECTURE.md](ARCHITECTURE.md) and [DESIGN.md](DESIGN.md)
for what the system looks like structurally and visually.

## Prefer hand-rolled API glue over a new dependency

When a third-party service's REST API already returns everything needed
(e.g. Iconify's `.json?icons=` response has `body`/`width`/`height` per
icon), compose the result by hand rather than adding an SDK/helper library as
a new runtime dependency. This is specifically about *thin API glue* (simple
string composition, basic JSON reshaping) - it is not a blanket objection to
dependencies. A real security-sensitive parsing job (e.g. SVG sanitization)
is a legitimate reason to add one; check whether the underlying HTTP API
already makes a candidate library redundant before reaching for it.

## Comments: explain the non-obvious "why", not the "what"

This codebase's own exported types and functions already lean toward
documenting *why* a non-obvious design choice was made (see
`ContentTypeDefinition.fieldOrder`'s doc comment in `types.ts`, or
`options.ts`'s `readDotEnv`) - keep that pattern for genuinely hidden
constraints, subtle invariants, or workarounds for a specific bug. Don't add
comments that restate what well-named code already says, and don't leave
"removed"/historical comments behind - that context belongs in a commit
message or a `status/*.md` note, not inline.

## Self-healing overlay maps are the idiom for cosmetic per-id config

`fieldOrder`, `fieldSides`, and `fieldDescriptions` (see ARCHITECTURE.md)
establish a reusable pattern: a persisted `Record<id, value>` that overlays
a *display* concern on top of structural data, where a missing id falls back
to a computed default and a stale id is silently ignored rather than
erroring. Follow this shape for any future per-id override rather than
requiring the map to be exhaustive, and rather than mixing the overlay into
the structural field itself.

## Fail at config-resolution time, not at request time

`src/server/options.ts`'s `resolveOptions()` validates and throws on bad
`dry.config.ts` input immediately, with an error naming the exact offending
key (`` `[drycms] \`content.binding\` is only used with...` ``) - so a config
mistake surfaces once, at boot, instead of producing a confusing failure
deep inside a request handler later. Apply the same standard to any new
config surface: validate eagerly, throw with a specific, actionable message.

## Testing

- Unit tests live colocated with source as `*.test.ts` (vitest, run via
  `bun run test`, scoped to `src/**` by `vitest.config.ts` - it does not pick
  up `e2e/`).
- End-to-end tests (Playwright) live in `e2e/` at the repo root
  (`bun run test:e2e`, needs a running dev server).
- For any CSS/UI change, follow DESIGN.md's "QA method" section - visual
  screenshot **and** computed-style assertions, both themes, not one or the
  other.
- `bun run typecheck` runs `tsc --noEmit` over `src/` excluding `*.test.ts`
  (tests are type-checked implicitly by vitest's own transform).

## Concurrent-editing hazards (this repo, specifically)

The working tree - code *and* config - can be live-edited by another session
or editor while you work, not just by the dev server running. Consequences
worth remembering:

- **Never blind `git stash`.** It grabs the entire working tree, including
  another session's in-progress, uncommitted work. If you must stash,
  inspect `git stash show --stat` before popping, and prefer
  `git checkout stash@{N} -- <specific paths>` over a blanket `pop`. Never
  chain `git stash && ... && git stash pop` in one command/turn - always
  inspect the actual stash output first. Don't `git stash drop` a stash you
  didn't create the context for, even after you're satisfied you don't need
  it - leave it as a recovery net and tell the user it's there.
- **A clean `git diff` only proves you haven't changed a file** - it says
  nothing about whether a concurrent session changed and already committed
  something that affects runtime behavior (an engine/storage config, an env
  var, a port). For anything runtime-affecting, check the dev server's own
  startup log after a restart and compare against what it said before,
  rather than trusting a clean diff.
- **The dev server resolves `dry.config.ts` once per process and caches it
  at module scope** (`server/config.ts`) - editing the config file requires
  a restart to take effect, and a long-lived process can end up internally
  inconsistent if Vite's SSR module graph reloads different server modules
  at different times relative to a config edit. An inconsistent error from a
  running dev server (one route behaves differently from another for config
  that should be identical) is itself the signal to restart, not a logic bug
  to keep chasing.
- To answer "did this test failure predate my change," use `git diff`/
  `git log -p` on the specific file - not a stash-based A/B check.

## Optimistic locking

`ContentTypeDefinition.version` increments on every successful schema save -
any new save path needs to participate in this, not bypass it.

## Permission model is schema-only right now

`role`/`permission` rows exist and sync correctly (see ARCHITECTURE.md), but
nothing enforces them against requests yet. Don't build a feature that
assumes permission checks already gate access - if asked to add enforcement,
treat it as new work, not a bug fix to something that silently regressed.
