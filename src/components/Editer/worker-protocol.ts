import type { EditerResult } from "./types.js";

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

export type WorkerRequest =
  | {
      kind: "update";
      code: string;
      extraFiles: Record<string, string>;
      /** False for the silent file-sync a completions request flushes first -
       * only the debounced path emits a `diagnostics` response back to `onChange`. */
      emitDiagnostics: boolean;
    }
  | { kind: "completions"; requestId: number; pos: number };

export type WorkerResponse =
  | { kind: "diagnostics"; result: EditerResult }
  | { kind: "completions"; requestId: number; items: EditerCompletionItem[] };
