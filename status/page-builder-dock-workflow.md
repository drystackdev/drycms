# Plan

1. Audit the existing dock, entry-draft preview/save, affected-page rebuild, and component preview flows.
2. Turn VEI and Code into mutually-exclusive, toggleable right-panel modes with Solar icons.
3. Add an XL Save preview dialog covering dirty source files and edited entries.
4. Implement one Save pipeline: source files, entry drafts, affected-page rebuild, with staged percentage progress.
5. Constrain component editor dialog height and make its preview a runnable `xs` viewport matching Page Editor behavior.
6. Typecheck, test, build, and visually verify the full workflow.

# Status

- In progress: auditing reusable save/preview/build mechanisms.

# Speed

- No blockers. Reusing existing draft and build APIs should avoid parallel state stores.
