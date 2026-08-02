# Plan

- Update the server AI chat route to try configured AI keys in order and
  continue on quota/rate-limit/invalid-key responses.
- Surface an explicit all-keys-exhausted error to the Builder chat.
- Add focused tests and run typecheck/test validation.

# Status

- In progress: current route selects only one `aiKey` entry.

# Speed

- Started after tracing the Builder `/api/ai/chat` flow.
- No blocker.
