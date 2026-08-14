# Plan

- Trace the Page Builder pipeline and current 404/500 fallback behavior.
- Publish root `404.tsx` and `500.tsx` as live built HTML artifacts.
- Remove production request-time rendering/importing through `src/apps/pages/**`.
- Add focused tests and run relevant verification.

# Status

- Complete: Build all now includes `/404` and `/500` targets sourced from
  root `404.tsx`/`500.tsx`, excluded from the sitemap.
- Complete: production serves those live artifacts with their HTTP error
  status and no longer renders fallback modules at request time.
- Complete: removed the `src/apps/pages/**` Vite-glob discovery path;
  live-source route loading remains dev-only.
- Verified with 39 focused tests, TypeScript, and a full Worker build.

# Speed

- Completed without blockers.
