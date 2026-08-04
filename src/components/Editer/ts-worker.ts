import ts from "typescript";
import type { EditerDiagnostic, EditerResult } from "./types.js";
import {
  PREACT_HOOKS_PATH,
  PREACT_INDEX_PATH,
  PREACT_JSX_RUNTIME_PATH,
  preactVirtualFiles,
  tsLibFiles,
} from "./virtual-fs-files.js";
import type {
  EditerCodeFix,
  EditerCompletionItem,
  EditerHoverInfo,
  EditerSignatureHelp,
  EditerTextEdit,
  WorkerRequest,
  WorkerResponse,
} from "./worker-protocol.js";

const MAIN_FILE = "/main.tsx";

interface VirtualFile {
  text: string;
  version: number;
}

const files = new Map<string, VirtualFile>();

function setFile(path: string, text: string) {
  const existing = files.get(path);
  if (existing && existing.text === text) return;
  files.set(path, { text, version: (existing?.version ?? 0) + 1 });
}

for (const [path, text] of Object.entries(tsLibFiles)) setFile(path, text);
for (const [path, text] of Object.entries(preactVirtualFiles)) setFile(path, text);
setFile(MAIN_FILE, "");

let extraFilePaths: string[] = [];

function normalizeExtraFilePath(path: string): string {
  const stripped = path.replace(/^\.\//, "");
  return stripped.startsWith("/") ? stripped : `/${stripped}`;
}

function setExtraFiles(extraFiles: Record<string, string>) {
  const nextPaths = new Set<string>();
  for (const [rawPath, text] of Object.entries(extraFiles)) {
    const path = normalizeExtraFilePath(rawPath);
    nextPaths.add(path);
    setFile(path, text);
  }
  // Files removed from `extraFiles` since the last update stop being part of
  // the program, but stay in `files` (harmless - just unreferenced) rather
  // than deleted, since the language service host only consults `files` via
  // `getScriptFileNames`, which now excludes them.
  extraFilePaths = [...nextPaths];
}

function normalizePath(path: string): string {
  const stack: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") stack.pop();
    else stack.push(part);
  }
  return "/" + stack.join("/");
}

/** The only bare (non-relative) specifiers this sandbox resolves - also the source of
 * truth for import-specifier completions (see `computeImportSpecifierCompletions`),
 * since TS's own module-specifier completions need a real `node_modules` layout to
 * enumerate that this virtual FS doesn't have. */
const BARE_MODULE_PATHS: Record<string, string> = {
  preact: PREACT_INDEX_PATH,
  "preact/hooks": PREACT_HOOKS_PATH,
  "preact/jsx-runtime": PREACT_JSX_RUNTIME_PATH,
};

function resolveModuleName(spec: string, containingFile: string): string | undefined {
  if (spec in BARE_MODULE_PATHS) return BARE_MODULE_PATHS[spec];
  if (!spec.startsWith(".")) return undefined;
  const containingDir = containingFile.slice(0, containingFile.lastIndexOf("/"));
  const base = normalizePath(`${containingDir}/${spec}`);
  for (const candidate of [base, `${base}.tsx`, `${base}.ts`, `${base}.d.ts`]) {
    if (files.has(candidate)) return candidate;
  }
  return undefined;
}

/** `Editer`'s `compilerOptions` prop overrides these - see the `"configure"` case in
 * `self.onmessage` below. Kept separate from the live `compilerOptions` binding so a
 * page with no override still gets a clean, known-good set. */
const DEFAULT_COMPILER_OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  jsxImportSource: "preact",
  strict: true,
  skipLibCheck: true,
  esModuleInterop: true,
};
let compilerOptions: ts.CompilerOptions = DEFAULT_COMPILER_OPTIONS;

// Always part of the program's root files (not just resolvable-if-imported) so TS's
// auto-import search - both the "Update import from '...'" code fix and, if ever enabled,
// completion-time auto-import - can find their exports even when nothing *currently*
// imports them (e.g. `useState` typed with no import at all yet, not just an existing
// import missing one more name). That search only scans `program.getSourceFiles()` -
// our minimal host has no real filesystem for it to fall back to scanning instead.
const ALWAYS_LOADED_MODULES = [PREACT_INDEX_PATH, PREACT_HOOKS_PATH, PREACT_JSX_RUNTIME_PATH];

const host: ts.LanguageServiceHost = {
  getScriptFileNames: () => [MAIN_FILE, ...extraFilePaths, ...ALWAYS_LOADED_MODULES],
  getScriptVersion: (path) => String(files.get(path)?.version ?? 0),
  getScriptSnapshot: (path) => {
    const file = files.get(path);
    return file ? ts.ScriptSnapshot.fromString(file.text) : undefined;
  },
  getCurrentDirectory: () => "/",
  getCompilationSettings: () => compilerOptions,
  getDefaultLibFileName: (options) => "/" + ts.getDefaultLibFileName(options),
  fileExists: (path) => files.has(path),
  readFile: (path) => files.get(path)?.text,
  directoryExists: () => true,
  getDirectories: () => [],
  resolveModuleNames: (moduleNames, containingFile) =>
    moduleNames.map((name) => {
      const resolvedFileName = resolveModuleName(name, containingFile);
      return resolvedFileName ? { resolvedFileName, extension: ts.Extension.Dts } : undefined;
    }),
};

const languageService = ts.createLanguageService(host, ts.createDocumentRegistry());

function toDiagnostic(diagnostic: ts.Diagnostic, source: "syntax" | "type"): EditerDiagnostic | null {
  if (diagnostic.start === undefined || diagnostic.length === undefined || !diagnostic.file) {
    return null;
  }
  const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
  return {
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    line: line + 1,
    column: character + 1,
    length: diagnostic.length,
    source,
  };
}

function computeDiagnostics(): EditerResult {
  const code = files.get(MAIN_FILE)?.text ?? "";
  const syntactic = languageService
    .getSyntacticDiagnostics(MAIN_FILE)
    .map((d) => toDiagnostic(d, "syntax"))
    .filter((d): d is EditerDiagnostic => d !== null);
  const semantic = languageService
    .getSemanticDiagnostics(MAIN_FILE)
    .map((d) => toDiagnostic(d, "type"))
    .filter((d): d is EditerDiagnostic => d !== null);
  return {
    code,
    success: syntactic.length === 0,
    errors: [...syntactic, ...semantic],
  };
}

const KIND_MAP: Record<string, EditerCompletionItem["kind"]> = {
  keyword: "keyword",
  class: "class",
  "local class": "class",
  interface: "interface",
  enum: "enum",
  var: "variable",
  "local var": "variable",
  using: "variable",
  "await using": "variable",
  const: "variable",
  let: "variable",
  parameter: "variable",
  function: "function",
  "local function": "function",
  method: "function",
  getter: "property",
  setter: "property",
  property: "property",
  accessor: "property",
  module: "namespace",
  "external module name": "namespace",
  alias: "namespace",
};

/**
 * Runtime-ish kinds (importable functions/classes/consts - `h`, `render`,
 * `Fragment`, `Component`...) rank above pure type-only kinds (`interface`,
 * `type`, `alias`) - without this, a module with as many type exports as
 * preact (every HTML/ARIA attribute interface) buries the handful of actual
 * functions under hundreds of interfaces in alphabetical order, since with
 * an empty query (nothing typed yet, e.g. `import { |} from "preact"`)
 * `prism-code-editor`'s own filter/sort gives every entry the same score.
 */
const KIND_BOOST: Record<string, number> = {
  function: 2,
  "local function": 2,
  const: 2,
  class: 2,
  "local class": 2,
  method: 1,
  property: 1,
  interface: -1,
  type: -1,
  alias: -1,
};

/** Matches an unclosed `<` right before the cursor, with zero or more tag/
 * member-name characters already typed (`<`, `<d`, `<di`, `<Foo.Bar`...). */
const OPEN_JSX_TAG_RE = /<([A-Za-z][\w.]*)?$/;

/** Matches the cursor sitting inside an open string literal right after `from`/`import` -
 * i.e. a module specifier being typed (`import x from "|`, `import "pre|`, dynamic
 * `import("./|`). Captures what's been typed inside the quotes so far. */
const IMPORT_SPECIFIER_RE = /\b(?:from|import)\s*\(?\s*["']([^"']*)$/;

/**
 * TS's own module-specifier completions need to enumerate a real `node_modules`
 * (bare specifiers) or directory listing (relative paths) via `readDirectory` - this
 * virtual FS has neither, so `getCompletionsAtPosition` returns nothing useful inside
 * an import string (confirmed empirically: empty entries for both `from "pre` and
 * `from "./B`). Suggests from what's actually resolvable instead: `BARE_MODULE_PATHS`'
 * own keys for a bare specifier, or the current `extraFiles` for a relative one -
 * exactly the two things `resolveModuleName` above can turn into a real file.
 */
function computeImportSpecifierCompletions(typed: string): EditerCompletionItem[] {
  const typedLower = typed.toLowerCase();
  if (typed.startsWith(".") || typed.startsWith("/")) {
    return extraFilePaths
      .map((path) => `.${path}`)
      .filter((spec) => spec.toLowerCase().includes(typedLower))
      .map((label) => ({ label, insert: label, kind: "namespace" as const }));
  }
  return Object.keys(BARE_MODULE_PATHS)
    .filter((spec) => spec.toLowerCase().includes(typedLower))
    .map((label) => ({ label, insert: label, kind: "namespace" as const }));
}

function rawCompletionsAt(pos: number): ts.CompletionInfo | undefined {
  return languageService.getCompletionsAtPosition(MAIN_FILE, pos, {});
}

/**
 * Once the synthetic-close trick (below) makes TS treat the position as
 * JSX, `entries` is the *entire* global scope (900+ names) plus the JSX tag
 * names mixed in - `div`/`span` are "property"-kind entries indistinguishable
 * by kind alone from an unrelated global "method" like `addEventListener`,
 * so generic `KIND_BOOST` ties them and the real tag names can lose out to
 * sortText and fall past the top-50 cutoff before ever reaching the client.
 * Since we already know this position *is* a tag name (that's why we're in
 * this branch), filter instead of merely boosting: intrinsic elements are
 * always lowercase "property" entries (`JSX.IntrinsicElements`'s own keys),
 * components are always capitalized values - nothing else is a legal JSX
 * tag name here regardless of what the synthetic splice also surfaced.
 */
function isPlausibleJsxName(entry: ts.CompletionEntry): boolean {
  const first = entry.name[0];
  if (!first) return false;
  if (entry.kind === "property" && first === first.toLowerCase()) return true;
  return first === first.toUpperCase() && first !== first.toLowerCase() && (KIND_BOOST[entry.kind] ?? 0) > 0;
}

/** The identifier characters immediately before `pos` - mirrors `Editer.tsx`'s own
 * `wordStart`, just working over the worker's copy of the text instead of a DOM event. */
function currentWordPrefix(text: string, pos: number): string {
  let start = pos;
  while (start > 0 && /[A-Za-z0-9_$]/.test(text[start - 1]!)) start--;
  return text.slice(start, pos);
}

function computeCompletions(pos: number): EditerCompletionItem[] {
  const mainFile = files.get(MAIN_FILE)!;
  const before = mainFile.text.slice(0, pos);
  const importSpecifierMatch = IMPORT_SPECIFIER_RE.exec(before);
  if (importSpecifierMatch) return computeImportSpecifierCompletions(importSpecifierMatch[1] ?? "");
  const isOpenTag = OPEN_JSX_TAG_RE.test(before);
  let completions: ts.CompletionInfo | undefined;
  if (isOpenTag) {
    // TS's completions engine only offers JSX intrinsic elements/component
    // names (`div`, `span`, `MyComponent`...) when the containing element
    // parses as a *complete* JsxOpeningElement - confirmed empirically: a
    // still-open `<di` (even a bare `<` alone) never gets them, editing
    // inside an already-closed `<a></a>` does. So for completions purposes
    // only, splice in a synthetic self-close right after the cursor - just
    // enough for the parser to recognize valid JSX - query against that, and
    // restore the real (unmodified) text before returning. The real file
    // the user sees/types into never contains this synthetic text.
    const synthetic = mainFile.text.slice(0, pos) + " />" + mainFile.text.slice(pos);
    setFile(MAIN_FILE, synthetic);
    try {
      completions = rawCompletionsAt(pos);
    } finally {
      setFile(MAIN_FILE, mainFile.text);
    }
    if (completions) {
      completions = { ...completions, entries: completions.entries.filter(isPlausibleJsxName) };
    }
  } else {
    completions = rawCompletionsAt(pos);
  }
  if (!completions) return [];
  // TS's raw `entries` for a broad scope (e.g. global/module position) commonly number in
  // the thousands and are *not* pre-narrowed to what's already been typed - the client
  // (`Editer.tsx`'s `tsCompletionSource`) fuzzy-filters by the typed prefix, but only
  // against whatever survives the `slice(0, 50)` below. Without this prefix pass first,
  // that slice is taken purely by `KIND_BOOST`/`sortText`, which for a several-thousand-
  // entry scope can easily fill all 50 slots with entries that don't even contain what's
  // been typed (e.g. typing "cons" - `const`/`console` themselves silently truncated away
  // by unrelated boosted names alphabetically ahead of them) - completions would then
  // reach the client, but the client's own fuzzy filter has nothing relevant left to show.
  const prefix = currentWordPrefix(mainFile.text, pos).toLowerCase();
  let candidates = completions.entries;
  if (prefix) {
    const matching = candidates.filter((entry) => entry.name.toLowerCase().includes(prefix));
    if (matching.length) candidates = matching;
  }
  const entries = [...candidates].sort((a, b) => {
    const boostDiff = (KIND_BOOST[b.kind] ?? 0) - (KIND_BOOST[a.kind] ?? 0);
    return boostDiff !== 0 ? boostDiff : a.sortText.localeCompare(b.sortText);
  });
  return entries.slice(0, 50).map((entry) => ({
    label: entry.name,
    insert: entry.insertText ?? entry.name,
    kind: KIND_MAP[entry.kind] ?? "text",
    boost: KIND_BOOST[entry.kind] ?? 0,
  }));
}

function computeHover(pos: number): EditerHoverInfo | null {
  const info = languageService.getQuickInfoAtPosition(MAIN_FILE, pos);
  if (!info) return null;
  const text = ts.displayPartsToString(info.displayParts ?? []);
  const documentation = ts.displayPartsToString(info.documentation ?? []);
  if (!text && !documentation) return null;
  return { text, documentation };
}

function computeSignatureHelp(pos: number): EditerSignatureHelp | null {
  const help = languageService.getSignatureHelpItems(MAIN_FILE, pos, undefined);
  if (!help || !help.items.length) return null;
  const item = help.items[help.selectedItemIndex] ?? help.items[0]!;
  const separator = ts.displayPartsToString(item.separatorDisplayParts);
  let label = ts.displayPartsToString(item.prefixDisplayParts);
  let activeParameterStart = 0;
  let activeParameterEnd = 0;
  item.parameters.forEach((param, i) => {
    const paramText = ts.displayPartsToString(param.displayParts);
    if (i === help.argumentIndex) {
      activeParameterStart = label.length;
      activeParameterEnd = activeParameterStart + paramText.length;
    }
    label += paramText;
    if (i < item.parameters.length - 1) label += separator;
  });
  label += ts.displayPartsToString(item.suffixDisplayParts);
  return {
    label,
    activeParameterStart,
    activeParameterEnd,
    documentation: ts.displayPartsToString(item.documentation),
  };
}

/**
 * Only offers fixes for diagnostics that actually cover `pos` - `getCodeFixesAtPosition`
 * requires the caller to know which error codes it's fixing, so the diagnostics at `pos`
 * (recomputed here rather than reused from the last `computeDiagnostics()` call, which may
 * be stale relative to the just-synced file) are the source of truth for that list.
 */
function computeCodeFixes(pos: number): EditerCodeFix[] {
  const codes = new Set<number>();
  const diagnostics = [
    ...languageService.getSyntacticDiagnostics(MAIN_FILE),
    ...languageService.getSemanticDiagnostics(MAIN_FILE),
  ];
  for (const d of diagnostics) {
    if (d.start !== undefined && d.length !== undefined && pos >= d.start && pos <= d.start + d.length) {
      codes.add(d.code);
    }
  }
  if (!codes.size) return [];
  try {
    // `includeCompletionsForModuleExports` is the flag that makes "Update import from
    // 'preact/hooks'" (add a name to/create an import for an already-known module) show
    // up at all - without it `getCodeFixesAtPosition` silently omits auto-import fixes
    // entirely (returns the *other* applicable fixes only, not an error) even when the
    // module is already part of the program, confirmed empirically against a real
    // unresolved-name diagnostic.
    const fixes = languageService.getCodeFixesAtPosition(MAIN_FILE, pos, pos, [...codes], {}, {
      includeCompletionsForModuleExports: true,
      includeCompletionsWithInsertText: true,
      allowIncompleteCompletions: true,
    });
    return fixes
      .map((fix) => ({
        description: fix.description,
        edits: fix.changes
          .filter((change) => change.fileName === MAIN_FILE)
          .flatMap((change) =>
            change.textChanges.map((tc) => ({ start: tc.span.start, length: tc.span.length, newText: tc.newText })),
          ),
      }))
      .filter((fix): fix is EditerCodeFix => fix.edits.length > 0);
  } catch {
    // Some fix kinds need program state this virtual FS doesn't have (e.g. cross-file
    // organize-imports) and throw instead of returning an empty array - not worth
    // surfacing to the user as an error for what's just "no fix available here".
    return [];
  }
}

/** `Editer`'s `formatOptions` prop overrides these - see the `"configure"` case in
 * `self.onmessage` below. */
const DEFAULT_FORMAT_SETTINGS: ts.FormatCodeSettings = {
  indentSize: 2,
  tabSize: 2,
  convertTabsToSpaces: true,
  insertSpaceAfterCommaDelimiter: true,
  insertSpaceAfterSemicolonInForStatements: true,
  insertSpaceBeforeAndAfterBinaryOperators: true,
  insertSpaceAfterKeywordsInControlFlowStatements: true,
  insertSpaceAfterFunctionKeywordForAnonymousFunctions: true,
  insertSpaceBeforeFunctionParenthesis: false,
  placeOpenBraceOnNewLineForFunctions: false,
  placeOpenBraceOnNewLineForControlBlocks: false,
  semicolons: ts.SemicolonPreference.Insert,
};
let formatSettings: ts.FormatCodeSettings = DEFAULT_FORMAT_SETTINGS;

function computeFormatting(): EditerTextEdit[] {
  try {
    return languageService
      .getFormattingEditsForDocument(MAIN_FILE, formatSettings)
      .map((tc) => ({ start: tc.span.start, length: tc.span.length, newText: tc.newText }));
  } catch {
    return [];
  }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.kind === "configure") {
    // `EditerWorkerClient` sends this once, right after creating the worker and before
    // its first "update" - safe to merge onto the defaults unconditionally since there's
    // no user content/diagnostics computed yet for changed options to invalidate.
    if (request.compilerOptions) compilerOptions = { ...DEFAULT_COMPILER_OPTIONS, ...request.compilerOptions };
    if (request.formatOptions) formatSettings = { ...DEFAULT_FORMAT_SETTINGS, ...request.formatOptions };
  } else if (request.kind === "update") {
    setFile(MAIN_FILE, request.code);
    setExtraFiles(request.extraFiles);
    if (request.emitDiagnostics) {
      const response: WorkerResponse = { kind: "diagnostics", result: computeDiagnostics() };
      postMessage(response);
    }
  } else if (request.kind === "completions") {
    const items = computeCompletions(request.pos);
    postMessage({ kind: "completions", requestId: request.requestId, items } satisfies WorkerResponse);
  } else if (request.kind === "hover") {
    const info = computeHover(request.pos);
    postMessage({ kind: "hover", requestId: request.requestId, info } satisfies WorkerResponse);
  } else if (request.kind === "signatureHelp") {
    const help = computeSignatureHelp(request.pos);
    postMessage({ kind: "signatureHelp", requestId: request.requestId, help } satisfies WorkerResponse);
  } else if (request.kind === "codeFixes") {
    const fixes = computeCodeFixes(request.pos);
    postMessage({ kind: "codeFixes", requestId: request.requestId, fixes } satisfies WorkerResponse);
  } else if (request.kind === "format") {
    const edits = computeFormatting();
    postMessage({ kind: "format", requestId: request.requestId, edits } satisfies WorkerResponse);
  }
};
