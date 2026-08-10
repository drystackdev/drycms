import preactDomDts from "/node_modules/preact/src/dom.d.ts?raw";
import preactHooksDts from "/node_modules/preact/hooks/src/index.d.ts?raw";
import preactIndexDts from "/node_modules/preact/src/index.d.ts?raw";
import preactJsxRuntimeDtsSource from "/node_modules/preact/jsx-runtime/src/index.d.ts?raw";
import preactJsxDts from "/node_modules/preact/src/jsx.d.ts?raw";
import dryReaderSource from "../../content-types/dry-reader.ts?raw";
import dryVeiSource from "../../content-types/dry-vei.ts?raw";
import dryVeiRefSource from "../../content-types/dry-vei-ref.ts?raw";
import entryWhereSource from "../../content-types/engine/entry-where.ts?raw";

export const PREACT_INDEX_PATH = "/node_modules/preact/index.d.ts";
export const PREACT_JSX_PATH = "/node_modules/preact/jsx.d.ts";
export const PREACT_DOM_PATH = "/node_modules/preact/dom.d.ts";
export const PREACT_JSX_RUNTIME_PATH = "/node_modules/preact/jsx-runtime.d.ts";
export const PREACT_HOOKS_PATH = "/node_modules/preact/hooks.d.ts";

/**
 * preact's own .d.ts files live in nested directories (`src/`, `hooks/src/`,
 * `jsx-runtime/src/`) and cross-reference each other with a mix of bare
 * `from "preact"` imports (resolved by `resolveModuleNames` in `ts-worker.ts`)
 * and same-directory relative imports (`./jsx`, `./dom`). Flattening them
 * into siblings at `/node_modules/preact/*.d.ts` keeps those relative
 * imports resolvable without replicating the real nested layout - the only
 * one that doesn't already point at a sibling is jsx-runtime's `../../src/jsx`,
 * rewritten below to `./jsx` to match.
 */
export const preactVirtualFiles: Record<string, string> = {
  [PREACT_INDEX_PATH]: preactIndexDts,
  [PREACT_JSX_PATH]: preactJsxDts,
  [PREACT_DOM_PATH]: preactDomDts,
  [PREACT_JSX_RUNTIME_PATH]: preactJsxRuntimeDtsSource.replace(
    "'../../src/jsx'",
    "'./jsx'",
  ),
  [PREACT_HOOKS_PATH]: preactHooksDts,
};

/**
 * The modules `dry.generated.d.ts` imports from, keyed by where its own
 * relative specifiers land in this virtual FS (it sits at
 * `/dry.generated.d.ts`, matching its real on-disk home `.dry/` being a
 * repo-root sibling of `src/`, so `../src/content-types/dry-reader.js`
 * resolves to `/src/content-types/dry-reader.js` - see
 * `resolveModuleName`'s `.js` -> `.ts` fallback in `ts-worker.ts`).
 *
 * Without these, that one import is unresolved, `DryReader` silently
 * degrades to `any` (`skipLibCheck` hides the error, since the generated
 * file is a `.d.ts`), and every `dry()` call in a page loses completions
 * entirely - no `collection`/`singleton`, no content-type names inside the
 * quotes, no fields on the returned entry. Real sources rather than a
 * hand-written summary so they can't drift from the reader's actual API.
 *
 * Only the modules the PUBLIC reader types reach: `dry-vei` (`DryEntry`,
 * the `$` refs `dryBind` takes), `dry-vei-ref` (`DryRef`) and
 * `engine/entry-where` (`list({ where })`). Everything else those files
 * import (`dry-context`, `dry-populate`, `field-registry`, `entry-tree`...)
 * is implementation-only - left unresolved on purpose, which costs nothing
 * a page author can see and keeps the admin bundle from carrying most of
 * `src/content-types/` as raw text.
 */
export const dryReaderVirtualFiles: Record<string, string> = {
  "/src/content-types/dry-reader.ts": dryReaderSource,
  "/src/content-types/dry-vei.ts": dryVeiSource,
  "/src/content-types/dry-vei-ref.ts": dryVeiRefSource,
  "/src/content-types/engine/entry-where.ts": entryWhereSource,
};

const rawLibFiles = import.meta.glob("/node_modules/typescript/lib/lib.*.d.ts", {
  eager: true,
  query: "?raw",
  import: "default",
  exhaustive: true,
}) as Record<string, string>;

/** TS lib files (`lib.dom.d.ts`, `lib.es2022.d.ts`, ...), keyed by `/lib.X.d.ts` - matching
 * where `getDefaultLibFileName`/`/// <reference lib="...">` expect to find them. */
export const tsLibFiles: Record<string, string> = {};
for (const [path, content] of Object.entries(rawLibFiles)) {
  tsLibFiles["/" + path.slice(path.lastIndexOf("/") + 1)] = content;
}
