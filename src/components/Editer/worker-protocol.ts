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
