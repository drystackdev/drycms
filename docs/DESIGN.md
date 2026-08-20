# Design system

Visual language follows [Minimals](https://minimals.cc): soft tinted fills,
8px radii, grey-tinted elevation. Read this before touching any `.css` file
or writing component markup.

## Tokens

`src/styles/tokens.css` declares every color once with `light-dark()` so
theming follows the OS by default; `.dry.light` / `.dry.dark` classes on the
root pin a theme explicitly (there is no `data-theme` attribute in this
project - theming is class-based, consistent with the class-vs-attribute
rule below). Don't hardcode a hex value or `rgb()` anywhere outside
`tokens.css` - reference a `--dry-*` custom property instead. Translucent
neutrals (`--dry-accent`, `--dry-selected`, `--dry-focus`, scrollbar handle
colors, etc.) are all `--dry-grey-channel` at different alpha - this makes
them theme-invariant (same value in light and dark) by construction; follow
that pattern for any new translucent-neutral surface rather than inventing a
separate light/dark pair.

## The class-vs-attribute rule (standing, explicit user instruction)

CSS hooks must be a plain HTML/ARIA attribute **only when the attribute has
genuine native meaning** for that tag: `disabled`, `readonly`, `checked`,
`aria-invalid`, `aria-selected`, `aria-busy`, `role`, `open` (on
`<details>`). Everything else that needs styling - a button's color
variant, a size tier, `.card`, `.destructive` - is a CSS class, **never**
`data-*`.

Class names are minimal and **unprefixed** (Pico.css style: `grid`, `card`,
`destructive`, `sm`, `lg`, `soft`, `outline`, `filled`) - deliberately not
`dry-`-prefixed, even though that costs some collision risk. This was a
conscious tradeoff for editor/class-name autocomplete ergonomics; don't
"fix" it by adding a prefix.

`data-*` is reserved for things that are **not** CSS: content-carrying data
(`data-tooltip`) or pure JS hooks with zero CSS coupling
(`data-dialog-open`, `data-tabs`, `data-sidebar-toggle`). **If a `data-*`
attribute has a matching CSS rule, that's a bug** - convert it to a class.
Before adding any new CSS selector or component prop, ask: does this have
real native semantics? If yes, attribute. If no, unprefixed class.

`components.css`'s own header comment restates this rule in one line - it's
load-bearing, not decorative; keep it in sync with this doc if either
changes.

## Control size scale

Inputs and buttons are **not** on a shared scale - a bare button is one tier
below the same-named input size:

| tier | input/select/textarea (`forms.css`) | button/`[role=button]`/etc. (`components.css`) |
| :-- | :-- | :-- |
| `.sm` | 2.25rem | 1.75rem |
| default / `.md` | 2.75rem | 2.25rem (bare, unclassed button lands here) |
| `.lg` | 3.25rem | 2.75rem |
| `.xl` | n/a | 3.25rem |

`.icon` width mirrors height per tier. Only the explicit tier classes
(`.sm`/`.md`/`.lg`/`.xl`) set `font-size`; the bare/unclassed button rule
deliberately leaves `font-size` alone (`font: inherit`) because internal
reuses of a plain `<button>` (Select's trigger, NumberField's stepper
+/- buttons, Popover triggers) already reset height/padding but never
font-size - a blanket override would leak into them. Field-like wrapper
controls (`.select`, `.stepper`, `.toggle`) stay on the **input** scale, not
the button scale, since they read as inputs, not buttons. When styling a
new control, decide "input-like" vs "button-like" first, then match its
scale - don't invent a third scale.

## Grid overflow gotcha

`display: grid` without an explicit `grid-template-columns` lets the
implicit auto column inflate to content's max-content width, overflowing
when nested in a flexible outer track. This has bitten ~9 separate
locations already. Default every new grid container to an explicit
`grid-template-columns` (e.g. `minmax(0, 1fr)` for a single flexible
column) rather than relying on the implicit default.

## Scrollbars

App-wide: **OverlayScrollbars** (npm `overlayscrollbars`), via the
`useOverlayScrollbars` hook (`src/components/overlayscrollbars.ts`) and a
custom `.os-theme-dry` theme in `src/styles/scrollbar.css`, styled with this
project's own tokens (transparent track, `rgb(var(--dry-grey-channel) /
32%)` handle strengthening on hover/active). This is the **current, official,
app-wide decision** - it superseded an earlier SimpleBar-based approach and a
homegrown "scrollbar-auto" overlay mechanism, both fully removed; don't
reintroduce either without being asked again.

Distinguish two kinds of scrollable surface:

- **Owned-component classes** this project always renders itself (`.sidebar`,
  `.select-popup`, `.file-preview-filmstrip`, etc.) - native `overflow` fully
  removed, OverlayScrollbars is the only scroll mechanism.
- **Public/generic selectors** a consumer might also hand-author (`.scroll`
  utility, `[role="tablist"]`, `pre`) - keep a plain native
  `overflow-x/y: auto` fallback *in addition to* OverlayScrollbars, so markup
  outside a drycms component doesn't silently lose scrolling.

Default any new scrollable UI to `useOverlayScrollbars` + `.os-theme-dry`.

## Inline field validation, not toast

Dialog/form validation errors render **inline on the offending field**
(error state + helper text under the control, matching the `error`/
`helperText` props most field components already accept) - never as a
floating toast. Gate an "attempted" boolean (see `FieldDialog.tsx`'s
`saveAttempted`) so errors don't show before the first save attempt, and add
one small summary line near the dialog's Save/Cancel footer ("Fix the
highlighted fields.") rather than a toast. Reserve `toast.add()` for
genuinely out-of-band outcomes (network/save failures) - not per-field input
validation. A required-but-easy-to-miss control (e.g. a select whose options
list needs ≥1 entry) still gets the same `*` asterisk as any other required
field.

## Text input placeholders

Every text input in the admin UI (`TextField`, `SlugField`'s label/slug
inputs, any generic `"text"`-widget setting in the field registry) should
carry a realistic demo `placeholder` (e.g. `"e.g. Blog Posts"`,
`"e.g. ^[A-Za-z0-9_-]+$"`) - never left blank. Standing rule for any new text
input anywhere in the app, not just the content-type editor.

## QA method for CSS/UI changes

Verify with Playwright - both a visual screenshot **and** computed-style/DOM
assertions (`getComputedStyle`, `getBoundingClientRect`,
`elementFromPoint`), not eyeballing screenshots alone, and check both
`.dry.light` and `.dry.dark`. Working import in this repo is
`import { chromium } from "@playwright/test"` (not a bare `playwright-core`
import), run from within the project directory. Known bug classes worth
specifically re-checking whenever relevant code changes:

- The grid overflow gotcha above.
- Any element with a `useOverlayScrollbars` ref must stay a CSS *positioned*
  element (`relative`/`sticky`/etc.) at every breakpoint - the library
  absolutely-positions its internal viewport against the host, and
  `position: static` breaks that containment.
- A "header" child inside a `display: grid` container that becomes
  multi-column at a breakpoint needs `grid-column: 1 / -1`, or it only spans
  one cell once the grid goes multi-column.
