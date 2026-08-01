# Plan

- Add `DryComponent` with validated `refs` metadata.
- Register nested components before rendering and inherit parent CSS.
- Discover `dry.<name>.<ext>` files under `src/`.
- Run typecheck, tests, and production build.

# Status

- Completed the API rename to `DryComponent`.
- Completed recursive refs registration, preview support for nested `<dry-*>`, and inherited styles.
- Completed new file discovery and registry serialization of referenced names.
- `DryComponent` has no `name` option; `dry.<name>.<ext>` filenames provide
  the custom-element name during discovery.
- Added `d.update({...})` for in-place metadata, props, children, style, and
  refs updates.
- Added a toolbar tree button/dialog for selected components with refs.
- The refs dialog now lets the editor select and insert a referenced child
  into the selected component's children content.
- Referenced components with props, such as Carousel, now open a props dialog
  before insertion; Insert remains disabled until the props are valid.
- Ref insertion now targets the first real textblock inside the parent and
  creates a paragraph when an empty children container has no textblock.
- Registry failures are retryable instead of being cached as an empty list.
- Nested ref metadata is persisted and flattened into the editor schema, so a
  child need not also be a top-level confirmed component.
- Typecheck, unit tests, and production build pass.

# Speed

- No blockers.
