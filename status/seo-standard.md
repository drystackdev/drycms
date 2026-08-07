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

Starting phase 1.

## Speed

Just started.
