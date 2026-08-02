# Streaming AI chat

## Plan

- Stream AI output from `/api/ai/chat`.
- Support OpenAI Responses, Anthropic Messages, and local CLI output.
- Render assistant text incrementally in the builder chat.

## Status

- Complete: SSE response events, provider/CLI stream adapters, client delta reader, and empty/error handling.
- Verification: `bun run typecheck`, `bun run test` (577 tests), and `bun run build` pass.

## Speed

- Completed in one implementation pass; no blockers.
