# App Router (`src/apps/pages/**`)

A Next.js-App-Router-style file router for the site's own public content
pages - not the admin UI (`src/pages/` + [DESIGN.md](DESIGN.md), a
completely different, hand-rolled-CSS design system; never mix the two).
Read this before creating or editing anything under `src/apps/pages/**` or
`src/apps/globals.css`. Full design background: `plans/app-router.md`,
execution log: `status/app-router.md`.

## File conventions

- A folder's name is a path segment. `layout.tsx` and `page.tsx` are the
  only two special filenames.
  - `page.tsx` - the routable content for that path. A folder with only a
    `layout.tsx` (no `page.tsx`) is not itself visitable, only its children
    are.
  - `layout.tsx` - wraps every route under it, nested outward-in (root
    layout outermost). Always wraps; there's no way to opt a route out of
    an ancestor layout.
  - `[slug]/` - dynamic segment, available as `params.slug: string`.
  - `[...rest]/` - catch-all, available as `params.rest: string[]`
    (remaining path segments, in order). Only one per branch.
  - Priority when segments could match more than one pattern: static name
    > `[dynamic]` > `[...catchAll]`.
- Both `page.tsx` and `layout.tsx` are `export default async function`:
  ```tsx
  export default async function Page({ params }: { params: Record<string, string | string[]> }) {
    const post = await dry().collection("post").get(params.slug as string);
    return <article>{post?.title}</article>;
  }
  ```
  ```tsx
  export default async function Layout({ children, params }: { children?: unknown; params: Record<string, string | string[]> }) {
    return <section>{children as never}</section>;
  }
  ```
  `params` is a normal prop, never a global.

## `dry()` - reading content

`dry()` is an ambient global inside this directory - **don't import it**,
a Vite plugin (`src/server/app-router/app-router-plugin.ts`) injects the
right implementation automatically (the real DB-backed one on the server,
a replay-from-already-fetched-data one on the client during hydration -
you never need to think about this distinction, just call `dry()`).

```ts
await dry().collection("user").get(idOrSlug);   // number = id, string = slug
await dry().collection("user").list({ where, sort, page, pageSize });
await dry().singleton("settings").get();
```

Always published-only (no draft/scheduled rows, no override) - this is
intentional, not a bug to work around. **Check
`src/apps/dry.generated.d.ts`** for the real, current collection/singleton
names and field shapes before writing a `dry()` call - it's generated from
the live schema, don't guess field names.

### `list({ select })` - ask for the fields you render, and nothing else

Every `dry()` result is ALSO embedded in the page's HTML (the replay log
`src/apps/hydrate-client.ts` re-runs this page against - that's what makes
hydration work without a second round trip). So a listing page that fetches
20 fields per row and renders 4 makes every visitor download the other 16.
`select` is how you stop that:

```tsx
const { rows } = await dry().collection("blog").list({
  sort: { field: "date", dir: "desc" },
  select: {
    title: true,                            // as stored
    slug: true,
    excerpt: (value) => value.slice(0, 120), // or transformed
  },
});
// rows[0] is { id, title, slug, excerpt } - typed to exactly that, so
// touching rows[0].content is a compile error, not a silent undefined.
```

- **Omit `select` entirely and you get every field, exactly as before** - it
  is purely opt-in; no existing call changes behavior.
- `id` always comes back.
- A `true` field is returned as stored. A function receives that field's
  stored value and returns whatever you want in its place - it runs once,
  server-side, and its **result** is what ships, so it must return something
  JSON-serializable (`Date` is fine). Don't return a VNode.
- Unselected fields are never fetched: no column in the `SELECT`, and no
  child-table query for an unselected repeatable component or multi-valued
  relation (those cost one query per row).
- `where`/`sort` still work on fields you didn't select - they're resolved
  in SQL, not from the returned row.
- One caveat for [VEI](../plans/vei.md) inline editing: a field you
  transformed is not inline-editable (the rendered text isn't what's in the
  DB). Use `true` for fields an admin should be able to edit in place.

## The one rule that matters: `async` = data, `sync` = interactive

**A component using `useState`/`useEffect`/any hook must NOT be `async`.**
This isn't a style preference - it throws at runtime. Confirmed by a real
spike (see `plans/app-router.md`'s "Client hydration" section): Preact
hooks only work inside a component Preact itself dispatches through its
normal render path, and an `async function`'s returned `Promise` can never
go through that path directly (both `preact-render-to-string` server-side
and the hydration bootstrap resolve `page.tsx`/`layout.tsx` by calling them
as plain functions first, specifically to get past this).

So: `page.tsx`/`layout.tsx` (and any other `async` component) fetch data
via `dry()` and render - never call a hook in one. If a piece of UI needs
state or an event handler, pull it into a separate **plain, synchronous**
component and pass it whatever data it needs as props:

```tsx
// Ordinary sync component - hooks work fine here.
function AddUserButton() {
  const [toggle, setToggle] = useState(false);
  return <button onClick={() => setToggle(!toggle)} class={toggle ? "..." : "..."}>Add User</button>;
}

// async - fetches data, renders the sync component, never calls a hook itself.
export default async function UsersListPage() {
  const { rows } = await dry().collection("user").list();
  return (
    <main>
      <AddUserButton />
      {rows.map((u) => <p key={u.id}>{u.name}</p>)}
    </main>
  );
}
```

This sync component gets real client-side interactivity for free - it's
part of the same tree the client hydration bootstrap (`src/apps/hydrate-
client.ts`) reconstructs and calls `preact-iso/hydrate` on. See
`src/apps/pages/users/page.tsx` for the working example this pattern is
based on.

## Styling - Tailwind utility classes only

`src/apps/globals.css` (`@import "tailwindcss";`, nothing else) is the
**one** shared stylesheet for this whole directory - write Tailwind
utility classes directly in JSX (`class="flex gap-4 text-blue-600"`), never
a per-component `.css` file (that's the admin's [DESIGN.md](DESIGN.md)
convention, not this one). Don't add a second CSS entry point for a
"special" page without a real, specific reason - see
`plans/app-router.md`'s "CSS: 1 file chung" for why that was considered
and rejected.

## Navigation - plain links, no client router (MPA)

Every page transition is a real browser navigation (`<a href="/users">`),
each one a fresh server render (`plans/app-router.md`'s "Quyết định:
MPA"). Don't reach for a client-side router or `preact-iso`'s
`LocationProvider`/`Router` here - that's the admin SPA's pattern
(`src/routers/App.tsx`), a deliberately different model for a deliberately
different app.

## What `render.ts` owns - don't fight it

`page.tsx`/`layout.tsx` return **inner content only** - never `<html>`,
`<head>`, or `<body>`. `src/server/app-router/render.ts` owns the outer
document (doctype, `<head>` with the CSS link + hydration script, `<body>`
open/close, the `dry()` replay data + isodata hydration markers). A layout
that renders its own `<html>` produces literally invalid, doubled markup -
this has happened once already in this repo, don't repeat it.

## Not built yet (Giai đoạn 4, ask before assuming these exist)

- No preview/draft mode - `dry()` is always published-only, no session-gated
  override.
- No custom 404/error page (`not-found.tsx`-style) - unmatched routes get a
  plain-text 404.
- No per-page `<title>`/meta tags yet - the `<title>` is fixed, set once in
  `render.ts`.
