# Plan

1. Define trigger and scope rules:
   - Open only for `@` at the start of a text run or after whitespace.
   - Use `@` for refs of the nearest component and `@@` for top-level components.
   - Display nested refs with dotted paths such as `parent.child`.
2. Wire the popup to the ProseMirror editor:
   - Detect the current token around the collapsed cursor.
   - Position the popup beside the caret without stealing editor focus.
   - Close on whitespace, Left/Right, Escape, or deleting the token.
3. Add fuzzy filtering and keyboard interaction:
   - Search labels, names, and dotted paths with `fuzzysort`.
   - Navigate with Up/Down and import with Enter/Tab.
4. Insert the selected component:
   - Remove the complete `@`/query token.
   - Insert at top level or inside the nearest component while respecting inline/block and children content rules.
   - Use component defaults and preserve cursor/selection behavior.
5. Verify:
   - Add focused unit coverage for token parsing/scope rules where practical.
   - Run RichText tests, typecheck, production build, and browser QA for popup positioning and keyboard behavior.

# Status

- Added the initial `@` mention popup, fuzzy filtering, keyboard navigation, nested/top-level scopes, and component insertion wiring.
- Extracted pure token/scope/fuzzy helpers and added focused tests.
- Typecheck, 50 RichText tests, and production build pass.
- Browser E2E is blocked in this environment because `E2E_SESSION_TOKEN` is not set.

# Speed

- Progress: implementation and automated verification complete; authenticated browser QA pending.
- Blockers: none.
