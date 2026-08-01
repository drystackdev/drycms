import type { DryRouteContext } from "./context.js";
import { normalizeStoragePath } from "../storage/path.js";
import { StorageError } from "../storage/types.js";

/** Shared by every route backed by a `StorageAdapter` (`storage.ts`,
 * `icons.ts`) - the `StorageError`→HTTP-status mapping and file-serving MIME
 * lookup are identical regardless of which storage root is being served. */
export const STATUS_BY_CODE: Record<string, number> = {
  invalid_path: 400,
  not_found: 404,
  already_exists: 409,
  unsupported: 501,
};

export const MIME_TYPES: Record<string, string> = {
  css: "text/css",
  js: "text/javascript",
  mjs: "text/javascript",
  map: "application/json",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  mp4: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
  avi: "video/x-msvideo",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  pdf: "application/pdf",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
  zip: "application/zip",
};

export function mimeType(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "application/octet-stream";
  return MIME_TYPES[name.slice(dot + 1).toLowerCase()] ?? "application/octet-stream";
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Shared by every route that does its own resource-level authorization
 * check (`content-entries.ts`/`content-types.ts` - see `content-types/
 * access.ts`) on top of `handler.ts`'s central "must have a session at all"
 * gate, which their own direct-call unit tests bypass. */
export function unauthenticatedResponse(): Response {
  return jsonResponse({ error: "unauthenticated", message: "Sign in required." }, 401);
}

export function forbiddenResponse(message = "You don't have permission to do this."): Response {
  return jsonResponse({ error: "forbidden", message }, 403);
}

export function errorResponse(error: unknown): Response {
  if (error instanceof StorageError) {
    return jsonResponse(
      { error: error.code, message: error.message },
      STATUS_BY_CODE[error.code] ?? 500,
    );
  }
  return jsonResponse(
    { error: "internal", message: error instanceof Error ? error.message : "Internal error." },
    500,
  );
}

/** `context.params.slug` is the raw, still percent-encoded path segment
 * (`handler.ts` doesn't decode rest params) - has to be decoded here, at the URL
 * boundary, rather than inside `normalizeStoragePath` itself, since that
 * function is also used to validate body fields (`to`, `name`) that are
 * plain JSON strings and were never encoded to begin with. */
export function readSlug(context: DryRouteContext): string {
  const raw = context.params.slug as string | undefined;
  if (raw === undefined) return normalizeStoragePath(undefined);
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    throw new StorageError("invalid_path", "Path contains invalid percent-encoding.");
  }
  return normalizeStoragePath(decoded);
}

/** The literal `/api/${segment}` prefix always immediately precedes the
 * slug, regardless of the (configurable) admin base path - safe to derive
 * from any request to a route mounted at that pattern. Used to build
 * `previewUrl`s/`url`s pointing back at this same route.
 *
 * The trailing `(/.*)?` (rather than requiring at least one character after
 * the slash) matters at the root itself: a request for the bare folder
 * (`.../api/icons/`, empty rest-param) has nothing after that slash, and a
 * `.+$`-style pattern would then fail to match at all, silently leaving the
 * slash in and producing a double-slash the next time a caller does
 * `${apiBase}/${name}`. */
export function apiBaseFrom(url: URL, segment: string): string {
  return url.pathname.replace(new RegExp(`/api/${segment}(/.*)?$`), `/api/${segment}`);
}

export function toUrlPath(relativePath: string): string {
  return relativePath.split("/").map(encodeURIComponent).join("/");
}

/** A name for a single new file/folder within an existing parent - not a
 * general slug, so multi-segment names are rejected up front (nested-path
 * creation isn't a supported product surface yet). */
export function readLeafName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name || name.includes("/")) {
    throw new StorageError("invalid_path", `Invalid name "${String(raw)}".`);
  }
  return name;
}
