# Redirect collection, slug-lock, auto-301, 404/500 pages

## Plan

See `/Users/kcoder/.claude/plans/inherited-soaring-owl.md` for the full approved plan.
Summary:

1. New `redirect` system content type (`hidden/locked/frozen`, `from`/`to` fields) in
   `src/content-types/seed.ts` + nav entry in `DryLayout.tsx`.
2. `SlugField.tsx`: `slugTouched` initializes from whether `slug` starts non-empty, so
   editing an existing entry's Title no longer silently rewrites its Slug.
3. `src/content-types/redirects.ts`: `recordSlugRedirect` - create/update/delete-stale
   logic - wired into `content-entries.ts`'s `PUT` handler (collection + singleton).
4. App Router: `route-tree.ts` recognizes root-level `404.tsx`/`500.tsx` as fallback
   slots; `render.ts`'s `renderPage` becomes async with `status`/`onRenderError`
   options + a standalone `renderErrorPage` helper; `page-handler.ts` does the
   last-path-segment redirect lookup on a route miss, then falls back to rendering
   `404.tsx` (full pipeline) or `500.tsx` (standalone, on render error).
5. `src/apps/pages/404.tsx` (full layout) and `500.tsx` (standalone, no `dry()`).

## Status

Done. All 6 parts implemented, tested, and manually verified against the live
dev server:

1. `redirect` system content type (hidden/locked/frozen, `from`/`to`) added
   to `seed.ts`'s defaults; nav entry in `DryLayout.tsx`.
2. `SlugField.tsx`'s `slugTouched` now initializes from whether `slug` is
   already non-empty - editing an existing entry's Title no longer silently
   rewrites its Slug (only the regenerate button, or typing into Slug
   directly, does).
3. `src/content-types/redirects.ts`'s `recordSlugRedirect` (create/update-in-
   place/delete-stale-shadow), wired into `content-entries.ts`'s `PUT`.
4. **Design correction found during testing**: the redirect lookup can't be
   gated on `matchRoute` returning null - a dynamic `/blogs/[slug]` route
   matches ANY slug syntactically, valid or not, so a renamed post's old URL
   never reaches a "no match" branch at all. Fixed by running the redirect
   check unconditionally, before routing, on every request. Broadens the
   accepted last-segment-collision trade-off slightly (now applies to any
   path, not just genuine route misses) - flagged to the user.
5. `route-tree.ts` recognizes root-level `404.tsx`/`500.tsx`; `render.ts`'s
   `renderPage` gained `status`/`onRenderError` (kept fully backward
   compatible with the existing sync/streaming contract - `render.test.ts`
   still passes unmodified in its original assertions) plus a standalone
   `renderErrorHtml` helper; `page-handler.ts` wires redirect-lookup + 404
   (full pipeline, root layout) + 500 (standalone, no `dry()`) fallbacks.
6. `src/apps/pages/404.tsx` + `500.tsx` added.

Verification: `bun run typecheck` clean, `bun run test` 825/825 passing
(79 files). Manually verified end-to-end against the running dev server
(`bun run dev`) using the real dev DB: created a throwaway blog entry via the
authenticated API, renamed its slug, confirmed a `redirect` row was created,
confirmed the OLD `/blogs/<old-slug>` URL 301s to the new one, confirmed
`/blogs/<new-slug>` renders 200, and confirmed a nonexistent path renders the
real `404.tsx` at status 404. Also drove the real admin UI with a throwaway
Playwright script (not committed) to confirm the SlugField fix in-browser:
editing Title on an existing entry leaves Slug untouched; the regenerate
button still updates it. All throwaway data (entry + redirect row) was
deleted afterward - dev DB confirmed back to its original 6 blog entries / 0
redirects.

Known, accepted limitations (documented in code comments, not fixed - out of
scope for this task):
- A render failure *after* `<head>` has already streamed can't recover the
  HTTP status code (same limitation every streaming-SSR framework has) -
  only a failure before that point gets a clean status.
- A static `404.tsx`/`500.tsx` with no interactive islands hydrates fine as
  static markup; one that added `useState`/etc. would stay inert client-side
  (the client's own route-matching can't distinguish "real 404" from "server
  rendered the notFound/redirect fallback for this URL").

## Speed

Single session, completed in one pass. The redirect-matching design
correction (item 4 above) was caught during manual verification, not
planning - worth remembering for any future work in this area.
