export const prerender = false;

import { Readable } from "node:stream";
import type { APIContext, APIRoute } from "astro";
import { storage } from "virtual:drycms/storage-config";
import type { FileEntry } from "../components/file-manager-types.js";
import { extensionToCategory } from "../components/file-manager-utils.js";
import { toFileEntry } from "../storage/entry.js";
import { createStorageAdapter } from "../storage/index.js";
import {
  joinStoragePath,
  normalizeStoragePath,
  storagePathParent,
} from "../storage/path.js";
import { StorageError } from "../storage/types.js";

const adapter = createStorageAdapter(storage);

const STATUS_BY_CODE: Record<string, number> = {
  invalid_path: 400,
  not_found: 404,
  already_exists: 409,
  unsupported: 501,
};

const MIME_TYPES: Record<string, string> = {
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

function mimeType(name: string): string {
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return "application/octet-stream";
  return MIME_TYPES[name.slice(dot + 1).toLowerCase()] ?? "application/octet-stream";
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errorResponse(error: unknown): Response {
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
 * (Astro doesn't decode rest params) - has to be decoded here, at the URL
 * boundary, rather than inside `normalizeStoragePath` itself, since that
 * function is also used to validate body fields (`to`, `name`) that are
 * plain JSON strings and were never encoded to begin with. */
function readSlug(context: APIContext): string {
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

/** The literal `/api/storage` segment always immediately precedes the slug,
 * regardless of the (configurable) admin base path - safe to derive from any
 * request to this route. Used to build `previewUrl`s pointing at this same route. */
function apiBaseFrom(url: URL): string {
  return url.pathname.replace(/\/api\/storage\/.+$/, "/api/storage");
}

function toUrlPath(relativePath: string): string {
  return relativePath.split("/").map(encodeURIComponent).join("/");
}

function withPreview(entry: FileEntry, apiBase: string): FileEntry {
  if (entry.kind === "file" && entry.ext && extensionToCategory(entry.ext) === "image") {
    return { ...entry, previewUrl: `${apiBase}/${toUrlPath(entry.id)}` };
  }
  return entry;
}

/** A name for a single new file/folder within an existing parent - not a
 * general slug, so multi-segment names are rejected up front (nested-path
 * creation isn't a supported product surface yet). */
function readLeafName(raw: unknown): string {
  const name = typeof raw === "string" ? raw.trim() : "";
  if (!name || name.includes("/")) {
    throw new StorageError("invalid_path", `Invalid name "${String(raw)}".`);
  }
  return name;
}

export const GET: APIRoute = async (context) => {
  try {
    const path = readSlug(context);
    const stat = await adapter.stat(path);
    if (!stat) throw new StorageError("not_found", `"${path}" does not exist.`);

    if (stat.kind === "folder") {
      const children = await adapter.list(path);
      const apiBase = apiBaseFrom(context.url);
      const entries = children.map((child) => withPreview(toFileEntry(child), apiBase));
      return jsonResponse({ path, entries });
    }

    const file = await adapter.read(path);
    return new Response(Readable.toWeb(file.stream) as unknown as ReadableStream, {
      status: 200,
      headers: {
        "Content-Type": mimeType(stat.name),
        "Content-Length": String(file.size),
        "Last-Modified": new Date(file.modifiedAt).toUTCString(),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
};

async function handleUpload(request: Request, folder: string): Promise<Response> {
  const target = await adapter.stat(folder);
  if (!target || target.kind !== "folder") {
    throw new StorageError("not_found", `"${folder}" is not an existing folder.`);
  }

  const form = await request.formData();
  const files = form.getAll("files").filter((value): value is File => value instanceof File);
  if (files.length === 0) {
    throw new StorageError("invalid_path", "No files in the upload.");
  }

  const entries: FileEntry[] = [];
  for (const file of files) {
    const name = readLeafName(file.name);
    const targetPath = normalizeStoragePath(joinStoragePath(folder, name));
    if (await adapter.stat(targetPath)) {
      throw new StorageError("already_exists", `"${targetPath}" already exists.`);
    }
    const stat = await adapter.write(
      targetPath,
      Readable.fromWeb(file.stream() as Parameters<typeof Readable.fromWeb>[0]),
    );
    entries.push(toFileEntry(stat));
  }
  return jsonResponse({ entries }, 201);
}

async function handleCreateFolder(request: Request, folder: string): Promise<Response> {
  const body = (await request.json()) as { action?: string; name?: unknown };
  if (body.action !== "mkdir") {
    throw new StorageError("invalid_path", `Unsupported action "${String(body.action)}".`);
  }
  const name = readLeafName(body.name);
  const targetPath = normalizeStoragePath(joinStoragePath(folder, name));
  const stat = await adapter.mkdir(targetPath);
  return jsonResponse({ entry: toFileEntry(stat) }, 201);
}

export const POST: APIRoute = async (context) => {
  try {
    const path = readSlug(context);
    const contentType = context.request.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      return await handleUpload(context.request, path);
    }
    if (contentType.includes("application/json")) {
      return await handleCreateFolder(context.request, path);
    }
    return jsonResponse(
      { error: "invalid_path", message: "Unsupported Content-Type." },
      415,
    );
  } catch (error) {
    return errorResponse(error);
  }
};

/** Backs the UI's Replace action: overwrite (or create) exactly one file's
 * bytes at `slug`. Kept separate from `POST` upload, which rejects on
 * collision - PUT is the deliberate "yes, overwrite this" path. */
export const PUT: APIRoute = async (context) => {
  try {
    const path = readSlug(context);
    if (!path) throw new StorageError("invalid_path", "A file path is required.");

    const existing = await adapter.stat(path);
    if (existing?.kind === "folder") {
      throw new StorageError("invalid_path", `"${path}" is a folder.`);
    }
    const parentStat = await adapter.stat(storagePathParent(path));
    if (!parentStat || parentStat.kind !== "folder") {
      throw new StorageError("not_found", `Parent folder for "${path}" does not exist.`);
    }

    const body = context.request.body;
    const data = body ? Readable.fromWeb(body as Parameters<typeof Readable.fromWeb>[0]) : new Uint8Array();
    const stat = await adapter.write(path, data);
    return jsonResponse({ entry: toFileEntry(stat) }, 200);
  } catch (error) {
    return errorResponse(error);
  }
};

export const PATCH: APIRoute = async (context) => {
  try {
    const from = readSlug(context);
    if (!from) throw new StorageError("invalid_path", "Cannot move/copy the storage root.");

    const body = (await context.request.json()) as { action?: string; to?: unknown };
    if (body.action !== "move" && body.action !== "copy") {
      throw new StorageError("invalid_path", `Unsupported action "${String(body.action)}".`);
    }
    const to = normalizeStoragePath(typeof body.to === "string" ? body.to : undefined);
    if (!to) throw new StorageError("invalid_path", "A destination path is required.");

    if (to === from) {
      const stat = await adapter.stat(from);
      if (!stat) throw new StorageError("not_found", `"${from}" does not exist.`);
      return jsonResponse({ entry: toFileEntry(stat) }, 200);
    }
    if (to.startsWith(`${from}/`)) {
      throw new StorageError(
        "invalid_path",
        "Cannot move/copy a folder into its own subtree.",
      );
    }

    const stat =
      body.action === "move" ? await adapter.move(from, to) : await adapter.copy(from, to);
    return jsonResponse({ entry: toFileEntry(stat) }, 200);
  } catch (error) {
    return errorResponse(error);
  }
};

export const DELETE: APIRoute = async (context) => {
  try {
    const path = readSlug(context);
    if (!path) throw new StorageError("invalid_path", "Cannot delete the storage root.");
    await adapter.remove(path);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
};
