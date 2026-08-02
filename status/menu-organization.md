# Dashboard menu organization

## Plan

- Group the sidebar navigation into clear sections without changing routes or permissions.
- Add compact section styling that remains usable when the sidebar is collapsed.
- Run typecheck/build and inspect the rendered navigation in both themes.

## Status

- Implemented grouped sections in `DryLayout.tsx`; routes, active states, dynamic content types, and role filtering remain unchanged.
- The `Content` row now toggles its own submenu and the submenu uses a height/opacity transition for open/close.
- Replaced the single Content dropdown with independent Collection and Singleton dropdowns using the existing Solar `Collection` and `Singleton` icons; each filters content types by `kind`.
- Added a right-aligned yellow `admin` badge with the Solar users-group icon to `superAdminOnly` navigation items.
- Marked Users, AI Keys, Content Types, Custom Components, and Icon Management as admin-only navigation items.
- `bun run typecheck` and `bun run build` pass. Browser visual QA is pending because no browser surface is available in this session.

## Speed

- Implementation complete; visual QA is the only environment limitation.
