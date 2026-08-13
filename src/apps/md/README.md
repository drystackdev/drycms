# Project context for Magic Chat / MCP

This file is always read before Magic (the Page Editor's AI chat) or an MCP
client makes any change to this project. Keep it short and link out to other
files under `md/` for anything longer - only this file is read automatically.

## Design system

The site's Tailwind theme (`styles/theme.css`, `styles/base.css`) ships with
shadcn/ui's own default color tokens - `background`, `foreground`, `card`,
`primary`, `secondary`, `muted`, `accent`, `destructive`, `border`, `input`,
`ring`, plus `chart-1..5` and `sidebar-*`, each with a light (`:root`) and
dark (`.dark`) value. Use them as Tailwind utilities directly, e.g.
`bg-primary text-primary-foreground`, `bg-card`, `border-border` - never
hardcode a hex/oklch color in a page or component when one of these already
names the right role.

A `cn()` class-merging helper lives at `component/lib/utils.ts` (import it
as `@component/lib/utils`) - the same helper shadcn components expect at
`@/lib/utils`, so pasting in a shadcn component's code only needs that one
import path changed. Use it to combine a component's own base classes with
any variant/size classes and caller-supplied overrides.

A hand-rolled stand-in for shadcn's `class-variance-authority` package
lives at `component/lib/cva.ts` (import `cva`/`VariantProps` from
`@component/lib/cva`) - real `class-variance-authority` can't be installed
here (this project's build only resolves `preact`/`preact/hooks` as npm
imports; everything else must be a local `@component/*` file), but this
covers the same `variants`/`defaultVariants`/`compoundVariants` shape, so a
pasted shadcn component's `cva(...)` call only needs its two imports
repointed at `@component/lib/cva` and `@component/lib/utils`.

`component/Button.tsx` is a starter example of both: a `cva()`-declared
variant/size map, styled entirely from the tokens above. Follow its shape
(`cva()` for the class map, `interface Props extends
VariantProps<typeof theVariants>` for the component's own props,
`export const defaultProps` for the Page Editor's own live preview) for any
new reusable component under `component/`.

See [components.md](./components.md) for the full catalog of what already
exists under `component/` - check it before building something that might
already be there, and add an entry to it for anything new.

## Stack

- **Preact** (not React) - `preact/hooks` for `useState`/`useEffect`/etc.
  Already available, no import setup needed.
- **Tailwind CSS v4** - utility classes directly in JSX `class="..."`
  attributes; `@theme`/`@layer` blocks only belong in `styles/*.css`.
- Every page/layout is a plain exported function component under `pages/`
  (`page.tsx`, `layout.tsx`) reading data through the ambient `dry()`
  reader - see this repo's own `docs/README.md` (read via
  `kind: read, root: docs`) for how `dry()`, `params()`, and `setTitle()`
  work, and this project's real content types/collections.
- Shared, reusable pieces go under `component/` and are imported via
  `@component/Name` - never duplicate the same UI in two pages, extract it
  here instead.

## Conventions

- Add new design tokens to `styles/theme.css`'s `@theme inline` block (and
  their raw `:root`/`.dark` values above it) rather than inventing a
  one-off color inline.
- New shared components go in `component/`; keep page-specific markup in
  the `pages/**/page.tsx` file itself.
