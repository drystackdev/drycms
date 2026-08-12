import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EditerWorkerClient } from "./worker-client.js";
import type { WorkerRequest, WorkerResponse } from "./worker-protocol.js";

/** Stand-in for the real `ts-worker.ts` Worker - `postMessage` is a spy so tests can
 * inspect what was sent, and responses are delivered by calling `onmessage` manually
 * (there's no real language service running here, only `EditerWorkerClient`'s own
 * request/response and hang-detection bookkeeping is under test). */
class MockWorker {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn<(request: WorkerRequest) => void>();
  terminate = vi.fn();

  respond(response: WorkerResponse): void {
    this.onmessage?.({ data: response } as MessageEvent<WorkerResponse>);
  }

  throwError(): void {
    this.onerror?.({ message: "boom" } as ErrorEvent);
  }
}

const HANG_TIMEOUT_MS = 8000;

describe("EditerWorkerClient", () => {
  let workers: MockWorker[];

  beforeEach(() => {
    vi.useFakeTimers();
    workers = [];
    vi.stubGlobal(
      "Worker",
      class {
        constructor() {
          const worker = new MockWorker();
          workers.push(worker);
          return worker;
        }
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("resolves with the response and doesn't restart when the worker replies in time", async () => {
    const client = new EditerWorkerClient(() => {});
    const promise = client.getCompletions(5);
    const worker = workers[0]!;
    const requestId = worker.postMessage.mock.calls.at(-1)![0] as { requestId: number };
    worker.respond({ kind: "completions", requestId: requestId.requestId, items: [{ label: "x", kind: "text" }] });

    await vi.advanceTimersByTimeAsync(HANG_TIMEOUT_MS + 1000);
    expect(await promise).toEqual([{ label: "x", kind: "text" }]);
    expect(worker.terminate).not.toHaveBeenCalled();
    expect(workers).toHaveLength(1);
  });

  it("restarts the worker and resolves to the safe empty fallback if nothing responds in time", async () => {
    const client = new EditerWorkerClient(() => {});
    const promise = client.getCompletions(5);
    const worker = workers[0]!;

    await vi.advanceTimersByTimeAsync(HANG_TIMEOUT_MS + 1000);

    expect(await promise).toEqual([]);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(workers).toHaveLength(2);
  });

  it("calls onRestart and re-seeds the fresh worker with the last known code/extraFiles", async () => {
    const onRestart = vi.fn();
    const client = new EditerWorkerClient(() => {}, undefined, 300, onRestart);
    client.update("const x = 1;", { "/other.ts": "export {};" });
    const promise = client.getHover(3);

    await vi.advanceTimersByTimeAsync(HANG_TIMEOUT_MS + 1000);
    await promise;

    expect(onRestart).toHaveBeenCalledOnce();
    const freshWorker = workers[1]!;
    const updateCall = freshWorker.postMessage.mock.calls.find((call) => call[0].kind === "update");
    expect(updateCall?.[0]).toMatchObject({
      kind: "update",
      code: "const x = 1;",
      extraFiles: { "/other.ts": "export {};" },
      emitDiagnostics: true,
    });
  });

  it("sends a configure message before the first update, and again after a restart", async () => {
    const config = { compilerOptions: { strict: false } };
    new EditerWorkerClient(() => {}, config);
    const firstWorker = workers[0]!;
    expect(firstWorker.postMessage).toHaveBeenCalledWith({ kind: "configure", ...config });

    const client = new EditerWorkerClient(() => {}, config);
    const worker = workers[1]!;
    const promise = client.getCompletions(5);
    await vi.advanceTimersByTimeAsync(HANG_TIMEOUT_MS + 1000);
    await promise;

    const restartedWorker = workers[2]!;
    expect(restartedWorker.postMessage).toHaveBeenCalledWith({ kind: "configure", ...config });
  });

  it("restarts immediately (not waiting for the hang timeout) on a worker error", async () => {
    const onRestart = vi.fn();
    const client = new EditerWorkerClient(() => {}, undefined, 300, onRestart);
    const promise = client.getCompletions(1);
    const worker = workers[0]!;

    worker.throwError();
    await vi.advanceTimersByTimeAsync(0);

    expect(await promise).toEqual([]);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(onRestart).toHaveBeenCalledOnce();
    expect(workers).toHaveLength(2);
  });

  it("does not throw calling dispose after a request is already pending", async () => {
    const client = new EditerWorkerClient(() => {});
    void client.getCompletions(1);
    expect(() => client.dispose()).not.toThrow();
    const worker = workers[0]!;
    expect(worker.terminate).toHaveBeenCalledOnce();
  });
});
