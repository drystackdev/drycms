# Plan

- Isolate executable Page Builder previews from the admin origin without breaking navigation/save/VEI messaging.
- Enforce Page Builder permission for page-source reads and avoid unauthorized client fetches.
- Add a production-safe Content Security Policy to admin/API responses.
- Add regression coverage and run focused tests, typecheck, and HTTP checks.

# Status

- Preview frames now use an opaque-origin sandbox and exchange the document title through the existing source-checked message bridge.
- Page-source GET/POST/PUT/PATCH/DELETE now all require the Page Builder grant; the Page Builder hook no longer fetches source when denied.
- Admin shells now emit a CSP in dev, Node production, and Workers.
- Regression tests added. Full suite (1,419 tests), focused security suite, typecheck, and production build all pass.
- Production smoke check confirms the admin CSP header and anonymous page-source rejection.
- Follow-up: restored preview hydration under the opaque sandbox by mapping unsaved modules to `data:` URLs and allowing CORS from serialized origin `null` only on public JS/built assets. The sandbox still has no `allow-same-origin`.
- Follow-up 2: `ThemeToggle.tsx` still threw on `localStorage.setItem()` inside the opaque frame. Preview documents now receive isolated, in-memory Storage-compatible `localStorage`/`sessionStorage` shims; no admin storage is exposed. Dev server restarted with the new Vite headers.
- Follow-up 3: Vite's CORS middleware overwrote the static header on transformed and 304 `/src/**` module responses. `server.cors.origin` is now explicitly `null`; verified both 200 and conditional 304 responses, plus every module URL reported by the browser console.
- DevTools performance: preview data-module URLs use compact base64 instead of percent-escaped source. The preview keeps its own `/@vite/client`, because its hydrate dependency graph is separate from the admin graph and needs HMR.
- External source editing: page-source filesystem saves now emit a semantic Vite HMR event. Public pages/Page Editor retain reload behavior; Page Builder refetches and rebuilds preview in place while preserving any locally dirty buffer.
- External-edit fallback: page-source file responses are `private, no-store`; Page Builder dev also checks a no-store source snapshot every second for tabs that missed HMR across a server restart. Identical snapshots retain state identity, so they do not trigger preview rebuilds.
- External-edit merge fix: stale state is no longer inferred to be a local dirty buffer merely because it differs from an older server snapshot. Only paths explicitly changed through Page Builder's own editor are protected from external saves; regression coverage added.

# Speed

- Complete. Browser UI automation was unavailable; verification used unit/integration tests, typecheck, production build, and direct HTTP checks.
