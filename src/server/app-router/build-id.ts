/**
 * Stable for the lifetime of this server process, fresh on every restart -
 * exactly the invalidation signal `pages-cache.ts` needs (see
 * `plans/app-router.md`'s "buildId - lưu như metadata trong chính file
 * cache"): a redeploy always treats every old cache entry as a miss on its
 * very first request, without namespacing cache paths per build. Computed
 * via the global Web Crypto `randomUUID()` (not `node:crypto`'s) at module
 * load for now, so this module has no Node-only dependency and works
 * unchanged on a Workers isolate - Giai đoạn 3 (production build) may later
 * replace this with a real build-time content-hash computed once during
 * `vite build` instead; not needed until that pipeline exists, and "fresh
 * per process start" already satisfies the same contract.
 */
export const BUILD_ID = crypto.randomUUID();
