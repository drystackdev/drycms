let cached: string | undefined;

/**
 * Stable for the lifetime of this server process/isolate, fresh on every
 * restart - exactly the invalidation signal `pages-cache.ts` needs (see
 * `plans/app-router.md`'s "buildId - lưu như metadata trong chính file
 * cache"): a redeploy always treats every old cache entry as a miss on its
 * very first request, without namespacing cache paths per build. Uses the
 * global Web Crypto `randomUUID()` (not `node:crypto`'s) so this module has
 * no Node-only dependency and works unchanged on a Workers isolate - Giai
 * đoạn 3 (production build) may later replace this with a real build-time
 * content-hash computed once during `vite build` instead; not needed until
 * that pipeline exists, and "fresh per process start" already satisfies the
 * same contract.
 *
 * Computed on FIRST CALL rather than at module load, and memoized after:
 * workerd forbids generating random values in global scope ("Disallowed
 * operation called within global scope"), which a module-scope
 * `crypto.randomUUID()` here would trip while Cloudflare is merely
 * validating the uploaded script - before any request runs. Both call sites
 * are already request-time, so the memoized value is just as stable as a
 * module-scope constant was.
 */
export function buildId(): string {
  return (cached ??= crypto.randomUUID());
}
