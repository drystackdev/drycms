# Homepage content type + seed tooling

## Plan
1. `scripts/lib/content-seed.ts` — reusable helpers (`upsertContentType`,
   `writeSingletonEntry`, `insertCollectionEntry`) built on
   `createContentEngineAdapter`/`createContentEntryEngineAdapter`, same
   standalone-bun-script pattern as `scripts/seed-sync.ts`/`dry-generate.ts`.
2. A project skill documenting the general workflow: read a hardcoded
   `src/apps/pages/**` section -> design `ContentTypeDefinition`(s)
   (component/collection/singleton) -> write a data file -> run via the
   library -> wire `dry()` into the page.
3. `scripts/seed-pages-content.ts` — concrete usage: defines 7 component
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
Done. `bun run seed:pages` creates/reconciles all 9 content types and seeds
the homepage singleton + 6 blog posts; `page.tsx`, `blogs/page.tsx`, and
`blogs/[slug]/page.tsx` all read live via `dry()` now. Typecheck clean;
verified rendered output for `/`, `/blogs`, and `/blogs/<slug>` via curl
against the running dev server - real CMS copy shows up in place of the old
hardcoded arrays. `posts-data.ts` deleted (no longer referenced);
`press-data.ts` kept - `about/page.tsx` still imports it (out of scope,
not touched).

## Speed
Single session, no blockers. Dev server was already running on :5173
(started by an earlier/other session).
