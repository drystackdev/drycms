import type { EditerResult } from "./types.js";
import type {
  EditerCodeFix,
  EditerCompletionItem,
  EditerHoverInfo,
  EditerLanguageConfig,
  EditerSignatureHelp,
  EditerTextEdit,
  WorkerRequest,
  WorkerResponse,
} from "./worker-protocol.js";

const DEFAULT_DEBOUNCE_MS = 300;
/** How long the worker can go without responding to *anything* before it's treated as
 * hung and restarted (see `#scheduleHangCheck`) - generous enough that a legitimately
 * slow request on a large file isn't mistaken for one, since `ts.createLanguageService`
 * operations on this sandbox's tiny virtual FS normally resolve in well under a second. */
const HANG_TIMEOUT_MS = 8000;

/** Main-thread handle for the TS Language Service running in `ts-worker.ts`. */
export class EditerWorkerClient {
  #worker: Worker;
  #debounceMs: number;
  #debounceTimer: ReturnType<typeof setTimeout> | undefined;
  #nextRequestId = 0;
  #pending = new Map<number, (response: WorkerResponse | null) => void>();
  #latest: { code: string; extraFiles: Record<string, string> } | undefined;
  #config: EditerLanguageConfig | undefined;
  #onDiagnostics: (result: EditerResult) => void;
  #onRestart: (() => void) | undefined;
  #hangTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    onDiagnostics: (result: EditerResult) => void,
    config?: EditerLanguageConfig,
    debounceMs = DEFAULT_DEBOUNCE_MS,
    onRestart?: () => void,
  ) {
    this.#debounceMs = debounceMs;
    this.#config = config;
    this.#onDiagnostics = onDiagnostics;
    this.#onRestart = onRestart;
    this.#worker = this.#createWorker();
    // Sent first (the worker processes messages in the order they arrive), so every
    // later "update"/completions/etc. computes against the configured options, never
    // the worker's own bare defaults.
    if (config?.compilerOptions || config?.formatOptions) {
      this.#post({ kind: "configure", ...config });
    }
  }

  #createWorker(): Worker {
    const worker = new Worker(new URL("./ts-worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      clearTimeout(this.#hangTimer);
      const response = event.data;
      if (response.kind === "diagnostics") {
        this.#onDiagnostics(response.result);
        return;
      }
      const resolve = this.#pending.get(response.requestId);
      this.#pending.delete(response.requestId);
      resolve?.(response);
    };
    return worker;
  }

  /** Every outgoing message (re)arms the same shared timer - a healthy worker resets it
   * just by responding to *anything*, so this catches "stopped making progress at all"
   * (the fire-and-forget debounced "update" included) without being tripped by a merely
   * slow individual request in an otherwise-responsive queue. */
  #post(request: WorkerRequest): void {
    this.#worker.postMessage(request);
    clearTimeout(this.#hangTimer);
    this.#hangTimer = setTimeout(() => this.#restart(), HANG_TIMEOUT_MS);
  }

  /** Terminates the unresponsive worker, replaces it with a fresh one, and re-seeds it
   * (configure, then the last known file/extraFiles) so it picks up where the dead one
   * left off. Callers awaiting a request sent to the dead worker resolve to `null`
   * (each `get*` method below already has a safe empty/`null` fallback for that) rather
   * than hanging forever. */
  #restart(): void {
    this.#worker.terminate();
    for (const resolve of this.#pending.values()) resolve(null);
    this.#pending.clear();
    this.#onRestart?.();
    this.#worker = this.#createWorker();
    if (this.#config?.compilerOptions || this.#config?.formatOptions) {
      this.#post({ kind: "configure", ...this.#config });
    }
    if (this.#latest) this.#post({ kind: "update", ...this.#latest, emitDiagnostics: true });
  }

  /** Debounced - safe to call on every keystroke. Only the debounced timer
   * below ever emits a `diagnostics` response (see `#sync`) - `onChange`
   * fires at most once per pause in typing, not once per keystroke. */
  update(code: string, extraFiles: Record<string, string>): void {
    this.#latest = { code, extraFiles };
    clearTimeout(this.#debounceTimer);
    this.#debounceTimer = setTimeout(() => this.#sync(true), this.#debounceMs);
  }

  #sync(emitDiagnostics: boolean): void {
    if (!this.#latest) return;
    this.#post({ kind: "update", ...this.#latest, emitDiagnostics });
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
  #request(build: (requestId: number) => WorkerRequest): Promise<WorkerResponse | null> {
    this.#sync(false);
    const requestId = this.#nextRequestId++;
    return new Promise((resolve) => {
      this.#pending.set(requestId, resolve);
      this.#post(build(requestId));
    });
  }

  async getCompletions(pos: number): Promise<EditerCompletionItem[]> {
    const response = await this.#request((requestId) => ({ kind: "completions", requestId, pos }));
    return response?.kind === "completions" ? response.items : [];
  }

  async getHover(pos: number): Promise<EditerHoverInfo | null> {
    const response = await this.#request((requestId) => ({ kind: "hover", requestId, pos }));
    return response?.kind === "hover" ? response.info : null;
  }

  async getSignatureHelp(pos: number): Promise<EditerSignatureHelp | null> {
    const response = await this.#request((requestId) => ({ kind: "signatureHelp", requestId, pos }));
    return response?.kind === "signatureHelp" ? response.help : null;
  }

  async getCodeFixes(pos: number): Promise<EditerCodeFix[]> {
    const response = await this.#request((requestId) => ({ kind: "codeFixes", requestId, pos }));
    return response?.kind === "codeFixes" ? response.fixes : [];
  }

  async getFormatting(): Promise<EditerTextEdit[]> {
    const response = await this.#request((requestId) => ({ kind: "format", requestId }));
    return response?.kind === "format" ? response.edits : [];
  }

  dispose(): void {
    clearTimeout(this.#debounceTimer);
    clearTimeout(this.#hangTimer);
    this.#pending.clear();
    this.#worker.terminate();
  }
}
