// Public, stable, standalone chunk (`plans/app-r2.md` mục 7) - what a
// built page's own `page.js`/`layout.js` (real ESM, sucrase's `imports`
// transform dropped - `status/app-r2-build.md`'s spike already validated
// this output shape) imports `preact`/`preact/hooks`/`hydrate` FROM at
// runtime, in a VISITOR's plain browser - no Vite dev server, no
// node_modules, so a bare `import "preact"` has nothing to resolve against
// unless something serves it.
//
// NOT a normal Vite `rollupOptions.input` (found live, `bun run
// build:worker`: a plain `export {...} from "preact"` barrel does not
// survive Vite's regular app-mode build - Rollup proved this file has no
// code of its own beyond one binding the ADMIN app itself also happens to
// use, `hydrate` via `hydrate-built.ts`, and elided the rest as dead,
// including `preserveEntrySignatures: "strict"`/`treeshake: false`, both
// tried and confirmed to have zero effect - the true reader of every name
// below is a built page's own compiled JS, generated later entirely
// outside this build, by Sucrase, in a visitor's browser
// (`page-build.ts`'s `compileEsmAsset`), so nothing here can ever look
// "used" to Vite's own graph). Built instead via a nested Vite **library**
// build (`build-preact-runtime-bundle.ts`, mirroring `RichTextField`'s
// `buildSharedPreactBundle` for its own, differently-shaped, Preact vendor
// bundle) - library mode's whole purpose is preserving a full, stable
// export surface for consumers outside that build's own graph, so none of
// the above elision applies there.
export { h, Fragment, cloneElement, createContext, createRef, isValidElement, options, toChildArray } from "preact";
// Named, not `export * as hooks` - `page-build.ts` rewrites a compiled
// page's `from "preact/hooks"` to point at THIS SAME url, and real page
// source writes named imports (`import { useState } from "preact/hooks"`),
// not a namespaced one - the rewrite must land on names that actually exist
// here.
export {
  useState,
  useReducer,
  useEffect,
  useLayoutEffect,
  useRef,
  useImperativeHandle,
  useMemo,
  useCallback,
  useContext,
  useDebugValue,
  useErrorBoundary,
  useId,
} from "preact/hooks";
export { default as hydrate } from "preact-iso/hydrate";
