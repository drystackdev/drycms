# Streaming AI chat

## Plan

- Stream AI output from `/api/ai/chat` and retain conversation history by conversation id.
- Support OpenAI Responses, Anthropic Messages, and local CLI output.
- Render assistant text incrementally in the builder chat.

## Status

- Complete: SSE response events, provider/CLI stream adapters, client delta reader, conversation history, and empty/error handling.
- Local Codex CLI currently exposes only a completed JSONL message, so the server progressively releases that completed text in small chunks for the same incremental UI behavior. Provider APIs and Claude stdout remain genuinely incremental.
- Verification: `bun run typecheck`, `bun run test` (577 tests), and `bun run build` pass.

## Speed

- Completed in one implementation pass; no blockers.
