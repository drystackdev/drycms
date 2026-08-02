# Dedicated AI Key editor

## Plan

- Route `aiKey` entries through a dedicated editor.
- Load provider models from the provider API and search them with the shared Combobox; load Custom models from its URL.
- Preserve key checking and enforce Custom URL/model requirements in the UI.

## Status

- Complete: dedicated new/edit route, live provider model loader, searchable model Combobox, Edit-mode stored-key lookup by hashed entry id/name, Custom model loader endpoint, validation, delete flow, and save flow.
- Edit-mode model loading never sends the stored secret to the browser. The server decrypts it with `DRYCMS_SECRET_KEY`; if the deployment key changed, the UI now reports that the AI Key must be entered and saved again.
- Verification: typecheck, focused tests, and production build pass without Vite warnings.

## Speed

- Completed in one implementation pass; no blockers.
