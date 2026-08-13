import * as config from "./config.js";
import { createKeyValueAdapter, createRequestKeyValueAdapter } from "../kv/factory.js";
import { KeyValueStore } from "../kv/memory.js";
import type { KeyValueAdapter, KvBatchOperation, KvListOptions, KvListResult, KvRecord } from "../kv/types.js";

const SESSION_NAMESPACE = "auth-sessions";
const REFRESH_NAMESPACE = "auth-refresh";
const USER_NAMESPACE = "auth-users";
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** `status/mcp-server.md` - Personal Access Tokens for MCP clients (Claude
 * Desktop, Claude Code, ...). Same 2-namespace split as sessions/refresh
 * tokens above: `MCP_TOKEN_NAMESPACE` is the O(1) auth-time lookup (keyed by
 * the hash of the raw token, value is just a pointer), `MCP_TOKEN_INDEX_NAMESPACE`
 * is the per-user listing Profile's "API Token" section reads/revokes from
 * (keyed by user id, value is the metadata array - never the hash or raw
 * token). Long-lived - no TTL - since there's no refresh cycle for a PAT the
 * way there is for a browser session; a token is valid until explicitly
 * revoked. */
const MCP_TOKEN_NAMESPACE = "mcp-tokens";
const MCP_TOKEN_INDEX_NAMESPACE = "mcp-token-index";

export interface AuthSessionRecord {
  sessionId: string;
  userId: number;
  refreshTokenHash: string;
  sessionVersion: number;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  revokedAt?: string;
  revokeReason?: "logout" | "password-change" | "rotation" | "reuse";
  replacedBy?: string;
}

export interface AuthUserSecurityRecord {
  userId: number;
  sessionVersion: number;
  revokedAfter?: string;
  revokeReason?: "password-change" | "reuse";
  updatedAt: string;
}

const kv = "kv" in config ? config.kv : undefined;
const fallbackRecords = new Map<string, KvRecord>();
const fallbackAdapter: KeyValueAdapter = {
  async get(namespace, key) { return fallbackRecords.get(`${namespace}\u0000${key}`) ?? null; },
  async take(namespace, key) {
    const id = `${namespace}\u0000${key}`;
    const record = fallbackRecords.get(id) ?? null;
    if (record) fallbackRecords.delete(id);
    return record;
  },
  async set(record) { fallbackRecords.set(`${record.namespace}\u0000${record.key}`, record); },
  async delete(namespace, key) { fallbackRecords.delete(`${namespace}\u0000${key}`); },
  async list(namespace, options: KvListOptions = {}): Promise<KvListResult> {
    const items = [...fallbackRecords.values()].filter((record) => record.namespace === namespace).map(({ value: _value, ...meta }) => ({ ...meta, sizeBytes: JSON.stringify(_value).length }));
    return { items: items.slice(0, options.limit ?? 50) };
  },
  async batch(operations: KvBatchOperation[]) { for (const operation of operations) { if (operation.type === "delete") await this.delete(operation.namespace, operation.key); else if (operation.record) await this.set(operation.record); } },
};

const moduleStore = !kv || (kv.kind !== "D1" && kv.kind !== "KV")
  ? new KeyValueStore(kv ? createKeyValueAdapter(kv) : fallbackAdapter, {
      maxEntries: Math.max(kv?.maxEntries ?? 2_000, 2_000),
      cache: false,
      maxBytes: kv?.maxBytes ?? 16 * 1024 * 1024,
      cleanupIntervalMs: kv?.cleanupIntervalMs ?? 30_000,
      flushDebounceMs: kv?.flushDebounceMs ?? 100,
      flushBatchSize: kv?.flushBatchSize ?? 100,
      durability: kv?.durability ?? "sync",
    })
  : undefined;
const requestStores = new WeakMap<object, KeyValueStore>();
const refreshLocks = new Map<string, Promise<void>>();
/** How long a rotation will wait for the previous one on the same token
 * before going ahead anyway - see `awaitPreviousLock`. Comfortably above a
 * real rotation's cost (~3s at the worst observed on Workers/KV), so this
 * only ever fires for a lock that is never coming back. */
const REFRESH_LOCK_WAIT_MS = 10_000;

/**
 * Waits for the previous holder of a lock, but NEVER forever.
 *
 * These locks chain one request's promise into the next request's `await`,
 * and the release only happens in the holder's own `finally`. On Workers a
 * request that goes away mid-flight (the admin reloads the page, or the
 * client aborts the fetch) has its pending I/O canceled: the `try` body
 * never settles, so that `finally` never runs and the promise is never
 * resolved OR rejected. Every later request for the same key then awaits a
 * promise that can't complete - hanging with no response, no error and no
 * `wrangler tail` event (an invocation is only logged once it ends), for the
 * whole life of the isolate. That is exactly what took `/dry/api/auth/refresh`
 * down in production on 2026-08-12, and with it the admin UI: the browser
 * holds a Web Lock across its refresh (`store/auth.ts`), so one wedged
 * rotation left every 401-retry in every tab spinning silently.
 *
 * Timing out here costs one slow request and then heals the chain: the
 * waiter has already installed ITS own promise as the current lock, and it
 * does release that one.
 */
async function awaitPreviousLock(previous: Promise<void>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      previous,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function storeFor(env: Record<string, unknown>): KeyValueStore {
  if (moduleStore) return moduleStore;
  if (!kv) return new KeyValueStore(fallbackAdapter, { durability: "memory" });
  const existing = requestStores.get(env);
  if (existing) return existing;
  const store = new KeyValueStore(createRequestKeyValueAdapter(kv, env), {
    maxEntries: Math.max(kv.maxEntries, 2_000),
    cache: false,
    maxBytes: kv.maxBytes,
    cleanupIntervalMs: kv.cleanupIntervalMs,
    flushDebounceMs: kv.flushDebounceMs,
    flushBatchSize: kv.flushBatchSize,
    durability: kv.durability,
  });
  requestStores.set(env, store);
  return store;
}

export function getAuthSecurityStore(env: Record<string, unknown> = {}): KeyValueStore {
  return storeFor(env);
}

async function hash(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function userKey(userId: number): string {
  return `user-${userId}`;
}

function sessionKey(sessionId: string): string {
  return `session-${sessionId}`;
}

async function userSecurity(userId: number, env: Record<string, unknown>): Promise<AuthUserSecurityRecord> {
  return (await storeFor(env).get<AuthUserSecurityRecord>(USER_NAMESPACE, userKey(userId))) ?? {
    userId,
    sessionVersion: 1,
    updatedAt: new Date(0).toISOString(),
  };
}

function randomToken(): string {
  return `${crypto.randomUUID()}.${crypto.randomUUID()}`;
}

export async function createAuthSession(userId: number, env: Record<string, unknown> = {}): Promise<{ sessionId: string; refreshToken: string }> {
  const sessionId = crypto.randomUUID();
  const refreshToken = randomToken();
  const now = Date.now();
  const record: AuthSessionRecord = {
    sessionId,
    userId,
    refreshTokenHash: await hash(refreshToken),
    sessionVersion: (await userSecurity(userId, env)).sessionVersion,
    createdAt: new Date(now).toISOString(),
    lastUsedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + REFRESH_TTL_MS).toISOString(),
  };
  const store = storeFor(env);
  await store.set(SESSION_NAMESPACE, sessionKey(sessionId), record, { ttlMs: REFRESH_TTL_MS, durability: "sync" });
  await store.set(REFRESH_NAMESPACE, `token-${record.refreshTokenHash}`, { sessionId }, { ttlMs: REFRESH_TTL_MS, durability: "sync" });
  return { sessionId, refreshToken };
}

export async function getAuthSession(sessionId: string, env: Record<string, unknown> = {}): Promise<AuthSessionRecord | null> {
  return storeFor(env).get<AuthSessionRecord>(SESSION_NAMESPACE, sessionKey(sessionId));
}

export async function isAuthSessionValid(sessionId: string, userId: number, issuedAtSeconds: number, env: Record<string, unknown> = {}): Promise<boolean> {
  const record = await getAuthSession(sessionId, env);
  if (!record || record.userId !== userId || record.revokedAt || Date.parse(record.expiresAt) <= Date.now()) return false;
  const security = await userSecurity(userId, env);
  return record.sessionVersion === security.sessionVersion &&
    (!security.revokedAfter || issuedAtSeconds * 1000 >= Date.parse(security.revokedAfter));
}

export async function revokeAuthSession(sessionId: string, reason: AuthSessionRecord["revokeReason"], env: Record<string, unknown> = {}): Promise<void> {
  const store = storeFor(env);
  const record = await getAuthSession(sessionId, env);
  if (!record || record.revokedAt) return;
  await store.set(SESSION_NAMESPACE, sessionKey(sessionId), {
    ...record,
    revokedAt: new Date().toISOString(),
    revokeReason: reason,
  }, { ttlMs: Math.max(1, Date.parse(record.expiresAt) - Date.now()), durability: "sync" });
  await store.delete(REFRESH_NAMESPACE, `token-${record.refreshTokenHash}`);
}

export async function revokeAllAuthSessions(userId: number, reason: "password-change" | "reuse", env: Record<string, unknown> = {}): Promise<void> {
  const store = storeFor(env);
  const current = await userSecurity(userId, env);
  await store.set(USER_NAMESPACE, userKey(userId), {
    userId,
    sessionVersion: current.sessionVersion + 1,
    revokedAfter: new Date().toISOString(),
    revokeReason: reason,
    updatedAt: new Date().toISOString(),
  } satisfies AuthUserSecurityRecord, { durability: "sync" });
  // Existing session records become invalid through the version check. Their
  // TTL cleanup is intentionally deferred so this path stays O(1).
}

export async function rotateAuthSession(refreshToken: string, env: Record<string, unknown> = {}): Promise<{ session: AuthSessionRecord; refreshToken: string } | null> {
  const tokenHash = await hash(refreshToken);
  const previous = refreshLocks.get(tokenHash) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  refreshLocks.set(tokenHash, current);
  await awaitPreviousLock(previous, REFRESH_LOCK_WAIT_MS);
  try {
    const store = storeFor(env);
    // Consuming the refresh index makes rotation single-use across processes
    // for local/SQLite/D1 backends. Cloudflare KV cannot provide a compare-and-
    // delete primitive, so its adapter remains best-effort.
    const index = await store.take<{ sessionId: string }>(REFRESH_NAMESPACE, `token-${tokenHash}`);
    if (!index) return null;
    const session = await getAuthSession(index.sessionId, env);
    if (!session || Date.parse(session.expiresAt) <= Date.now() || session.refreshTokenHash !== tokenHash) return null;
    if (session.revokedAt) {
      if (session.replacedBy) await revokeAllAuthSessions(session.userId, "reuse", env);
      return null;
    }
    const next = await createAuthSession(session.userId, env);
    const revokedAt = new Date().toISOString();
    await store.set(SESSION_NAMESPACE, sessionKey(session.sessionId), {
      ...session,
      revokedAt,
      revokeReason: "rotation",
      replacedBy: next.sessionId,
    }, { ttlMs: Math.max(1, Date.parse(session.expiresAt) - Date.now()), durability: "sync" });
    // Keep a one-shot reuse marker for the old token. A later presentation of
    // the consumed token can then detect the revoked/replaced session and
    // revoke the whole family instead of being indistinguishable from an
    // unknown token.
    await store.set(REFRESH_NAMESPACE, `token-${tokenHash}`, { sessionId: session.sessionId }, {
      ttlMs: Math.max(1, Date.parse(session.expiresAt) - Date.now()),
      durability: "sync",
    });
    const replacement = await getAuthSession(next.sessionId, env);
    if (!replacement) return null;
    return { session: replacement, refreshToken: next.refreshToken };
  } finally {
    release();
    if (refreshLocks.get(tokenHash) === current) refreshLocks.delete(tokenHash);
  }
}

/** Metadata shown/managed in Profile's "API Token" list - deliberately never
 * carries the raw token or its hash (those stay in `MCP_TOKEN_NAMESPACE`,
 * write-only from this module's own perspective too - nothing here ever
 * reads a raw token back out). */
export interface McpTokenMeta {
  tokenId: string;
  label: string;
  createdAt: string;
  lastUsedAt: string;
}

interface McpTokenLookup {
  tokenId: string;
  userId: number;
}

function mcpTokenIndexKey(userId: number): string {
  return `user-${userId}`;
}

/** Generates a new PAT for `userId`, returning the raw token exactly once -
 * same "shown once, never retrievable again" contract a secretkey field
 * already has elsewhere in this app. Only the hash is ever persisted.
 *
 * `ttlMs` makes the token expire on its own, which is what an OAuth-issued
 * access token needs (`routes/oauth.ts` pairs it with a refresh token and
 * reports the same lifetime as `expires_in`); a hand-created PAT from the
 * Profile screen passes nothing and stays revoke-only, as before. */
export async function createMcpToken(
  userId: number,
  label: string,
  env: Record<string, unknown> = {},
  options: { ttlMs?: number } = {},
): Promise<{ tokenId: string; token: string }> {
  const store = storeFor(env);
  const tokenId = crypto.randomUUID();
  const token = `mcp_${randomToken()}`;
  const now = new Date().toISOString();
  await store.set(MCP_TOKEN_NAMESPACE, `token-${await hash(token)}`, { tokenId, userId } satisfies McpTokenLookup, {
    durability: "sync",
    ...(options.ttlMs ? { ttlMs: options.ttlMs } : {}),
  });
  const index = (await store.get<McpTokenMeta[]>(MCP_TOKEN_INDEX_NAMESPACE, mcpTokenIndexKey(userId))) ?? [];
  index.push({ tokenId, label, createdAt: now, lastUsedAt: now });
  await store.set(MCP_TOKEN_INDEX_NAMESPACE, mcpTokenIndexKey(userId), index, { durability: "sync" });
  return { tokenId, token };
}

export async function listMcpTokens(userId: number, env: Record<string, unknown> = {}): Promise<McpTokenMeta[]> {
  return (await storeFor(env).get<McpTokenMeta[]>(MCP_TOKEN_INDEX_NAMESPACE, mcpTokenIndexKey(userId))) ?? [];
}

/** Removes `tokenId` from `userId`'s own index only - a caller can never
 * revoke another user's token by guessing its id. The matching
 * `MCP_TOKEN_NAMESPACE` hash entry is deliberately left in place rather than
 * scanned for and deleted (there's no reverse index from `tokenId` back to
 * its hash); `resolveMcpToken` below re-checks the index on every call, so a
 * revoked token stops authenticating immediately regardless. */
export async function revokeMcpToken(userId: number, tokenId: string, env: Record<string, unknown> = {}): Promise<void> {
  const store = storeFor(env);
  const index = (await store.get<McpTokenMeta[]>(MCP_TOKEN_INDEX_NAMESPACE, mcpTokenIndexKey(userId))) ?? [];
  const next = index.filter((entry) => entry.tokenId !== tokenId);
  if (next.length === index.length) return;
  await store.set(MCP_TOKEN_INDEX_NAMESPACE, mcpTokenIndexKey(userId), next, { durability: "sync" });
}

/** Resolves a raw `Authorization: Bearer <token>` value to the user id that
 * owns it - `null` for an unknown OR revoked token (the two are
 * indistinguishable on purpose, same as every other auth lookup in this
 * file). Bumps `lastUsedAt` best-effort (fire-and-forget - a failed write
 * here must never fail the request it's authenticating). */
export async function resolveMcpToken(token: string, env: Record<string, unknown> = {}): Promise<{ userId: number } | null> {
  const store = storeFor(env);
  const lookup = await store.get<McpTokenLookup>(MCP_TOKEN_NAMESPACE, `token-${await hash(token)}`);
  if (!lookup) return null;
  const index = (await store.get<McpTokenMeta[]>(MCP_TOKEN_INDEX_NAMESPACE, mcpTokenIndexKey(lookup.userId))) ?? [];
  const meta = index.find((entry) => entry.tokenId === lookup.tokenId);
  if (!meta) return null;
  meta.lastUsedAt = new Date().toISOString();
  void store.set(MCP_TOKEN_INDEX_NAMESPACE, mcpTokenIndexKey(lookup.userId), index, { durability: "sync" });
  return { userId: lookup.userId };
}
