# Plan

- Define useful, semantic Tailwind defaults for `styles/theme.css`.
- Add global element, accessibility, and light/dark defaults to `styles/base.css`.
- Keep the recovery templates and the current live source identical.
- Verify CSS compilation, tests, and type checking.

# Status

- Complete.
- `theme.css` now provides semantic colors, a primary palette, font stacks,
  radii, and a card shadow.
- `base.css` now provides light/dark surface values, document typography,
  responsive media defaults, accessible focus/selection styles, and reduced
  motion handling.
- Recovery templates and `.dry/pages-source/styles` are byte-for-byte aligned.
- Verified with TypeScript, the pages-source route suite, Tailwind's dev
  compilation, and Playwright screenshots/computed styles in light and dark.

# Speed

- Finished without blockers.
