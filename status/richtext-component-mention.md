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
- Kept the `@` mention popup free of box shadow as requested.
- Added toolbar scroll compensation: toolbar actions preserve the editor anchor position after contextual controls mount, including top-layer popover actions, without smooth scrolling.
- Fixed mention search rendering with OverlayScrollbars by keeping a stable items wrapper inside the managed viewport.
- Mention token cleanup is now excluded from undo history; undoing an imported component no longer restores the temporary `@query` text.
- Temporarily hid reorder from the toolbar and added keyboard shortcuts for formatting, block/list actions, color/link/image/fullscreen, grid, and table; shortcut hints are shown in tooltips.
- Remapped text shortcuts to Word conventions, including platform-aware Cmd/Ctrl labels and direct paragraph/list/alignment shortcuts.
- Added `/` command palette with fuzzy search, icons, keyboard navigation, and grouped actions; grid/table are grouped under Block with paragraph/list, and fullscreen is excluded.
- Removed visible slash groups, reduced command text size, left-aligned rows, and added automatic selected-item scrolling for both `/` and `@` menus.
- Slash palette now excludes Undo/Redo, includes Insert component, shows shortcuts in right-aligned `<code>` badges, uses content-sized width, hides selection-only actions without a selection, and opens with `Ctrl/Cmd+/`.
- Typecheck, 50 RichText tests, and production build pass.
- Browser E2E is blocked in this environment because `E2E_SESSION_TOKEN` is not set.

# Speed

- Progress: implementation and automated verification complete; authenticated browser QA pending.
- Blockers: none.
