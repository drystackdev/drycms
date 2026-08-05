# Homepage content type + seed tooling

## Plan

1. `scripts/lib/content-seed.ts` - reusable helpers (`upsertContentType`,
   `writeSingletonEntry`, `insertCollectionEntry`) built on
   `createContentEngineAdapter`/`createContentEntryEngineAdapter`, same
   standalone-bun-script pattern as `scripts/seed-sync.ts`/`dry-generate.ts`.
2. A project skill documenting the general workflow: read a hardcoded
   `src/apps/pages/**` section -> design `ContentTypeDefinition`(s)
   (component/collection/singleton) -> write a data file -> run via the
   library -> wire `dry()` into the page.
3. `scripts/seed-pages-content.ts` - concrete usage: defines 7 component
   types (heroSection, valueProp, videoSection, latestPostsSection,
   pressSection, pressMention, bottomCta) + `homepage` singleton, and a
   `blog` collection (features.slug, tag/excerpt/date/content) - seeds real
   data copied from `page.tsx`'s hardcoded arrays, `posts-data.ts`,
   `press-data.ts`.
4. Run the script against the live `.dry/content.sqlite`, `bun run
dry:generate`, then wire `page.tsx` / `blogs/page.tsx` /
   `blogs/[slug]/page.tsx` to `dry()` reads instead of hardcoded arrays.

Scope decided with user: ALL 6 homepage blocks (hero, value props, video
CTA, latest posts, press mentions, bottom CTA). Hero fields are exactly
`eyebrow/title/subtitle/content` as literally requested - CTA buttons +
hero image stay hardcoded in the template (not requested).

## Status

Done - extended to the whole public site, not just the homepage. `bun run
seed:pages` now creates/reconciles content types and seeds data for:

- `homepage` singleton (hero/valueProps/videoSection/latestPostsSection/
  pressSection/pressMentions/bottomCta)
- `blog` collection (6 posts)
- `about` singleton (intro/story/missionSection+missionItems/
  experienceSection+experienceItems/pressSection/pressMentions/bottomCta)
- `contact` singleton (header/channels - the form itself stays static, not
  content)
- `siteSettings` singleton (brandName/headerCta/footerDescription/phone/
  email/fanpageUrl/copyrightText - `layout.tsx`'s header+footer chrome)

`page.tsx`, `blogs/page.tsx`, `blogs/[slug]/page.tsx`, `about/page.tsx`,
`contact/page.tsx`, and `layout.tsx` all read live via `dry()` now.
Typecheck clean; verified rendered output for every route via curl against
the running dev server.

Deliberately NOT content-managed:

- `NAV_LINKS` in `layout.tsx` stays hardcoded - the built-in `menu`/
  `menuItem` types require an absolute URL for `href` (entry-validate.ts's
  `new URL(value)` check), which relative in-app routes ("/", "/about", ...)
  fail; nav structure is also route structure, not copy an editor should
  freely retype.
- The contact page's actual `<form>` fields (static, no data).
- Hero's CTA buttons + hero image, and about's intro image path - kept as
  plain hardcoded/text-path values (never wired to the real Image/Media
  field type - see `scripts/seed-pages-content.ts`'s `aboutIntro.image`
  field, a `text` field storing a path string, not a real `image` field).

`posts-data.ts` and `press-data.ts` both deleted (no longer referenced by
anything after the migration).

## Speed

Single session, no blockers. Dev server was already running on :5173
(started by an earlier/other session).
