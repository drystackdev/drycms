---
name: page-ui
description: Design and build the public site's UI in the page source store (`.dry/pages-source/**` - the `pages/`, `component/`, `styles/`, `md/` roots). Use when asked to create or restyle a public page/layout, add sections (hero, cards, nav, footer, CTA), build a reusable `@component/*`, adjust the site's Tailwind theme tokens, or fix responsive/dark-mode behaviour on the site. NOT for the admin UI under `src/` - that's a different design system (`docs/DESIGN.md`).
---

# Designing UI in `.dry/pages-source`

`.dry/pages-source` is the **live source of the tenant's public website** -
a completely separate app and design system from the admin UI in `src/`.
It is never tracked in git (each tenant's real site lives in its own R2
bucket in production); `.dry/pages-source` is that store's local form and
what `bun run dev` reads directly. Edits here are live immediately in dev.

Never apply `docs/DESIGN.md` / `docs/SPACING.md` here - those are the
admin's hand-rolled CSS system (`.card`, `.stack`, `--dry-*` tokens). The
public site is **Tailwind v4 + shadcn tokens**, nothing else.

## Read first (in this order)

1. `.dry/pages-source/md/README.md` - THIS project's own conventions,
   written by the person building this site. It overrides generic advice.
2. `.dry/pages-source/md/components.md` - the catalog of what already
   exists under `component/`. Check before building anything.
3. `docs/APP-ROUTER.md` - routing, `dry()`, `select`, dynamic routes.
4. `.dry/dry.generated.d.ts` - the REAL current collection/singleton names
   and field shapes. Never guess a field name. Missing on a fresh checkout;
   `bun run dry:generate` (or `bun run dev`) writes it.

Then read a sibling page/component before writing a new one - match what's
already there rather than introducing a second house style.

## The four roots

| root | holds | reachable as |
| :-- | :-- | :-- |
| `pages/` | routes only: `page.tsx`, `layout.tsx`, `404.tsx`, `500.tsx` | a URL (folder name = path segment, `[slug]`, `[...rest]`) |
| `component/` | reusable `.tsx` | `import X from "@component/X"` (resolves from the storage root, not relative - same specifier at any depth) |
| `styles/` | `globals.css` (entry), `theme.css` (tokens), `base.css` | compiled into every page |
| `md/` | project notes for AI | never compiled |

Page-specific markup stays in that page's own file. The moment the same UI
appears on two pages, extract it to `component/` and add it to
`md/components.md`.

## Hard constraints - these throw or silently break, they aren't style

1. **Import allowlist.** Only `preact`, `preact/hooks`, `@component/*`, and
   relative files. Everything else is a build error
   (`page-build.ts`'s `NPM_ALLOWLIST`). No `lucide-react`, no
   `framer-motion`, no `class-variance-authority`, no `tailwind-merge`, no
   `clsx`. Need an icon → inline the SVG (see `component/ThemeToggle.tsx`).
   Need `cva`/`cn` → the local stand-ins below.
2. **`dry()`, `params()`, `setTitle()`, `dryBind()` are ambient globals.**
   Never import them - an import is what breaks the build, not the call.
3. **An `async` component must not call a hook.** This throws at runtime,
   it is not a preference. `page.tsx`/`layout.tsx` are `async` (they fetch)
   → no `useState`/`useEffect` in them. Anything interactive goes in a
   separate **plain synchronous** component that receives data as props;
   it hydrates and works client-side for free.
4. **Never render `<html>`, `<head>`, or `<body>`.** `render.ts` owns the
   outer document. A layout that renders its own produces doubled markup.
5. **No per-component `.css` file.** Tailwind utilities in JSX only.
   Anything that must be real CSS (`@theme`, `@layer`, a keyframe) goes in
   `styles/theme.css` / `styles/base.css`. `globals.css` already
   `@source`-scans the whole store, so new utility classes are picked up
   with no config change. Don't delete or rename those three files - they
   are delete-locked and auto-recreated.
6. **MPA, no client router.** Every navigation is a real `<a href="/x">`.
   Don't reach for `preact-iso`'s `Router`/`LocationProvider` here.

## Design system: shadcn tokens

`styles/theme.css` ships shadcn/ui's default token set, each with a
`:root` and a `.dark` value, exposed to Tailwind through `@theme inline`.
**Use the role, never a hex/oklch literal** - that's what makes dark mode
work for free.

| role | utilities |
| :-- | :-- |
| page surface | `bg-background text-foreground` |
| raised surface | `bg-card text-card-foreground`, `bg-popover text-popover-foreground` |
| main action | `bg-primary text-primary-foreground` |
| quiet action | `bg-secondary text-secondary-foreground` |
| de-emphasised text / chips | `text-muted-foreground`, `bg-muted` |
| hover/active surface | `hover:bg-accent hover:text-accent-foreground` |
| danger | `bg-destructive text-white` (there is no `destructive-foreground` token - the starter Button uses `text-white`, match it) |
| lines | `border-border`, form controls `border-input` |
| focus ring | `ring-ring` |
| data viz | `chart-1` … `chart-5` |
| radius | `rounded-sm/md/lg/xl` (derived from `--radius: 0.625rem`) |

Opacity modifiers on tokens are idiomatic here: `hover:bg-primary/90`,
`bg-muted/50`.

Dark mode is `@custom-variant dark (&:is(.dark *))` - the `.dark` class
lands on `<html>` (set by `component/ThemeToggle.tsx` +
`ThemeFlashGuard`). Because tokens carry both themes, you rarely need a
`dark:` utility at all. Reach for one only for something a token can't
express (an image swap, a shadow, an SVG that must flip).

Needing a colour no token names is a signal to **add a token** to
`theme.css` (a raw value in both `:root` and `.dark`, plus its
`--color-*` line in `@theme inline`), not to inline a literal.

## `cn()` and `cva()`

- `@component/lib/utils` → `cn(...)`, joins classes, skips falsy. Every
  component's class output goes through it. Note it is **not**
  `tailwind-merge`: conflicting classes are left in source order, so don't
  rely on a later class overriding an earlier one - emit only one.
- `@component/lib/cva` → `cva(base, { variants, defaultVariants,
  compoundVariants })` and `VariantProps`. Same shape as shadcn's package,
  so pasting a real shadcn component in needs exactly two import paths
  changed (`class-variance-authority` → `@component/lib/cva`,
  `@/lib/utils` → `@component/lib/utils`) - plus React → Preact idioms
  (`class`, no `forwardRef` need, `preact/hooks`).

Use `cva()` whenever a component has more than one visual axis. A single
fixed appearance is plain classes + `cn()`.

## Authoring a `component/` file

Follow `component/Button.tsx`'s shape:

```tsx
import { cva, type VariantProps } from "@component/lib/cva";

const cardVariants = cva("rounded-lg border border-border bg-card p-6", {
  variants: { tone: { default: "", muted: "bg-muted" } },
  defaultVariants: { tone: "default" },
});

interface CardProps extends VariantProps<typeof cardVariants> {
  title: string;
}

export default function Card({ title, tone }: CardProps) {
  return <div class={cardVariants({ tone })}>{title}</div>;
}

export const defaultProps: CardProps = { title: "Card title", tone: "default" };
```

- **Default export** = the component.
- **`export const defaultProps`** so the Page Editor's live preview renders
  something real. May be an **array** - each entry previews as its own
  variant, which is the cheap way to show all sizes side by side.
- **`export const _view = (<>…</>)`** instead, when the useful preview
  isn't "one instance with props" (composed children, a required wrapper).
  With `_view` the default export isn't touched at all.
- Add an entry to `md/components.md` when you're done. That file is how
  the next agent avoids rebuilding your component.

## Layout conventions of this starter

Not an invented scale - this is what the starter files actually do. Match
it unless the request says otherwise.

- The root layout wraps children in `flex min-h-dvh flex-col` → a page's
  own root element wants **`flex-1`** to fill the viewport
  (`<main class="flex flex-1 flex-col …">`). Forgetting it is why a short
  page collapses against the header.
- Page width clamp: `mx-auto w-full max-w-6xl px-6` (header/wide layouts),
  `max-w-3xl` for prose, `max-w-2xl`/`max-w-md` for centred hero copy.
- Header bar: `h-16`, `border-b border-border`.
- Vertical section rhythm: `py-16` for a page section, `gap-4` inside a
  content stack, `gap-2`/`gap-1` for tight control rows, `gap-6` between
  header regions.
- Typography: eyebrow `text-sm font-medium text-muted-foreground`, h1
  `text-4xl font-bold tracking-tight sm:text-5xl`, body
  `text-muted-foreground` (add `text-lg leading-8` for long prose).
- Interactive elements: `transition-colors` + a `hover:` state, and
  `aria-label` on any icon-only control.
- Responsive: mobile-first, `sm:`/`md:`/`lg:` to widen. Grids collapse via
  `grid gap-6 sm:grid-cols-2 lg:grid-cols-3`.

## Data-driven UI

```tsx
export default async function BlogPage() {
  setTitle("Blog");
  const { rows } = await dry().collection("blog").list({
    sort: { field: "date", dir: "desc" },
    select: { title: true, slug: true, cover: true },
  });
  return (
    <main class="mx-auto w-full max-w-6xl flex-1 px-6 py-16">
      <div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {rows.map((post) => (
          <a key={post.id} href={`/blog/${post.slug}`} class="rounded-lg border border-border bg-card p-6 transition-colors hover:bg-accent">
            <img src={post.cover} alt="" class="mb-4 aspect-video w-full rounded-md object-cover" />
            <h2 class="font-semibold">{post.title}</h2>
          </a>
        ))}
      </div>
    </main>
  );
}
```

- **`select` the fields you render, nothing else** - every `dry()` result is
  also embedded in the page HTML for hydration, so unselected fields are
  bytes every visitor downloads for nothing.
- **Images**: an `image` field stores a bare storage id, and `src`/`poster`
  on `img`/`video`/`audio`/`source`/`track` are resolved automatically. A
  storage id in a CSS `background-image` is **not** resolved - use a real
  `<img>`.
- **VEI**: a `select: true` field rendered plainly (`{post.title}`,
  `src={post.cover}`) is auto-marked inline-editable. Don't add `dryBind`
  for those. Reach for it only when the value went through a transform, is
  a non-string type, or is passed down into a nested component.
- A transformed field (`excerpt: (v) => v.slice(0, 120)`) is **not**
  inline-editable - use `true` for anything an admin should edit in place.
- A `[slug]` route only becomes real pages if the page file itself
  literally contains `await dry().collection("x").get(params.slug as string)`.
  Hiding it behind a variable or helper leaves the route unresolvable.

## Verify before calling it done

1. `bun run dev &` → public site at `http://localhost:5173/` (admin at
   `/dry`). Edits under `.dry/pages-source` are live, no build step.
2. `bun run typecheck` - `.dry/pages-source/**/*.tsx` is in `tsconfig.json`
   on purpose, so type errors here are real errors.
3. Check the page at a narrow width **and** in both themes (the
   `ThemeToggle` in the starter header) - a hardcoded colour only shows up
   as a bug in one of the two.
4. Dev is not live. Reaching the deployed site needs a **Build** from the
   admin's Page Editor / Page Builder (`/dry/page-builder`). Say so when
   handing work back; don't claim the change is live.

## Checklist

- [ ] Read `md/README.md` + `md/components.md`, reused an existing
      `@component/*` instead of duplicating markup.
- [ ] No import outside preact / `@component/*` / relative.
- [ ] No hook inside an `async` component.
- [ ] Colours are tokens, not literals; verified in light **and** dark.
- [ ] `key` on every mapped list; `<a href>` for navigation.
- [ ] Page root has `flex-1`; width clamped with `max-w-* px-6`.
- [ ] New component exports `defaultProps` (or `_view`) and is listed in
      `md/components.md`.
- [ ] `bun run typecheck` clean.
