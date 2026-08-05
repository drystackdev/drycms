import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { handleApiRequest, isApiRequest } from "../handler.js";

function requestUrl(req: IncomingMessage): string {
  const configuredOrigin = process.env.DRYCMS_PUBLIC_ORIGIN?.trim();
  if (configuredOrigin) {
    try {
      const origin = new URL(configuredOrigin);
      if (origin.protocol === "http:" || origin.protocol === "https:") {
        return `${origin.origin}${req.url ?? "/"}`;
      }
    } catch {
      // Fall through to the validated request host below; a bad deployment
      // setting must not create an invalid Request or crash the server.
    }
  }
  const host = req.headers.host ?? "localhost";
  const allowedHosts = process.env.DRYCMS_ALLOWED_HOSTS?.split(",").map((value) => value.trim()).filter(Boolean);
  const safeHost = /^[a-zA-Z0-9.-]+(?::\d+)?$/.test(host) && (!allowedHosts?.length || allowedHosts.includes(host))
    ? host
    : "localhost";
  const trustProxy = /^(1|true|yes)$/i.test(process.env.DRYCMS_TRUST_PROXY ?? "");
  const forwardedProtocol = trustProxy ? req.headers["x-forwarded-proto"] : undefined;
  const protocol = (Array.isArray(forwardedProtocol) ? forwardedProtocol[0] : forwardedProtocol)?.split(",")[0]?.trim();
  return `${protocol === "https" ? "https" : "http"}://${safeHost}${req.url ?? "/"}`;
}

/** `http.IncomingMessage` -> a real Fetch `Request` - the one real bridging
 * job the Node adapter has that Workers/Bun (already Fetch-native) don't. */
export function toFetchRequest(req: IncomingMessage): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (key.toLowerCase() === "x-drycms-client-ip") continue;
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.append(key, value);
    }
  }
  if (req.socket.remoteAddress) headers.set("X-DryCMS-Client-IP", req.socket.remoteAddress);

  const method = req.method ?? "GET";
  // A GET/HEAD `Request` isn't allowed a body at all (the constructor
  // throws) - Node's own `IncomingMessage` doesn't distinguish, so this has
  // to gate on method the same way the Fetch spec does.
  const hasBody = method !== "GET" && method !== "HEAD";

  return new Request(requestUrl(req), {
    method,
    headers,
    body: hasBody ? (Readable.toWeb(req) as unknown as ReadableStream) : undefined,
    // Required by Node's `Request` constructor whenever `body` is a stream
    // (signals the body is consumed incrementally, not buffered up front).
    ...(hasBody ? { duplex: "half" } : {}),
  } as RequestInit);
}

export function applySecurityHeaders(res: ServerResponse): void {
  if (!res.hasHeader("X-Content-Type-Options")) res.setHeader("X-Content-Type-Options", "nosniff");
  // `SAMEORIGIN`, not `DENY`: the Visual Editing Interface (`plans/vei.md`)
  // frames the admin's own entry editor inside a public page of the same
  // origin. Cross-origin framing - the actual clickjacking vector - stays
  // blocked, and `handler.ts`'s API responses still set `DENY` explicitly
  // (response headers are copied over these defaults, not under them).
  if (!res.hasHeader("X-Frame-Options")) res.setHeader("X-Frame-Options", "SAMEORIGIN");
  if (!res.hasHeader("Referrer-Policy")) res.setHeader("Referrer-Policy", "no-referrer");
  if (!res.hasHeader("Permissions-Policy")) res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

/** A Fetch `Response` -> real bytes on the wire via `ServerResponse`. */
export async function sendFetchResponse(response: Response, res: ServerResponse): Promise<void> {
  res.statusCode = response.status;
  applySecurityHeaders(res);
  const headersWithCookies = response.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies = headersWithCookies.getSetCookie?.();
  response.headers.forEach((value, key) => {
    if (key !== "set-cookie") res.setHeader(key, value);
  });
  if (setCookies?.length) res.setHeader("Set-Cookie", setCookies);

  if (!response.body) {
    res.end();
    return;
  }

  const nodeStream = Readable.fromWeb(response.body as unknown as NodeWebReadableStream);
  await new Promise<void>((resolve, reject) => {
    nodeStream.pipe(res);
    nodeStream.on("error", reject);
    res.on("finish", resolve);
  });
}

/**
 * A Connect-style middleware - mountable in front of both Vite's dev
 * middlewares (`scripts/dev-server.mjs`) and the production static-file
 * server (`server/entry-node.ts`) identically. `env` is always `{}` here -
 * the D1 content engine (the only thing that ever reads `context.env`) isn't
 * reachable outside a Workers-shaped runtime, so there's nothing to put in it
 * - see `context.ts`'s doc comment.
 */
export function createApiMiddleware() {
  return async function apiMiddleware(
    req: IncomingMessage,
    res: ServerResponse,
    next: (err?: unknown) => void,
  ): Promise<void> {
    const url = new URL(requestUrl(req));
    if (!isApiRequest(url.pathname)) {
      next();
      return;
    }
    try {
      const request = toFetchRequest(req);
      const response = await handleApiRequest(request, {});
      await sendFetchResponse(response, res);
    } catch (error) {
      next(error);
    }
  };
}
