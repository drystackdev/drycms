import type { ResolvedKvOption } from "../server/options.js";
import { createLocalKeyValueAdapter } from "./local.js";
import { createSqliteKeyValueAdapter } from "./sqlite.js";
import type { KeyValueAdapter } from "./types.js";
import { createD1KeyValueAdapter } from "./d1.js";
import { createCloudflareKvAdapter, type CloudflareKvNamespace } from "./cloudflare-kv.js";

export function createKeyValueAdapter(option: ResolvedKvOption): KeyValueAdapter {
  switch (option.kind) {
    case "local":
      return createLocalKeyValueAdapter(option.root);
    case "sqlite":
      return createSqliteKeyValueAdapter(option.file);
    case "D1":
    case "KV":
      throw new Error(`[drycms] KV adapter "${option.kind}" requires a request-bound runtime and is not available in the Node module adapter.`);
  }
}

export function createRequestKeyValueAdapter(option: ResolvedKvOption, env: Record<string, unknown>): KeyValueAdapter {
  const binding = env[option.kind === "D1" || option.kind === "KV" ? option.binding : ""];
  if (!binding) throw new Error(`[drycms] KV binding "${option.kind === "D1" || option.kind === "KV" ? option.binding : ""}" was not found in the request environment.`);
  return option.kind === "D1"
    ? createD1KeyValueAdapter(binding as Parameters<typeof createD1KeyValueAdapter>[0])
    : createCloudflareKvAdapter(binding as CloudflareKvNamespace);
}
