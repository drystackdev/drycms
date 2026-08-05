import type { DryRouteContext } from "./context.js";
import type { ResolvedStorageOption } from "./options.js";
import { createStorageAdapter, type StorageAdapter } from "../storage/index.js";
import type { R2BucketLike } from "../storage/r2.js";

const localAdapters = new WeakMap<ResolvedStorageOption, StorageAdapter>();
const requestAdapters = new WeakMap<object, WeakMap<ResolvedStorageOption, StorageAdapter>>();

/**
 * `option.kind === "local"` adapters are safe to share for the process
 * lifetime, cached by the option object itself (same instance every call -
 * `server/config.ts` resolves each storage-backed option once at module
 * scope). `"r2"` carries a live `R2Bucket` binding that only exists
 * per-request (`context.env`), so its adapter is built fresh per
 * `DryRouteContext` and cached on that context object only - same
 * module-vs-request split `content-adapters.ts` already established for
 * `content.engine: "D1"`.
 */
export function getStorageAdapter(
  option: ResolvedStorageOption,
  context: Pick<DryRouteContext, "env">,
): StorageAdapter {
  if (option.kind === "local") {
    let adapter = localAdapters.get(option);
    if (!adapter) {
      adapter = createStorageAdapter(option);
      localAdapters.set(option, adapter);
    }
    return adapter;
  }

  let perRequest = requestAdapters.get(context);
  if (!perRequest) {
    perRequest = new WeakMap();
    requestAdapters.set(context, perRequest);
  }
  let adapter = perRequest.get(option);
  if (!adapter) {
    const bucket = context.env[option.binding] as R2BucketLike | undefined;
    if (!bucket) {
      throw new Error(`[drycms] R2 binding "${option.binding}" was not found in the request environment.`);
    }
    adapter = createStorageAdapter(option, bucket);
    perRequest.set(option, adapter);
  }
  return adapter;
}
