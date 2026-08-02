# Plan

- Restore the separate singleton permission block in New/Edit Role.
- Add explanatory descriptions to permission switches and singleton switches.
- Run typecheck, tests, build, and UI QA where the environment allows it.

# Status

- Complete: collection permissions remain in the per-resource accordion.
- Complete: singleton permissions now render in a separate `Singletons` fieldset as `CheckField` switches using the `setting` permission.
- Complete: action descriptions and content-type descriptions are shown below each switch.
- Complete: removed the seeded `permission` content type/table and row-sync adapters; roles now store metadata-derived `<contentTypeId>:<action>` keys.
- Complete: the Role editor keeps a virtual `Permission` system resource grantable without recreating its table.
- Complete: authenticated session data now exposes current access keys for UI hints; navigation, entry lists, editors, and Role editor honor view/create/update/delete/setting access while server CRUD checks remain authoritative.
- Complete: collapsed Collection/Singleton navigation now opens a right-side popup so accessible content types remain selectable.
- Verified: `bun run typecheck`, `bun run test -- --run`, and `git diff --check` pass.
- Blocked for this session: browser visual/computed-style QA could not run because no browser backend is available.

# Speed

- Small focused UI change; implementation and automated verification completed in one pass.
- No known code or test blockers remain.
