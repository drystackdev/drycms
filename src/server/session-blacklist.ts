import { kv } from "./config.js";
import { createKeyValueAdapter, createRequestKeyValueAdapter } from "../kv/factory.js";
import { KeyValueStore } from "../kv/memory.js";

const BLACKLIST_NAMESPACE = "auth-blacklist";
const SESSION_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const moduleStore = kv.kind !== "D1" && kv.kind !== "KV"
  ? new KeyValueStore(createKeyValueAdapter(kv), {
      maxEntries: Math.max(kv.maxEntries, 1_000),
      maxBytes: kv.maxBytes,
      cleanupIntervalMs: kv.cleanupIntervalMs,
      flushDebounceMs: kv.flushDebounceMs,
      flushBatchSize: kv.flushBatchSize,
      durability: kv.durability,
    })
  : undefined;
const requestStores = new WeakMap<object, KeyValueStore>();

function storeFor(env: Record<string, unknown>): KeyValueStore {
  if (moduleStore) return moduleStore;
  const existing = requestStores.get(env);
  if (existing) return existing;
  const store = new KeyValueStore(createRequestKeyValueAdapter(kv, env), {
    maxEntries: Math.max(kv.maxEntries, 1_000),
    maxBytes: kv.maxBytes,
    cleanupIntervalMs: kv.cleanupIntervalMs,
    flushDebounceMs: kv.flushDebounceMs,
    flushBatchSize: kv.flushBatchSize,
    durability: kv.durability,
  });
  requestStores.set(env, store);
  return store;
}

async function tokenKey(token: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token)));
  return `token-${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** Returns true when the exact signed token was revoked by logout or rotation. */
export async function isSessionRevoked(token: string, env: Record<string, unknown> = {}): Promise<boolean> {
  return (await storeFor(env).get(BLACKLIST_NAMESPACE, await tokenKey(token))) !== null;
}

/** Persist a token revocation through the configured KV adapter. Sync durability
 * is intentional: logout/password rotation must survive a restart immediately. */
export async function revokeSession(token: string, env: Record<string, unknown> = {}): Promise<void> {
  await storeFor(env).set(BLACKLIST_NAMESPACE, await tokenKey(token), { revokedAt: new Date().toISOString() }, {
    ttlMs: SESSION_MAX_AGE_MS,
    durability: "sync",
  });
}
