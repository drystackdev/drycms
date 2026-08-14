# Component catalog

Every reusable piece under `component/`, kept up to date as new ones are
added - check here before building something that might already exist.
Linked from `README.md`; only read when something in this project actually
needs one of these (an admin request touching a shared component, or
building a new one).

## `component/ThemeToggle.tsx`

An icon button that switches the public site between light and dark themes
and persists the visitor's choice in `localStorage`. The starter root layout
already renders it; import it as `@component/ThemeToggle` anywhere else that
needs a standalone theme control.

## `component/Button.tsx`

A `cva()`-declared button. Axes:

- `variant`: `default` | `secondary` | `outline` | `ghost` | `destructive`
- `size`: `default` | `sm` | `lg`

Styled entirely from `styles/theme.css`'s tokens (`bg-primary`,
`bg-secondary`, `bg-destructive`, ...) - never its own hardcoded colors. Use
this for EVERY button/link-styled action across pages, not hand-rolled
`<a class="...">` markup.

```tsx
import Button from "@component/Button";

<Button label="Save" variant="default" size="default" />

{/* Pass `href` to navigate instead of acting - renders an `<a>`, never a
   `<button>` nested inside one (see `pages/404.tsx`/`500.tsx`). */}
<Button label="Back to home" href="/" />
```

## `component/lib/utils.ts`

`cn(...)` - joins class names, skipping falsy values. Every component's own
class output should go through this rather than string-concatenation.

## `component/lib/cva.ts`

`cva(base, { variants, defaultVariants, compoundVariants })` /
`VariantProps<typeof someVariants>` - hand-rolled stand-in for shadcn's
`class-variance-authority` package (see `README.md`'s Design system section
for why the real package isn't installed). Use this for any component with
more than one visual axis (variant, size, ...) instead of hand-writing a
`Record<Variant, string>` per axis.

## Adding a new one

1. `cva()` for the class map if it has variant/size axes; plain Tailwind
   classes + `cn()` if it doesn't.
2. `export const defaultProps` so the Page Editor's own live preview has
   something real to render.
3. Add an entry to this file.
