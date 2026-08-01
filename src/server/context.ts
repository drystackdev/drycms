import type { SessionPayload } from "../lib/session-token.js";

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
  /** Resolved once by `handler.ts` (`server/session.ts`'s `resolveSession`)
   * from the request's `Cookie` header, for every route including `auth`
   * itself - `null` if there's no cookie or it doesn't verify. `handler.ts`
   * already rejects with 401 before dispatch for every segment except
   * `auth` when this is `null`, but `content-entries.ts`/`content-types.ts`
   * check it again themselves (for their own direct-call unit tests, which
   * bypass `handler.ts` entirely) before doing any resource-level
   * authorization - see `content-types/access.ts`. Required (not optional)
   * so every `DryRouteContext` literal - real or test-built - has to name it
   * explicitly rather than silently defaulting to "no session". */
  session: SessionPayload | null;
  /** Raw cookie token, retained for revocation on logout/password change. */
  sessionToken?: string;
}

export type DryRouteHandler = (context: DryRouteContext) => Promise<Response>;
