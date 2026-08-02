# AI Key model and key check

## Plan

- Add a `model` field to the seeded `aiKey` collection.
- Add a new-entry-only key check control and server endpoint.
- Use the collection model when server-side AI chat is configured.

## Status

- Complete: schema, file-engine additive boot upgrade, editor UI, provider checks, and server model selection.
- Verification: `bun run typecheck`; `bun run test -- --run src/content-types/seed.test.ts`.

## Speed

- Completed in one implementation pass; no blockers.
