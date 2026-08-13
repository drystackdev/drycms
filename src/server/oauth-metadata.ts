import { path as basePath } from "./config.js";
import { resolveSiteOrigin } from "./app-router/site-origin.js";

/**
 * `status/mcp-oauth.md` - the two OAuth discovery documents (RFC 8414
 * Authorization Server Metadata, RFC 9728 Protected Resource Metadata) MUST
 * live at a bare-root `.well-known/*` URL - a client resolves them before it
 * knows anything else about this server, so they can't be nested under
 * `${basePath}/api/` the way every other route in this app is. Served the
 * same way `google-verification.ts`'s `tryServeGoogleVerificationFile` is: a
 * pure, cheap-pathname-filtered function called from `page-handler.ts`,
 * ahead of any DB/route work, with no session/KV access of its own. The
 * actual protocol endpoints these documents point to
 * (`authorization_endpoint`/`token_endpoint`/`registration_endpoint`) are
 * ordinary routes under `${basePath}/api/oauth/*` (`routes/oauth.ts`) - only
 * these two documents need the bare-root treatment.
 *
 * Both the RFC 8414 §3.1/RFC 9728 §3.1 path-inserted form and a bare
 * fallback (some clients don't path-insert) are served with identical
 * content, since one deployment always serves exactly one resource/issuer -
 * there's no ambiguity a bare fallback could introduce here.
 */
export function tryServeOAuthMetadata(request: Request): Response | null {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);
  const origin = resolveSiteOrigin(url);
  const mcpUrl = `${origin}${basePath}/api/mcp`;

  const protectedResourcePaths = new Set([
    `/.well-known/oauth-protected-resource${basePath}/api/mcp`,
    "/.well-known/oauth-protected-resource",
  ]);
  if (protectedResourcePaths.has(url.pathname)) {
    return jsonMetadata({
      resource: mcpUrl,
      authorization_servers: [origin],
    });
  }

  const authorizationServerPaths = new Set([
    `/.well-known/oauth-authorization-server${basePath}`,
    "/.well-known/oauth-authorization-server",
  ]);
  if (authorizationServerPaths.has(url.pathname)) {
    return jsonMetadata({
      issuer: origin,
      authorization_endpoint: `${origin}${basePath}/api/oauth/authorize`,
      token_endpoint: `${origin}${basePath}/api/oauth/token`,
      registration_endpoint: `${origin}${basePath}/api/oauth/register`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
    });
  }

  return null;
}

function jsonMetadata(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** The canonical (path-inserted) protected-resource-metadata URL, pointed to
 * by `mcp.ts`'s 401 `WWW-Authenticate` header so a client can discover the
 * flow without guessing. */
export function protectedResourceMetadataUrl(origin: string): string {
  return `${origin}/.well-known/oauth-protected-resource${basePath}/api/mcp`;
}
