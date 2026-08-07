import { readEnvVar } from "../options.js";

/**
 * The site's public origin (`https://example.com`, no trailing slash) for
 * building absolute URLs - canonical/`og:url` (`render.ts`), and every
 * `<loc>` in `sitemap.ts`. Prefers the deployment-configured `APP_DOMAIN`
 * env var (read via `options.ts`'s `readEnvVar`, the same `.env`-then-
 * `process.env` convention `DRYCMS_SECRET_KEY` etc. already use), falling
 * back to the current request's own resolved origin when it's unset or
 * invalid - so dev/preview environments need no configuration at all. Same
 * try/catch shape as `adapters/node.ts`'s `requestUrl()`, which already does
 * an equivalent override-vs-request-derived fallback for `DRYCMS_PUBLIC_ORIGIN`
 * (a different setting, for a different purpose - building the Node
 * adapter's `Request.url` itself, not the SEO tags built from it). The
 * overlap between the two is intentional, not an oversight - see
 * `status/seo-standard.md`.
 */
export function resolveSiteOrigin(url: URL): string {
  const configured = readEnvVar("APP_DOMAIN")?.trim();
  if (configured) {
    try {
      const origin = new URL(configured);
      if (origin.protocol === "http:" || origin.protocol === "https:") {
        return origin.origin;
      }
    } catch {
      // Fall through to the request's own origin below - a bad deployment
      // setting must not break every page's SEO tags.
    }
  }
  return url.origin;
}
