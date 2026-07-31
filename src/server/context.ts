/**
 * Minimal stand-in for Astro's `APIContext`, scoped to exactly what the
 * route handlers under `server/routes/` use. `env` replaces
 * `context.locals.runtime.env` (the Cloudflare-adapter-specific bag the D1
 * content engine reads its binding from) - the Node adapter passes `{}`
 * (D1 is never selectable outside a Workers-shaped runtime), a future
 * Workers adapter passes the real `env` argument from `fetch(request, env, ctx)`.
 */
export interface DryRouteContext {
  request: Request;
  url: URL;
  params: { slug?: string };
  env: Record<string, unknown>;
}

export type DryRouteHandler = (context: DryRouteContext) => Promise<Response>;
