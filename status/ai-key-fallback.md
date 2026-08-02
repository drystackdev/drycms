# Plan

- Update the server AI chat route to try configured AI keys in order and
  continue on quota/rate-limit/invalid-key responses.
- Surface an explicit all-keys-exhausted error to the Builder chat.
- Add focused tests and run typecheck/test validation.

# Status

- Complete: server chat tries configured `aiKey` entries in order and falls
  back on quota/rate-limit/credential failures.
- Complete: Google/Gemini keys use the Gemini streaming API format.
- Complete: route-module export contract is type-safe; focused typecheck and
  full unit suite pass.

# Speed

- Started after tracing the Builder `/api/ai/chat` flow.
- No blocker.
