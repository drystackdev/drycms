export const MAX_JSON_BODY_BYTES = 2 * 1024 * 1024;
export const MAX_UPLOAD_BODY_BYTES = 50 * 1024 * 1024;
/** Magic Write's own request can carry several base64-encoded context images
 * (already client-resized to ~240px, but base64 still inflates raw bytes
 * ~33%) - well past the generic 2 MiB JSON cap, nowhere near a real upload's
 * 50 MiB. See `status/magic-write.md` decision #3. */
export const MAX_MAGIC_WRITE_BODY_BYTES = 6 * 1024 * 1024;
/** The Page Editor's Magic Chat (`status/page-editor-magic-chat.md`) resends
 * the open file's full current text plus prior-turn summaries on every
 * request - a real source file can exceed the generic 2 MiB JSON cap well
 * before hitting `ai-page-source-write.ts`'s own 150,000-character content
 * check. */
export const MAX_PAGE_SOURCE_AI_BODY_BYTES = 4 * 1024 * 1024;

export class RequestBodyLimitError extends Error {
  constructor() {
    super("Request body is too large.");
    this.name = "RequestBodyLimitError";
  }
}

function jsonResponse(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

export function maxBodyBytesFor(segment: string, slug?: string): number {
  if (segment === "storage") return MAX_UPLOAD_BODY_BYTES;
  // A restore upload is a full SQL dump of the content DB - easily bigger
  // than the generic 2 MiB JSON cap for any real site, same ceiling as a
  // Media upload.
  if (segment === "backup") return MAX_UPLOAD_BODY_BYTES;
  if (segment === "ai" && slug === "magic-write") return MAX_MAGIC_WRITE_BODY_BYTES;
  if (segment === "page-source-ai") return MAX_PAGE_SOURCE_AI_BODY_BYTES;
  return MAX_JSON_BODY_BYTES;
}

/** Reject declared oversized bodies before a route calls json(), text(), or
 * formData(). A reverse proxy should enforce the same limits for chunked
 * requests; this check still closes the common Content-Length bypass. */
export function bodyLimitResponse(request: Request, segment: string, method: string, slug?: string): Response | null {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return null;
  const raw = request.headers.get("content-length");
  if (raw === null) return null;
  const length = Number(raw);
  if (!Number.isSafeInteger(length) || length < 0) return jsonResponse({ error: "invalid_content_length", message: "Invalid Content-Length." }, 400);
  const limit = maxBodyBytesFor(segment, slug);
  return length > limit
    ? jsonResponse({ error: "request_too_large", message: `Request body exceeds the ${Math.floor(limit / 1024 / 1024)} MiB limit.` }, 413)
    : null;
}

/** Enforce the same limit for chunked requests that do not carry a
 * Content-Length header. The route receives a one-shot replacement Request,
 * so its existing json/formData/stream code remains unchanged. */
export function limitRequestBody(request: Request, segment: string, method: string, slug?: string): Request {
  if (method === "GET" || method === "HEAD" || method === "OPTIONS" || !request.body) return request;
  const reader = request.body.getReader();
  const limit = maxBodyBytesFor(segment, slug);
  let total = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        total += value.byteLength;
        if (total > limit) {
          await reader.cancel();
          controller.error(new RequestBodyLimitError());
          return;
        }
        controller.enqueue(value);
      } catch (error) {
        controller.error(error);
      }
    },
    cancel(reason) {
      void reader.cancel(reason);
    },
  });
  return new Request(request, { body, duplex: "half" } as RequestInit & { duplex: "half" });
}
