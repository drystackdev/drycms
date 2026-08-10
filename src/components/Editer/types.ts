import type { PropsSchema } from "./worker-protocol.js";

export interface EditerDiagnostic {
  message: string;
  line: number;
  column: number;
  length: number;
  /** Syntax errors block `EditerResult.success`; type errors are informational only. */
  source: "syntax" | "type";
}

export interface EditerResult {
  code: string;
  /** True when there is no `syntax` diagnostic - i.e. the code parses/transpiles. */
  success: boolean;
  errors: EditerDiagnostic[];
  /** The default export's props, described from the REAL TS types - only
   * present when the `Editer` was mounted with `describeProps` (the Page
   * Editor's component preview), `null` when the file has no default-exported
   * function to describe. See `worker-protocol.ts`'s `PropsSchema`. */
  propsSchema?: PropsSchema | null;
}
