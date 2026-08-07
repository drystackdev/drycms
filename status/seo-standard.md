# Standard SEO cho từng trang (tự động)

## Plan

See `/Users/kcoder/.claude/plans/jolly-riding-lightning.md` for the full
approved plan. Summary: extend the existing SEO cascade
(`src/content-types/dry-seo.ts`) with `noIndex`, canonical URL, full Open
Graph, Twitter Card, `<html lang>`, JSON-LD structured data, an auto
`sitemap.xml` (static pages + published seo+slug collection entries via a
new `seoUrlPattern` field), and `robots.txt`. Site origin for absolute URLs
comes from a new `APP_DOMAIN` env var, falling back to the request's own
origin when unset.

5 phases:
1. `noIndex` field + cascade + context fields + `seoEntryDates`
2. `site-origin.ts` + `APP_DOMAIN`/`lang` config
3. `render.ts` tag/JSON-LD rewrite + `page-handler.ts` seeding
4. `seoUrlPattern` field + admin UI
5. `sitemap.ts` + `staticPagePaths` + route interception

## Status

All 5 phases done and verified (`bun run typecheck` clean, new/updated tests
pass). Implemented: `noIndex` cascade field on the `seo` component; canonical
URL, `robots` meta, full Open Graph (`og:type`/`og:url`/`og:site_name`),
Twitter Card, `<html lang>`, and JSON-LD (`WebSite`/`Organization`/`Article`)
in `render.ts`; `APP_DOMAIN`-with-request-origin-fallback via
`site-origin.ts`; `seoUrlPattern` field + admin UI in `ContentTypeEditor.tsx`
for mapping a collection's entries into `sitemap.xml`; `/sitemap.xml` and
`/robots.txt` intercepted in `page-handler.ts`, served by the new
`sitemap.ts`.

**Known limitation, confirmed by hitting it while testing**: this repo's own
`dry.seed.json` (an app-specific packaged seed) freezes the shared `seo`
component's shape from whenever it was last snapshotted via
`bun run build:schema` - it currently predates this change, so the LIVE dev
DB's `seo` component doesn't have `noIndex` yet, and `migration.ts`'s
`SavePlan.cascaded` (auto-propagating a component change to dependent
tables) doesn't reach a `features.seo`-driven embed either (that reference
is synthetic, never a real `fields[]` entry `findDependents` can see) - so
`seoDefaults` and any other already-existing seo-enabled type need the field
added by hand once, through the Content Type Editor (open the hidden `seo`
component, add "Hide from search engines", Apply and build), same as any
other schema change to an already-seeded install. `dry.seed.json` itself
should also be regenerated (`bun run build:schema`) after that so a fresh
install picks it up too.

Also note: a concurrent session was actively editing
`src/pages/Dashboard.tsx`/`MagicChat.tsx`/`AiSchemaWizardPanel.tsx` during
this work; an external commit (`7fedbe4`, not made by this session) landed
mid-task bundling both feature sets together - nothing was lost, but the SEO
changes above aren't cleanly isolated in their own commit on the branch.

## Speed

Done in one session.
