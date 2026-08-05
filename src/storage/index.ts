import type { ResolvedStorageOption } from "../server/options.js";
import { createLocalStorageAdapter } from "./local.js";
import { createR2StorageAdapter, type R2BucketLike } from "./r2.js";
import { StorageError, type StorageAdapter } from "./types.js";

/**
 * `r2Bucket` is only ever passed by `server/storage-adapters.ts`'s
 * `getStorageAdapter()`, which resolves the live `R2Bucket` binding from a
 * request's `context.env` - `option.kind === "r2"` can never be constructed
 * by a call site that has no request context (mirrors
 * `content-adapters.ts`'s split for `content.engine: "D1"`).
 */
export function createStorageAdapter(option: ResolvedStorageOption, r2Bucket?: R2BucketLike): StorageAdapter {
  switch (option.kind) {
    case "local":
      return createLocalStorageAdapter(option.root);
    case "r2":
      if (!r2Bucket) {
        throw new StorageError(
          "unsupported",
          'storage.kind "r2" requires a live R2 bucket binding - call this through `server/storage-adapters.ts`\'s `getStorageAdapter()` instead of directly.',
        );
      }
      return createR2StorageAdapter(r2Bucket, option.prefix);
    default:
      throw new StorageError(
        "unsupported",
        `storage.kind "${(option as { kind: string }).kind}" is not implemented yet.`,
      );
  }
}

export { StorageError };
export type { StorageAdapter, StorageStatEntry, StorageErrorCode } from "./types.js";
export type { R2BucketLike } from "./r2.js";
