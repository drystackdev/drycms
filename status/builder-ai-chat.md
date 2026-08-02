# Plan

- Add a validated `ai` section to `dry.config.ts` for local CLI and server API modes.
- Add an authenticated `/api/ai/chat` route with local CLI and server-provider adapters.
- Connect the Builder Content type chat UI to the route with optimistic user messages and auto-scroll.
- Verify with typecheck, tests, and production build.

# Status

- Added validated `ai` config with `local` (`codex`/`claude`) and `server` modes.
- Added authenticated `/api/ai/chat`; server mode selects and decrypts credentials from the `aiKey` collection.
- Connected the Builder Content type chat UI with optimistic messages, response/error updates, and auto-scroll.
- `bun run typecheck`, `bun run test`, and `bun run build` pass.

# Speed

- Blockers: none.
- Note: `DRYCMS_SECRET_KEY` is still required to decrypt the encrypted `aiKey.key` field.
