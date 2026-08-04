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

## Follow-up 3 (same session)

Hero image resized 2/5 → 1/2 width. That widened box changed
`object-contain`'s fit-by-width/fit-by-height outcome enough to reintroduce
a top-fade bug: the image was letterboxed (empty gap above the photo,
`object-bottom`), and the top `mask-image` gradient landed inside that
already-invisible gap instead of over real pixels, so the actual photo
edge still cut in sharply right where the gap ended. Fixed at the root -
gave the image box a fixed `aspect-4/3` (matching the source photo's real
ratio) instead of stretching it to the row height, switched to
`object-cover`, and changed the row from `items-stretch` to `items-end`.
Zero letterboxing now, so the mask fades real pixels on all three edges
(verified again via Pillow pixel sampling - background color bleeds in
gradually starting right at the image's own top edge). Lesson: a
percentage-based edge mask on an `object-contain`ed image is only reliable
when the box's aspect ratio matches the image's own - otherwise the
"blank" and "faded" regions can silently swap depending on viewport width.

Added a "Bài viết liên quan" (related posts) block on the blog detail page,
below the contact CTA - up to 3 posts sharing the same `tag`, self-hides
when none exist.

Full color re-theme: teal → deep red ("đỏ đô") across all 5 pages, to match
the hero photo/video's red event-backdrop tone. Word-boundary-safe Perl
substitution (not naive string replace - `teal-50` is a literal prefix of
`teal-500`, so an unguarded replace would have corrupted it) with an
intentionally non-linear shade map: light tints kept their position
(`teal-50`→`red-50`, `teal-100`→`red-100`, `teal-300`→`red-300`) but the
primary/accent shades shifted two steps darker (`teal-600`→`red-800`,
`teal-700`→`red-900`, focus-ring `teal-500`→`red-600`) - a straight 1:1
hue swap onto `red-600`/`red-700` would have read as bright alert-red, not
the deep burgundy "đỏ đô" that was asked for.

## Speed

Single session, complete. Hero photo blend took several iterations (object-
cover crop → object-contain letterbox → color-matched overlay divs → CSS
mask → aspect-ratio fix for a resize regression) before landing on the
final version; each visual bug in this thread was caught by the user
looking at a real screenshot, not by my own review, worth being more
skeptical of "looks done" going forward.
