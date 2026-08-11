# Plan

- Trace RichText paste/import and entry-scoped upload flows.
- Detect pasted image files and remote image URLs, then queue them for confirmation.
- Show one confirmation dialog per image; upload into the entry scope and replace the image node source.
- Sanitize pasted HTML styles to the RichText-supported CSS vocabulary.
- Keep the RichText toolbar sticky immediately below the admin topbar.
- Add focused tests and run unit tests/typecheck.

# Status

- Architecture and project conventions reviewed.
- Paste detection, sequential confirmation, entry-scoped file/URL import, source replacement, and style cleanup implemented.
- Toolbar sticky positioning implemented without turning the richtext wrapper into a competing scroll container.
- Fixed new-entry media appearing empty: hidden `.tmp.*` scopes now fall back to a direct folder listing.
- Paste style cleanup now validates supported values as well as property names.
- Full suite run: 1025 tests pass; 16 unrelated seed/schema tests fail because the current packaged app seed adds types those tests do not expect.
- Focused storage/RichText tests pass (71 tests), and the production build succeeds.
- Typecheck still reports only pre-existing generated Blog schema/page mismatches; no changed file appears in its diagnostics.
- Visual light/dark browser QA could not run because no in-app or connected browser session was available.

# Speed

- Implementation complete. Browser screenshot/computed-style QA remains unavailable in this environment.
