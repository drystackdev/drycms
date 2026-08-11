# RichText image align + public-page content CSS + sticky toolbar

## Plan

Three reported problems, all in how RichText content leaves the editor and
lands somewhere else:

1. **Ảnh center align bị méo trên trang public**
   (https://maianhquyen.vn/blogs/benh-giang-mai-giai-doan-3-trieu-chung-hinh-anh).
   Center exported as `min-width: 100%; margin-inline: auto` on the `<img>`
   itself. The uncaptioned export has no wrapper, so that stretched the
   image's own box to the column width. Measured in Chromium: a
   `537x302` image rendered `992x302` (stretched), an unsized one blew up to
   the full column. `object-fit` was omitted whenever `lockAspectRatio` was
   on, so nothing kept the ratio.
2. **Nội dung richtext lệch CSS mặc định của trang.** Exported tags carry no
   classes; the editor styles them from its shadow-root stylesheet, which
   doesn't ship to the site, and Tailwind preflight resets the browser
   defaults they relied on. Block `dry-*` components also exported as bare
   custom elements, which lay out inline until their script upgrades them.
3. **Sticky toolbar offset wrong outside a normal admin page.** The sticky
   rule was `.main .richtext ... { top: var(--dry-topbar-height) }`, so a
   richtext field in a dialog (relation-mirror quick create) reserved a
   topbar's worth of space that isn't there, and one in the VEI frame wasn't
   sticky at all.

## Status

Done, verified in a real browser (headless Chromium, computed styles + rects).

**Export encoding (`schema.ts`, `html.ts`, `image-view.ts`)**

- Center is now `display: block; margin-inline: auto` on the bare `<img>` /
  inline `dry-*`, and plain `margin-inline: auto` on a captioned `<figure>`
  (whose `display: table` already shrink-wraps). `min-width: 100%` is gone
  from the export; `parseImageAlign` still reads it back as center, so saved
  content keeps its alignment and re-exports in the new form on next save.
- `object-fit` is written for every sized image, locked ratio included. The
  old lock exception was wrong twice over: a consumer page clamps images with
  its own `max-width`, which changes the box ratio, and `lockAspectRatio` is
  editor-only state that resets on reload - so an unlocked image's
  `object-fit` silently disappeared on the first save after a reload.
- Captioned images now round-trip their alignment: `imageNodeFromFigure` reads
  align off the `<figure>` (where the export puts it) instead of the `<img>`.
- Block `dry-*` components export `style="display:block"`.
- Paste sanitizer keeps `display` / `margin-inline-*` on IMG/FIGURE, so
  copied content stays centered.

**Public-page CSS (`apps/globals.css`, blog + about pages)**

- New `.dry-richtext` block in `@layer components` (beats preflight, still
  loses to a page's own utility class): headings, list markers + indent,
  blockquote rule, link underline, table/th borders, caption/figcaption,
  `img { display: inline; max-width: 100% !important }` (the `!important` is
  the only thing that can beat the exported `max-width: none`), grid spacing.
- Applied via `class="dry-richtext"` on the two containers that render a
  richtext value.

**Sticky toolbar (`components.css`, `ContentEntryEditor.tsx`)**

- `.richtext-toolbar` is sticky in every context now, at
  `top: var(--dry-richtext-toolbar-top, 0px)`. `.main` sets it to the topbar
  height, `dialog` resets it to `0` (its `<header>` is outside the scrolling
  body), `.vei-frame-content` sets it to `var(--dry-vei-header-height)`,
  published by a `ResizeObserver` on the VEI frame's own `.page-header`
  (bare mode has no fixed topbar token, and that header's height varies).

## Speed

Verified, on a locally seeded test article
(`/blogs/test-layout-richtext`, inserted straight into `.dry/content.sqlite`):

| case | 1280px viewport | 390px viewport |
| --- | --- | --- |
| centered 537x302 | `537x302`, gaps 228/228 | `358x302` box, contained, no overflow |
| centered unsized | `750x470`, gaps 121/121 | `358x224`, ratio kept |
| captioned centered | figure gaps 296/296 | full width |
| float left | flush left, text wraps | unchanged |

Typography: `list-style: disc`, 20px indent, 1px th borders on slate-50, 2px
quote rule, underlined links, 28px h2, 12-column grid, `scrollWidth ==
clientWidth` (no horizontal overflow) at both widths.

Sticky offsets read back from the real admin bundle: `.main` 64px, `dialog`
0px, VEI frame 0px with no header / 84px once `--dry-vei-header-height` is
set, `position: sticky` in all three.

Unit tests: new `export-layout.test.ts` (9 cases) pins the align/fit encoding
and block-component display; `bunx vitest run src/components/RichTextField`
83/83 green, `bun run typecheck` clean.

### Notes / left undone

- **Already-saved content keeps the old encoding.** The stored HTML is what
  renders, so the live blog post is only fixed once that entry is saved again
  through the editor (import reads the legacy `min-width: 100%` as center and
  the save re-exports it correctly). No migration was run.
- **The admin UI could not be exercised on this checkout**: login 500s with
  `Unknown field type "avatar" on field "system-user-avatar"` - the live
  `.dry/content.sqlite` has a user type from a newer branch, and this branch
  has no `avatar` field type registered. Pre-existing, unrelated to these
  changes; the sticky-toolbar behaviour was verified against the real CSS
  bundle instead of by driving the dialog.
- **16 pre-existing unit-test failures** in `seed` / `sqlite` /
  `entries-sqlite` / `dry-reader` / `content-types` routes, all from the same
  live-DB-vs-seed drift (definitions list has `siteSettings`, `valueProp`,
  `videoSection` the fixtures don't expect). Untouched by this work.
- The local dev DB had no `siteSettings` row, so every public page rendered
  an empty body; a minimal `siteSettings` / `blogsPage` / `category` row was
  inserted alongside the test article to make the site render locally.
