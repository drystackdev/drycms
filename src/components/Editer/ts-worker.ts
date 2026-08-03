import ts from "typescript";
import type { EditerDiagnostic, EditerResult } from "./types.js";
import {
  PREACT_HOOKS_PATH,
  PREACT_INDEX_PATH,
  PREACT_JSX_RUNTIME_PATH,
  preactVirtualFiles,
  tsLibFiles,
} from "./virtual-fs-files.js";
import type { EditerCompletionItem, WorkerRequest, WorkerResponse } from "./worker-protocol.js";

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

function resolveModuleName(spec: string, containingFile: string): string | undefined {
  if (spec === "preact") return PREACT_INDEX_PATH;
  if (spec === "preact/hooks") return PREACT_HOOKS_PATH;
  if (spec === "preact/jsx-runtime") return PREACT_JSX_RUNTIME_PATH;
  if (!spec.startsWith(".")) return undefined;
  const containingDir = containingFile.slice(0, containingFile.lastIndexOf("/"));
  const base = normalizePath(`${containingDir}/${spec}`);
  for (const candidate of [base, `${base}.tsx`, `${base}.ts`, `${base}.d.ts`]) {
    if (files.has(candidate)) return candidate;
  }
  return undefined;
}

const compilerOptions: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  jsx: ts.JsxEmit.ReactJSX,
  jsxImportSource: "preact",
  strict: true,
  skipLibCheck: true,
  esModuleInterop: true,
};

const host: ts.LanguageServiceHost = {
  getScriptFileNames: () => [MAIN_FILE, ...extraFilePaths],
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

function computeCompletions(pos: number): EditerCompletionItem[] {
  const mainFile = files.get(MAIN_FILE)!;
  const before = mainFile.text.slice(0, pos);
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
  const entries = [...completions.entries].sort((a, b) => {
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

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.kind === "update") {
    setFile(MAIN_FILE, request.code);
    setExtraFiles(request.extraFiles);
    if (request.emitDiagnostics) {
      const response: WorkerResponse = { kind: "diagnostics", result: computeDiagnostics() };
      postMessage(response);
    }
  } else if (request.kind === "completions") {
    const items = computeCompletions(request.pos);
    const response: WorkerResponse = { kind: "completions", requestId: request.requestId, items };
    postMessage(response);
  }
};
