# Plan

- Reproduce the VEI failure under `dev` and `dev:worker`.
- Trace live source compilation, component path resolution, and shared Preact runtime loading.
- Fix the root cause for both targets and add regression coverage.
- Run focused tests, typecheck, and browser verification in both environments.

# Status

- Root cause confirmed: VEI evaluated page components with `page-build.ts`'s bundled Preact while hydrating with `vei-live-refresh.ts`'s separately resolved Preact.
- VEI now imports the standalone runtime advertised by `/api/asset-hrefs` and injects that same runtime into module evaluation and hydration.
- Candidate resolution now only emits valid `.tsx`/`.ts` source paths, and live closure loading uses the already-fetched tree to avoid expected-probe 404s.
- A cached page's `hydrate-built` pass now skips itself for `edit:true`; VEI live refresh is the sole renderer, removing the dev-only `preact-runtime.js` versus `?import` race seen in the running server log.
- Verification complete: focused suites pass (37 tests), typecheck passes, production Worker build passes, and `dev:worker` boots successfully on port 8787 with `/` and `/dry` returning 200.
- Browser click-through could not be repeated because no browser instance was available to the session; the already-open dev tab/server log did reproduce the original hooks stack and confirmed the extra built-hydration path addressed by the fix.

# Speed

- Complete. Browser UI QA unavailable; build/runtime verification completed for both targets.
