# Dedicated AI Key editor

## Plan

- Route `aiKey` entries through a dedicated editor.
- Load provider models from the provider API and search them with the shared Combobox; load Custom models from its URL.
- Preserve key checking and enforce Custom URL/model requirements in the UI.

## Status

- Complete: dedicated new/edit route, live provider model loader, searchable model Combobox, Edit-mode stored-key lookup by hashed entry id/name, Custom model loader endpoint, validation, delete flow, and save flow.
- Edit-mode model loading never sends the stored secret to the browser. The server decrypts it with `DRYCMS_SECRET_KEY`; if the deployment key changed, the UI now reports that the AI Key must be entered and saved again.
- Fixed the encryption-key cache so it is keyed by the effective passphrase instead of remaining stale for the entire Node/Vite SSR process. Regression coverage includes special-character passphrases, in-process passphrase changes, and a real SQLite create/read/update cycle.
- Reset the obsolete `aiKey` rows after backing up the database to `content.sqlite.before-ai-key-reset-20260802-2009`; no other collection data was removed.
- Verification: typecheck, all 580 tests, and both client/server production builds pass without Vite warnings.

## Speed

- Root cause investigation and data reset complete; no blockers.
