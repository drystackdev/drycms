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
}
