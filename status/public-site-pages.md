# Public site pages (Home/About/Blog/Contact)

## Plan

Build the site's 4 public pages under `src/apps/pages/**` (App Router, see
`docs/APP-ROUTER.md`) for a personal-brand HIV/ARV outreach blog: Home,
About, Blogs (list), Contact. UI shell only — Tailwind, real Vietnamese
structural labels, Lorem ipsum for body copy, no `dry()` data binding yet
(user will wire real content later). Deleted the old `/users` + `/roles`
App Router demo pages per user request (no longer needed).

## Status

Done. `src/apps/pages/layout.tsx` (header nav + mobile toggle + footer with
phone/email/fanpage), `page.tsx` (home), `about/page.tsx`, `blogs/page.tsx`
(search/filter UI shell, no working filter logic yet), `contact/page.tsx`
(contact channels + form shell, no submit handler). Typecheck clean.
Verified all 4 routes with Playwright (screenshots + console/pageerror
capture, desktop + mobile, both before/after hydration) — zero errors.

Hit one real bug during QA: the dev server (already running from a prior
session, PID 9899/9897) was serving a stale Tailwind-compiled CSS for
`/src/apps/globals.css` that predated these new files' classes — new
utilities like `.h-4`/`sm:max-w-xs` were missing, blowing up the blogs
page's search icon to fill the page. Root cause looked like a JIT
candidate-scan gap for SSR-only-imported modules (`page.tsx`/`layout.tsx`
are loaded via `vite.ssrLoadModule`, a separate graph from the client one
Tailwind's scanner tracks). Restarting `bun run dev` fixed it immediately
(fresh Playwright context, 0 errors, correct icon size). Worth remembering
if a similar "class not applying" symptom shows up again on a freshly
created `src/apps/pages/**` file — restart the dev server before spending
time on the CSS/markup itself.

## Speed

Single session, complete.
