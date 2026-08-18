import { instrumentJsxSource } from "./inspector-instrument.js";

export interface InspectorInstrumentRequest {
  requestId: number;
  files: [path: string, source: string][];
}

export interface InspectorInstrumentResponse {
  requestId: number;
  files: [path: string, source: string][];
}

/** Runs `instrumentJsxSource` off the main thread - keeps the `typescript`
 * package's runtime out of the admin's own bundle, matching the existing
 * split between `ts-worker.ts` (imports `typescript`) and `worker-client.ts`/
 * `worker-protocol.ts` (types only). Stateless and one-shot per message,
 * unlike `ts-worker.ts`'s persistent per-`Editer`-instance language service -
 * this only ever runs a fresh `ts.createSourceFile` parse per file, no
 * incremental state to keep in sync. */
self.onmessage = (event: MessageEvent<InspectorInstrumentRequest>) => {
  const { requestId, files } = event.data;
  const instrumented: [string, string][] = files.map(([path, source]) => [path, instrumentJsxSource(path, source)]);
  const response: InspectorInstrumentResponse = { requestId, files: instrumented };
  (self as unknown as Worker).postMessage(response);
};
