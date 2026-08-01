import type { ResolvedStorageOption } from "../server/options.js";
import { createLocalStorageAdapter } from "./local.js";
import { StorageError, type StorageAdapter } from "./types.js";

export function createStorageAdapter(option: ResolvedStorageOption): StorageAdapter {
  switch (option.kind) {
    case "local":
      return createLocalStorageAdapter(option.root);
    default:
      throw new StorageError(
        "unsupported",
        `storage.kind "${(option as { kind: string }).kind}" is not implemented yet.`,
      );
  }
}

export { StorageError };
export type { StorageAdapter, StorageStatEntry, StorageErrorCode } from "./types.js";
