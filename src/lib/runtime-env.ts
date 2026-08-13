/**
 * Whether this specific execution is really running under Node, as opposed
 * to Cloudflare's own `workerd` runtime - a REQUEST-TIME check of the actual
 * host, not the same question as `import.meta.env.DEV`/`kind: "cloudflare"`
 * (both build-time/config signals, constant regardless of which runtime a
 * given deploy target actually executes on).
 *
 * `process.versions?.node` alone is NOT enough: workerd's own `nodejs_compat`
 * compatibility flag (`wrangler.jsonc`) populates a `process` polyfill whose
 * `versions.node` reads as a real, truthy version string too - found live,
 * 2026-08-13: `ensurePreactRuntimeAsset` (`built-pages-storage.ts`) used
 * exactly that check to decide whether it was safe to run a nested
 * `vite build()` (Node/rolldown-only tooling) and, under `wrangler dev`,
 * wrongly concluded yes - the attempt crashed 3 layers deep on a native
 * binding load (`node:module`'s `createRequire` receiving `undefined`),
 * surfaced to a real request as an opaque 500 with no hint this was a
 * runtime-detection bug. `navigator.userAgent === "Cloudflare-Workers"` is
 * Cloudflare's own stable, documented identifier for "this IS workerd"
 * (unaffected by `nodejs_compat`, which only patches `node:*` built-ins, not
 * the Workers-native `navigator` global) - excluding it is what actually
 * distinguishes real Node from the compat shim.
 */
export function isNodeRuntime(): boolean {
  if (typeof process === "undefined" || !process.versions?.node) return false;
  if (typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers") return false;
  return true;
}
