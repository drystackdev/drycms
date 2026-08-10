import type { CompilerOptions, FormatCodeSettings } from "typescript";
import type { EditerResult } from "./types.js";

/**
 * Overrides merged on top of `ts-worker.ts`'s own defaults (`DEFAULT_COMPILER_OPTIONS`/
 * `DEFAULT_FORMAT_SETTINGS`) - only `typescript`'s *types* are imported here (erased at
 * build time, same as everywhere else in this file), so accepting real `CompilerOptions`/
 * `FormatCodeSettings` doesn't pull the `typescript` package into the client bundle.
 */
export interface EditerLanguageConfig {
  compilerOptions?: Partial<CompilerOptions>;
  formatOptions?: Partial<FormatCodeSettings>;
}

/**
 * A serializable description of one prop's type - as much of the real TS type
 * as the Page Editor's component preview needs to invent a sample value for
 * it (`props-sample.ts`). Deliberately NOT `ts.Type` itself: that lives only
 * inside the worker (and isn't structured-cloneable), and the sample
 * generator wants to stay a pure, unit-testable function over plain data.
 */
export type PropsTypeNode =
  | { kind: "string" }
  | { kind: "number" }
  | { kind: "boolean" }
  | { kind: "literal"; value: string | number | boolean }
  | { kind: "union"; options: PropsTypeNode[] }
  | { kind: "array"; element: PropsTypeNode }
  | { kind: "object"; fields: PropsField[] }
  /** A renderable child (`VNode`, `ComponentChildren`, `JSX.Element`). */
  | { kind: "node" }
  | { kind: "function" }
  /** Anything the walker couldn't reduce (`any`, a generic parameter, a type
   * deeper than the walk limit) - the sample generator omits these props
   * rather than guessing. */
  | { kind: "unknown" };

export interface PropsField {
  name: string;
  optional: boolean;
  type: PropsTypeNode;
}

/** `null` when the file has no default export, or its default export isn't a
 * function (so there are no props to describe at all). */
export interface PropsSchema {
  fields: PropsField[];
}

export interface EditerCompletionItem {
  label: string;
  detail?: string;
  insert?: string;
  /** Passed straight through to `Completion.boost` - see `ts-worker.ts`'s `KIND_BOOST`. */
  boost?: number;
  /** Matches `prism-code-editor`'s `Completion.icon` names directly (see `autocomplete-icons.css`). */
  kind:
    | "keyword"
    | "property"
    | "function"
    | "variable"
    | "class"
    | "interface"
    | "enum"
    | "namespace"
    | "text";
}

export interface EditerHoverInfo {
  /** Monospace signature/type text, e.g. `const x: number` - from `QuickInfo.displayParts`. */
  text: string;
  /** Prose documentation (JSDoc), plain text - empty string if none. */
  documentation: string;
}

export interface EditerSignatureHelp {
  /** Full rendered signature, e.g. `greet(name: string, times?: number): void`. */
  label: string;
  /** Character range within `label` covering the parameter at the cursor - both 0 when none is active. */
  activeParameterStart: number;
  activeParameterEnd: number;
  /** Prose documentation (JSDoc) for the signature - empty string if none. */
  documentation: string;
}

export interface EditerTextEdit {
  start: number;
  length: number;
  newText: string;
}

export interface EditerCodeFix {
  description: string;
  edits: EditerTextEdit[];
}

export type WorkerRequest =
  | ({ kind: "configure" } & EditerLanguageConfig)
  | {
      kind: "update";
      code: string;
      extraFiles: Record<string, string>;
      /** False for the silent file-sync a completions/hover/etc. request flushes first -
       * only the debounced path emits a `diagnostics` response back to `onChange`. */
      emitDiagnostics: boolean;
      /** Also describe the default export's props (`EditerResult.propsSchema`) in the
       * same diagnostics response - only the component preview needs it, so it's off
       * for every other `Editer` rather than paying a type walk per keystroke. */
      describeProps: boolean;
    }
  | { kind: "completions"; requestId: number; pos: number }
  | { kind: "hover"; requestId: number; pos: number }
  | { kind: "signatureHelp"; requestId: number; pos: number }
  | { kind: "codeFixes"; requestId: number; pos: number }
  | { kind: "format"; requestId: number };

export type WorkerResponse =
  | { kind: "diagnostics"; result: EditerResult }
  | { kind: "completions"; requestId: number; items: EditerCompletionItem[] }
  | { kind: "hover"; requestId: number; info: EditerHoverInfo | null }
  | { kind: "signatureHelp"; requestId: number; help: EditerSignatureHelp | null }
  | { kind: "codeFixes"; requestId: number; fixes: EditerCodeFix[] }
  | { kind: "format"; requestId: number; edits: EditerTextEdit[] };
