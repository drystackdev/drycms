import { getAuthSecurityStore } from "./auth-security.js";

const NAMESPACE = "auth-rate-limit";
const WINDOW_MS = 5 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;
const EMAIL_MAX = 5;
const IP_MAX = 20;

interface Counter {
  count: number;
  windowStartedAt: number;
  blockedUntil?: number;
}

const locks = new Map<string, Promise<void>>();

async function withLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  locks.set(key, current);
  await previous;
  try {
    return await work();
  } finally {
    release();
    if (locks.get(key) === current) locks.delete(key);
  }
}

function key(kind: "email" | "ip", value: string): string {
  return `${kind}-${value}`;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function ipFrom(request: Request): string {
  const forwarded = request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("CF-Connecting-IP")?.trim() || "unknown";
}

async function readCounter(counterKey: string, env: Record<string, unknown>): Promise<Counter | null> {
  return getAuthSecurityStore(env).get<Counter>(NAMESPACE, counterKey);
}

export async function isLoginRateLimited(request: Request, email: string, env: Record<string, unknown> = {}): Promise<boolean> {
  const now = Date.now();
  const store = getAuthSecurityStore(env);
  const blocked = await Promise.all([
    store.get<Counter>(NAMESPACE, `blocked-${key("email", normalizeEmail(email))}`),
    store.get<Counter>(NAMESPACE, `blocked-${key("ip", ipFrom(request))}`),
  ]);
  if (blocked.some((counter) => !!counter && !!counter.blockedUntil && counter.blockedUntil > now)) return true;
  const counters = await Promise.all([
    readCounter(key("email", normalizeEmail(email)), env),
    readCounter(key("ip", ipFrom(request)), env),
  ]);
  return counters.some((counter) => !!counter && !!counter.blockedUntil && counter.blockedUntil > now);
}

export async function recordLoginFailure(request: Request, email: string, env: Record<string, unknown> = {}): Promise<void> {
  const now = Date.now();
  const entries: Array<[string, number]> = [
    [key("email", normalizeEmail(email)), EMAIL_MAX],
    [key("ip", ipFrom(request)), IP_MAX],
  ];
  await Promise.all(entries.map(([counterKey, max]) => withLock(counterKey, async () => {
    const store = getAuthSecurityStore(env);
    const atomic = await store.incrementCounter(NAMESPACE, counterKey, WINDOW_MS, BLOCK_MS);
    if (atomic) {
      if (atomic.count >= max) {
        await store.set(NAMESPACE, `blocked-${counterKey}`, {
          count: atomic.count,
          windowStartedAt: atomic.windowStartedAt,
          blockedUntil: now + BLOCK_MS,
        } satisfies Counter, { ttlMs: BLOCK_MS, durability: "sync" });
      }
      return;
    }
    const previous = await store.get<Counter>(NAMESPACE, counterKey);
    const counter = !previous || now - previous.windowStartedAt >= WINDOW_MS
      ? { count: 1, windowStartedAt: now }
      : { ...previous, count: previous.count + 1 };
    if (counter.count >= max) counter.blockedUntil = now + BLOCK_MS;
    await store.set(NAMESPACE, counterKey, counter, { ttlMs: BLOCK_MS, durability: "sync" });
  })));
}

export async function clearLoginFailures(request: Request, email: string, env: Record<string, unknown> = {}): Promise<void> {
  const store = getAuthSecurityStore(env);
  const emailKey = key("email", normalizeEmail(email));
  await store.delete(NAMESPACE, emailKey);
  await store.delete(NAMESPACE, `blocked-${emailKey}`);
  if (await store.deleteCounter(NAMESPACE, emailKey)) return;
}
