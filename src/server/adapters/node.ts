import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { handleApiRequest, isApiRequest } from "../handler.js";

function requestUrl(req: IncomingMessage): string {
  const host = req.headers.host ?? "localhost";
  return `http://${host}${req.url ?? "/"}`;
}

/** `http.IncomingMessage` -> a real Fetch `Request` - the one real bridging
 * job the Node adapter has that Workers/Bun (already Fetch-native) don't. */
export function toFetchRequest(req: IncomingMessage): Request {
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else {
      headers.append(key, value);
    }
  }

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

/** A Fetch `Response` -> real bytes on the wire via `ServerResponse`. */
export async function sendFetchResponse(response: Response, res: ServerResponse): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));

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
