# Plan

- Add `DryComponent` with validated `refs` metadata.
- Register nested components before rendering and inherit parent CSS.
- Discover `dry.<name>.<ext>` files under `src/`.
- Run typecheck, tests, and production build.

# Status

- Completed the API rename to `DryComponent`.
- Completed recursive refs registration, preview support for nested `<dry-*>`, and inherited styles.
- Completed new file discovery and registry serialization of referenced names.
- `DryComponent` accepts an optional `name`; when omitted,
  `dry.<name>.<ext>` provides the custom-element name for roots and refs.
- Added `d.update({...})` for in-place metadata, props, children, style, and
  refs updates.
- Added a toolbar tree button/dialog for selected components with refs.
- The refs dialog now lets the editor select and insert a referenced child
  into the selected component's children content.
- Referenced components with props, such as Carousel, now open a props dialog
  before insertion; Insert remains disabled until the props are valid.
- Ref insertion now targets the first real textblock inside the parent and
  creates a paragraph when an empty children container has no textblock.
- Ref insertion reads node types from the live editor state's schema, avoiding
  stale module-schema references after async registry initialization.
- The parent position is captured when the refs toolbar opens, and the Insert
  button prevents editor focus handlers from swallowing its click.
- At confirmation time the command re-reads the parent from the live document,
  verifies the transaction changed the document, and selects the inserted ref.
- Generated owner bundles inline all static dry-component imports. Runtime ref
  loaders now resolve nested definitions from the owner's bundle (for example,
  Carousel from `color-text.js`) and never request a separate child bundle.
- Bundle resolution uses the persisted ref-index path instead of function
  names, so older minified bundles whose internal names became `s`/`y` still
  mount correctly; parent styles are accumulated along the same path.
- Component bundles preserve function names during minification, and the
  current `color-text.js` was rebuilt with `color-text -> carousel` names.
- RichText editor HMR now reuses and clears an existing shadow root instead of
  throwing on a second `attachShadow()` call and leaving components at 0x0.
- Nested block settings target the deepest selected dry component, and the
  toolbar tooltip/aria label includes that component's label.
- Added a bundle regression test proving `dry.color-text.tsx` contains Carousel
  code and has no `dry.carousel` module import after compilation.
- Registry failures are retryable instead of being cached as an empty list.
- Nested ref metadata is persisted and flattened into the editor schema, so a
  child need not also be a top-level confirmed component.
- Typecheck, unit tests, and production build pass.

# Speed

- No blockers.
