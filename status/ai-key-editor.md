# Dedicated AI Key editor

## Plan

- Route `aiKey` entries through a dedicated editor.
- Populate provider-specific model choices and load Custom models from its URL.
- Preserve key checking and enforce Custom URL/model requirements in the UI.

## Status

- Complete: dedicated new/edit route, provider model choices, Custom model loader endpoint, validation, and save flow.
- Verification: typecheck, focused tests, and production build pass without Vite warnings.

## Speed

- Completed in one implementation pass; no blockers.
