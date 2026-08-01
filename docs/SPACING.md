# Spacing & layout

How this app uses space: the de facto spacing scale, the layout primitives,
and where each padding/gap value comes from in the real CSS (not an ideal
scale invented after the fact). Read this alongside
[DESIGN.md](DESIGN.md) - that file owns color/radius/class-vs-attribute/
scrollbars; this one owns spacing/layout only. Sources: `tokens.css`,
`utilities.css`, `components.css`, `forms.css`.

## There is no numbered spacing token

Unlike color (`--dry-grey-500` etc.) there's no `--dry-space-1`/`-2`/`-3`
scale - padding/gap are literal rem values chosen per component. They
cluster tightly enough to read as one scale in practice:

| rem | px | typical use |
| :-- | :-- | :-- |
| `0.25rem` | 4px | tightest - badge internal gap, list-item vertical rhythm, card header title↔subtitle gap |
| `0.375rem` | 6px | form field stack: label → control → helper text (`.field`'s own gap) |
| `0.5rem` | 8px | buttons-in-a-row, `.row`'s default gap, badge `padding-inline`, `.input-group` gap, card/dialog footer gap |
| `0.75rem` | 12px | topbar gap, sidebar internal gap, nav icon↔label gap |
| `1rem` | 16px | page-header gap, dialog header `margin-block-end`, `.content`'s top padding |
| `1.5rem` (`--dry-gap`) | 24px | **the default section rhythm** - card padding, dialog padding, `.content`'s inline padding, `.stack`/`.grid` default gap |
| `2rem`+ | 32px+ | rare - structural indents (`.content-type-list` margin), `.content`'s bottom padding (`4rem`) |

The only value that's an actual custom property is `--dry-gap: 1.5rem`
(`tokens.css`) - the "loose"/section-level rhythm. Everything tighter than
that is a literal value at the component's own discretion; don't invent a
`--dry-space-*` scale to formalize this, the codebase deliberately doesn't
have one.

## Layout primitives (`utilities.css`) - reach for these first

```css
.stack  /* flex column, gap: var(--dry-gap) - vertical section rhythm */
.row    /* inline flex, align-items: center, gap: 0.5rem, wraps - a button/chip row */
.grid   /* css grid, gap: var(--dry-gap), auto-fit minmax(16rem, 1fr); .cols-2/.cols-4 variants */
.container /* max-width: 80rem, margin-inline: auto - page-width clamp */
```

Use these instead of writing a bespoke `display:flex; gap:...` rule in a
component's own CSS whenever the layout is generic (a row of buttons, a
vertical stack of fields, a responsive card grid). When a specific spot
needs tighter/looser spacing than the primitive's default, override `gap`
inline rather than forking the class - e.g. `ContentTypes.tsx` does
`<div class="stack" style={{ gap: "0.125rem" }}>` and
`<span class="row" style={{ gap: "0.375rem" }}>` for a compact nav-item
label group, while every other `.stack`/`.row` on the page keeps the
class defaults.

## Page structure

Every page composes the same shell, provided once by the layout
(`DryLayout`), not reinvented per page:

```
.main (100dvh)
  .topbar        - height var(--dry-topbar-height) (4rem), padding-inline 1.5rem, gap 0.75rem
  .content       - padding: 1rem 1.5rem 4rem; display:grid; gap: var(--dry-gap)
    .page-header - flex row, justify-content: space-between, gap 1rem, wraps under 48rem
    ...page body (cards / .grid / tables / .stack) inherits .content's gap
```

A new page should render `.page-header` followed by whatever body content
it needs, all as direct children of `.content` - don't add page-level
padding of your own, `.content` already owns it.

## Component padding reference

| component | padding | internal gap | notes |
| :-- | :-- | :-- | :-- |
| `.card` | `1.5rem` | `1.5rem` (body), header `0.25rem`, footer `0.5rem` | `.flush` removes the card's own padding and puts `1.5rem` on `header`/`footer` individually instead, for edge-to-edge body content like a table |
| `dialog` | `1.5rem` | header `margin-block-end: 1rem` (internal gap `0.25rem`), footer `margin-block-start: 1.5rem`, gap `0.5rem` | same rhythm as `.card`, sizes via `.sm`/`.md`/`.lg`/`.xl` change width only, not padding |
| `.sidebar` | `sidebar-head`/`sidebar-scroll`: `padding-inline: 1rem` | `0.75rem` (sidebar), `0.25rem` (between nav items), `0.75rem` (icon↔label inside a nav item) | |
| `.topbar` | `padding-inline: 1.5rem` | `0.75rem` | height fixed at `--dry-topbar-height` |
| `.badge` | `padding-inline: 0.5rem` | `0.25rem` | smallest padding tier in the app - compact chip-like elements only |
| `.field` (label+control+hint) | n/a | `0.375rem` | the "tight" unit - much tighter than the `1.5rem` section rhythm, don't reuse `--dry-gap` here |

## Rule of thumb

- Grouping small controls horizontally (buttons, icon-buttons, an
  input + trailing button) → `0.5rem`.
- A form field's own label/control/helper-text stack → `0.375rem`.
- Anything that reads as a "section" (a card, a dialog, the page body,
  a grid of cards) → `1.5rem` / `var(--dry-gap)`.
- Shell chrome (topbar, sidebar) → `0.75rem`.
- Don't pick a value outside this table without a reason; if nothing
  fits, `1rem` is the safe default for "medium" gaps (page-header gap,
  dialog header spacing).

## Responsive collapse

Two breakpoints do almost all layout-level responsive work:

- `width < 48rem` (768px) - sidebar becomes an off-canvas drawer,
  `.page-header`'s row wraps full-width, two-column dialogs stack.
- `width < 64rem` (1024px) - two-column grids
  (`gap: var(--dry-gap) 2rem` - row-gap `1.5rem`, column-gap `2rem`) collapse
  to a single column (`content-type-editor-grid`,
  `content-entry-editor-grid`, `content-types-grid`, the auth split-screen
  layout).

Padding/gap values themselves don't change at breakpoints in this app -
only `grid-template-columns` does. Don't add a breakpoint-specific gap
override unless an existing pattern already needs one.

## The grid overflow gotcha

Any new `display: grid` container needs an explicit
`grid-template-columns` (e.g. `minmax(0, 1fr)`) or the implicit auto
column inflates to content's max-content width and overflows once nested
in a flexible outer track - this has bitten ~9 locations already. Full
writeup in [DESIGN.md](DESIGN.md#grid-overflow-gotcha).

## When building a new page or dialog

1. Don't add page-level padding - `.content` already provides it.
2. Reach for `.stack`/`.row`/`.grid`/`.container` before writing bespoke
   flex/grid CSS.
3. Group content into `.card`s using the standard `1.5rem` padding/gap;
   use `.flush` only when the body needs to touch the card's edges.
4. Inside a field/form, use `.field`'s `0.375rem` rhythm, not `--dry-gap`.
5. Only write a literal padding/gap value when nesting inside an
   existing owned component (sidebar, popover, dialog) that already
   defines its own rhythm - match its existing values, don't invent new
   ones nearby.
