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

## Follow-up (same session)

Added a real hero photo (`public/image.JPG`, already committed) to the Home
page: `Mai Anh Quyền` as the real name/tagline (only real content on the
site so far - everything else stays Lorem per the original plan), photo in
a `sm:w-2/5` flex column with an inline-style CSS `mask-image` (two linear
gradients + `mask-composite: intersect`) fading its left+top edges into the
`bg-teal-50` hero background. Verified the fade is a real smooth gradient
via Python/Pillow pixel sampling on a screenshot, not just eyeballing - a
full-page screenshot downscaled in chat display made a genuine ~150px
gradient look like a hard edge, which cost real time to chase down as a
false lead before the pixel check settled it.

Also added: `blogs/posts-data.ts` (shared placeholder post data, `slug`
field added) so the blog list and new `blogs/[slug]/page.tsx` detail page
reference the same data instead of duplicating it; "Đọc thêm" cards on
`/blogs` now link to real detail pages. About page got a "Bài báo nói về
tôi" (press mentions) card grid near the bottom (external links, `href:
"#"` placeholders, `[Tên báo/tạp chí]` outlet placeholder - no real articles
provided yet).

## Follow-up 2 (same session)

Hero mask widened to fade left+right+top (bottom stays sharp, by design -
it meets the value-props block below). Three-layer `mask-image`
(`to right`/`to left`/`to bottom` gradients) with `mask-composite:
intersect`, percentages 35/15/25. Verified with a tight crop screenshot
(not just pixel-sampling this time) - visibly smooth on all three edges.

Added a muted/looping/autoplaying `<video>` background section
(`public/video_16x9_480_noaudio_trimmed.mp4`) between the value-props and
"Bài viết mới nhất" sections on Home - `autoPlay muted loop playsInline`,
dark scrim overlay + centered Lorem heading/CTA. Confirmed actually playing
(not just present) via `video.paused`/`currentTime` in a live page, not
just a screenshot - a static shot can't tell autoplay from a stalled
first frame.

About page's placeholder square swapped for the real photo
(`public/IMG_8153.JPG`, `object-cover object-top`); "[Tên của bạn]" also
updated to the real name for consistency with the photo now sitting next
to it (was an obvious mismatch otherwise).

Note: `page.goto(..., { waitUntil: "networkidle" })` hangs/times out on any
route with the autoplay video - the looping video keeps issuing range
requests so network never goes idle. Use `waitUntil: "load"` (+ a short
explicit wait if needed) for any future Playwright check that touches the
Home route.

## Speed

Single session, complete. Hero photo blend took several iterations (object-
cover crop → object-contain letterbox → color-matched overlay divs → CSS
mask) before landing on the mask approach; the overlay-div version is what
the user's screenshot caught as a hard edge, which is what motivated the
switch.
