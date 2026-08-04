# Plan

- Move every default local drycms data root under `.dry/`.
- Preserve explicit user-configured roots and migrate the current checkout's
  legacy root-level data without overwriting existing files.
- Update config-resolution tests and local-data documentation.

# Status

- Complete: defaults now resolve under `.dry/`, existing local data was moved
  without overwriting destinations, and tests/typecheck/build all pass.

# Speed

- One config edit plus one data migration; no known blockers.
