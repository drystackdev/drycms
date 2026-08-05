# Reader: draft/schedule confirmation + SEO cascade

## Plan

See `plans/reader.md` + `plans/app-router.md`'s deferred "`<head>`/metadata
per-page" item. Full design in the approved plan (this session):
- Draft/schedule gating (`entry-where.ts`'s `buildPublishedOnlyClause`) was
  already built and tested - confirmed live, no code change needed.
- SEO cascade: `features.seoDefault` flag (marks the one site-wide default
  singleton) + `DrySeoLayers` (3 independent slots: default/singleton/entry,
  filled as a side effect of `dry()`'s `get()` calls) + `mergeSeoLayers`
  (fixed Default < Singleton < Entry priority, applied once at render time)
  + `render.ts` builds real `<title>`/meta tags after `resolveMatchToVNode`
  resolves (moved from the old immediate/static head enqueue).

## Status

**Done (2026-08-05).**

- `src/content-types/types.ts` - `+features.seoDefault`.
- `src/pages/content-type-editor/FeaturesFieldset.tsx` - +1 toggle
  (singleton only).
- `src/content-types/dry-seo.ts` - new, pure (`DrySeoValue`, `DrySeoLayers`,
  `seoTierFor`, `mergeSeoLayers`).
- `src/content-types/dry-context.ts` - `+seo?: DrySeoLayers`.
- `src/content-types/dry-reader.ts` - both `get()`s record their layer
  (`list()` deliberately doesn't).
- `src/storage/http-source.ts` - `+resolveImageSrc` (moved from
  `src/apps/pages/lib/image-url.ts`, now a 1-line re-export).
- `src/server/page-handler.ts` - auto-seeds the Default layer from whichever
  singleton has `features.seoDefault` (generic, not name-hardcoded).
- `src/server/app-router/render.ts` - head is now built (and enqueued)
  after `resolveMatchToVNode` resolves (was: immediately, static).
  `render.test.ts`'s streaming-order test rewritten on purpose - the
  underlying behavior it locked in is exactly what changed.
- Tests: `dry-seo.test.ts` (new, 9 cases), `dry-reader.test.ts` (+6 seo
  cascade cases, real sqlite round-trip), `render.test.ts` (+2 seo cases,
  rewrote the streaming-order one). `bun run typecheck` and `bun run test`
  (717 tests) both green.
- Live data: `homepage`/`about`/`contact`/`blogsPage` given `features.seo`,
  `seoDefaults` given `features.seoDefault` too - applied via the real
  content-types API (`mode: "apply"`, same path the admin UI's "Apply and
  build" uses), authenticated with the real dev super-admin account (see
  memory `project_drycms_dev_admin_credentials` - no browser/Playwright
  tool was available this session, so a small script drove the HTTP API
  directly instead).
- End-to-end verified against the running dev server (curl, real HTML, not
  devtools): `/`, `/about`, `/contact`, `/blogs` all pick up `seoDefaults`'
  real title/description by default; `/about` overrides after its own SEO
  fields were set (Singleton beats Default); a `blog` entry's own SEO
  overrides too (Entry beats Default). Draft/schedule live-gating wasn't
  re-verified against `blog` specifically - that type has neither feature
  enabled - but is covered by `dry-reader.test.ts`'s existing (unmodified)
  cases.

## Speed

Single session, no blockers. Scope stayed within the approved plan - no
follow-up work identified.
