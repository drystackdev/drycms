import type { EditerResult } from "./types.js";
import type { EditerCompletionItem, WorkerRequest, WorkerResponse } from "./worker-protocol.js";

const DEBOUNCE_MS = 300;

/** Main-thread handle for the TS Language Service running in `ts-worker.ts`. */
export class EditerWorkerClient {
  #worker: Worker;
  #debounceTimer: ReturnType<typeof setTimeout> | undefined;
  #nextRequestId = 0;
  #pendingCompletions = new Map<number, (items: EditerCompletionItem[]) => void>();
  #latest: { code: string; extraFiles: Record<string, string> } | undefined;

  constructor(onDiagnostics: (result: EditerResult) => void) {
    this.#worker = new Worker(new URL("./ts-worker.ts", import.meta.url), { type: "module" });
    this.#worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;
      if (response.kind === "diagnostics") {
        onDiagnostics(response.result);
      } else {
        const resolve = this.#pendingCompletions.get(response.requestId);
        this.#pendingCompletions.delete(response.requestId);
        resolve?.(response.items);
      }
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
   * stale text. `autoComplete`'s `startQuery` fires on nearly every keystroke
   * while typing, so this can't reuse `update`'s timer: cancelling it here
   * (only to not reschedule it - a completions request doesn't itself
   * warrant a fresh `onChange`) would starve the debounced emit indefinitely
   * as long as the user keeps typing with completions active, and `onChange`
   * would never fire.
   */
  getCompletions(pos: number): Promise<EditerCompletionItem[]> {
    this.#sync(false);
    const requestId = this.#nextRequestId++;
    const request: WorkerRequest = { kind: "completions", requestId, pos };
    return new Promise((resolve) => {
      this.#pendingCompletions.set(requestId, resolve);
      this.#worker.postMessage(request);
    });
  }

  dispose(): void {
    clearTimeout(this.#debounceTimer);
    this.#pendingCompletions.clear();
    this.#worker.terminate();
  }
}
