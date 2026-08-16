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

# Speed

- Complete. Browser UI automation was unavailable; verification used unit/integration tests, typecheck, production build, and direct HTTP checks.
