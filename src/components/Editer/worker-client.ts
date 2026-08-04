import type { EditerResult } from "./types.js";
import type {
  EditerCodeFix,
  EditerCompletionItem,
  EditerHoverInfo,
  EditerSignatureHelp,
  EditerTextEdit,
  WorkerRequest,
  WorkerResponse,
} from "./worker-protocol.js";

const DEBOUNCE_MS = 300;

/** Main-thread handle for the TS Language Service running in `ts-worker.ts`. */
export class EditerWorkerClient {
  #worker: Worker;
  #debounceTimer: ReturnType<typeof setTimeout> | undefined;
  #nextRequestId = 0;
  #pending = new Map<number, (response: WorkerResponse) => void>();
  #latest: { code: string; extraFiles: Record<string, string> } | undefined;

  constructor(onDiagnostics: (result: EditerResult) => void) {
    this.#worker = new Worker(new URL("./ts-worker.ts", import.meta.url), { type: "module" });
    this.#worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      if (response.kind === "diagnostics") {
        onDiagnostics(response.result);
        return;
      }
      const resolve = this.#pending.get(response.requestId);
      this.#pending.delete(response.requestId);
      resolve?.(response);
    };
  }

  /** Debounced - safe to call on every keystroke. Only the debounced timer
   * below ever emits a `diagnostics` response (see `#sync`) - `onChange`
   * fires at most once per pause in typing, not once per keystroke. */
  update(code: string, extraFiles: Record<string, string>): void {
    this.#latest = { code, extraFiles };
    clearTimeout(this.#debounceTimer);
    this.#debounceTimer = setTimeout(() => this.#sync(true), DEBOUNCE_MS);
  }

  #sync(emitDiagnostics: boolean): void {
    if (!this.#latest) return;
    const request: WorkerRequest = { kind: "update", ...this.#latest, emitDiagnostics };
    this.#worker.postMessage(request);
  }

  /**
   * Syncs the worker's copy of the file first - silently, without emitting a
   * `diagnostics` response, and *without* touching the debounce timer above
   * - so the worker resolves a position in it against what's on screen, not
   * stale text. `autoComplete`'s `startQuery` (and the hover/signature-help
   * lookups below) fire on nearly every keystroke while typing, so this can't
   * reuse `update`'s timer: cancelling it here (only to not reschedule it -
   * these requests don't themselves warrant a fresh `onChange`) would starve
   * the debounced emit indefinitely as long as the user keeps typing, and
   * `onChange` would never fire.
   */
  #request(build: (requestId: number) => WorkerRequest): Promise<WorkerResponse> {
    this.#sync(false);
    const requestId = this.#nextRequestId++;
    return new Promise((resolve) => {
      this.#pending.set(requestId, resolve);
      this.#worker.postMessage(build(requestId));
    });
  }

  async getCompletions(pos: number): Promise<EditerCompletionItem[]> {
    const response = await this.#request((requestId) => ({ kind: "completions", requestId, pos }));
    return response.kind === "completions" ? response.items : [];
  }

  async getHover(pos: number): Promise<EditerHoverInfo | null> {
    const response = await this.#request((requestId) => ({ kind: "hover", requestId, pos }));
    return response.kind === "hover" ? response.info : null;
  }

  async getSignatureHelp(pos: number): Promise<EditerSignatureHelp | null> {
    const response = await this.#request((requestId) => ({ kind: "signatureHelp", requestId, pos }));
    return response.kind === "signatureHelp" ? response.help : null;
  }

  async getCodeFixes(pos: number): Promise<EditerCodeFix[]> {
    const response = await this.#request((requestId) => ({ kind: "codeFixes", requestId, pos }));
    return response.kind === "codeFixes" ? response.fixes : [];
  }

  async getFormatting(): Promise<EditerTextEdit[]> {
    const response = await this.#request((requestId) => ({ kind: "format", requestId }));
    return response.kind === "format" ? response.edits : [];
  }

  dispose(): void {
    clearTimeout(this.#debounceTimer);
    this.#pending.clear();
    this.#worker.terminate();
  }
}
