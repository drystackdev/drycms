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
- Typecheck and 47 RichText tests pass.
- Remaining: browser QA, focused parsing tests, production build, and final cleanup.

# Speed

- Progress: implementation 2/5; verification pending.
- Blockers: none.
