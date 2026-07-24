# drycms

A Preact-based CMS UI for Astro. One integration mounts an admin dashboard, and
a global stylesheet styles everything from bare tags and native attributes —
Pico-style authoring, Minimals-style visuals.

## Install

```sh
bun add drycms preact
```

`preact` is a peer dependency. `@astrojs/preact` is not — drycms registers the
Preact renderer itself.

## Use

```js
// astro.config.mjs
import { defineConfig } from 'astro/config';
import dry from 'drycms';

export default defineConfig({
  integrations: [dry()],
});
```

Visiting `/dry` redirects to `/dry/dashboard`. `/dry/showcase` is a live gallery
of every component with copy-paste markup.

### Options

```ts
interface DryOption {
  /** Base path for the admin UI. @default "/dry" */
  path?: string;
}
```

`path` is normalized (leading slash added, trailing slashes stripped) and
validated at config time. Nested paths such as `/studio/cms` work; `/` and paths
containing route parameters, `?`, `#` or whitespace are rejected.

Everything the UI renders derives its links from `path`, so changing it moves
the whole admin UI.

## Styling

Put `class="dry"` on `<body>` and import the stylesheet:

```astro
---
import 'drycms/styles.css';
---
<body class="dry">…</body>
```

All rules are scoped under `.dry` and grouped in cascade layers
(`dry.tokens`, `dry.base`, `dry.forms`, `dry.components`, `dry.utilities`), so
nothing leaks into the rest of your site and your own CSS overrides it without
`!important`.

Native/ARIA attributes drive state wherever one genuinely applies —
`disabled`, `readonly`, `checked`, `aria-invalid`, `aria-selected`, `aria-busy`,
`role`, `open` on `<details>`. Classes are used only where there is no real
attribute for the concept (a button's colour, a card, a badge):

```html
<button>Save</button>
<button class="destructive sm">Delete</button>
<button class="soft info">Soft info</button>
<button aria-busy="true">Saving</button>

<article class="card">
  <header><h2>Title</h2><p>Description</p></header>
</article>

<span class="badge success">Published</span>
<div class="alert destructive"><h3>Failed</h3><p>Try again.</p></div>

<div class="field">
  <label for="title">Title</label>
  <input id="title" aria-invalid="true" />
  <span class="error">Required.</span>
</div>
```

`.sm`/`.lg` are classes rather than the `size` attribute, since `size` already
has different, native meaning on text inputs.

### Theming

The palette is [Minimals](https://minimals.cc): green `#00A76F` primary, the
`919EAB` grey ramp, and grey-tinted elevation. Tokens are declared once with
`light-dark()`, so the theme follows the OS by default; adding a `.light` or
`.dark` class to the `.dry` element pins it (`ThemeToggle` does this for you).

Intent tokens come as full ramps — `--dry-<intent>-lighter | -light | <base> |
-dark | -darker` for `primary`, `secondary-main`, `info`, `success`, `warning`
and `error` — plus `--dry-grey-50 … --dry-grey-900`. Override any of them:

```css
.dry {
  --dry-primary: #1877f2;
  --dry-radius: 0.375rem;
}
```

The font stack asks for `DM Sans` (what Minimals uses) and falls back to the
system UI font. drycms does not load a webfont — add one yourself if you want an
exact match.

## Icons

Icons are [Solar](https://icon-sets.iconify.design/solar/), with
[Lucide](https://icon-sets.iconify.design/lucide/) as the fallback set. They are
inlined at build time, so the published package has no icon dependency and the
browser never calls the Iconify API.

```astro
---
import Icon from 'drycms/components/Icon.astro';
---
<Icon name="Dashboard" />
<Icon name="Settings" size="1.5rem" />
```

```tsx
// Inside a Preact island — each icon is a separate export, so bundlers
// drop the ones you do not use.
import { SettingsIcon } from 'drycms/components/icons';
```

To add an icon, put it in `icons.config.json` (`"<set>:<name>"`, Solar first)
and run `bun run build:icons`. The generator fails loudly on a name that does not
exist, or on a set other than Solar/Lucide.

## Components

Interactive pieces are Preact islands:

```astro
---
import DataTable from 'drycms/components/DataTable';
---
<DataTable columns={columns} rows={rows} pageSize={10} client:load />
```

- `drycms/components/DataTable` — sortable, filterable, paginated table
- `drycms/components/ThemeToggle` — cycles system → light → dark
- `drycms/components/SidebarToggle` — opens the mobile sidebar

`.astro` components are exported too: `drycms/components/Icon.astro`,
`drycms/components/Demo.astro` (a preview + code pair, used by the showcase).
`Demo.astro` syntax-highlights its code with [Prism.js](https://prismjs.com) at
build time — no highlighter ships to the browser, and the token colours come
from `--dry-code-*` tokens, so they follow the light/dark theme.

## Notes

- In `output: 'static'`, the `/dry` → `/dry/dashboard` redirect is emitted as an
  HTML meta-refresh page. Add an adapter for a real 301/302.
- The package ships uncompiled `.astro` and `.css`; the integration adds the
  necessary `vite.ssr.noExternal` entry automatically.
