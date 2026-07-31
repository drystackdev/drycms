import { Readable } from "node:stream";
import type { DryRouteHandler } from "../context.js";
import { storage } from "../config.js";
import type { FileEntry } from "../../components/file-manager-types.js";
import { extensionToCategory } from "../../components/file-manager-utils.js";
import {
  apiBaseFrom,
  errorResponse,
  jsonResponse,
  mimeType,
  readLeafName,
  readSlug,
  toUrlPath,
} from "../route-helpers.js";
import { toFileEntry } from "../../storage/entry.js";
import { createStorageAdapter } from "../../storage/index.js";
import { joinStoragePath, normalizeStoragePath, storagePathParent } from "../../storage/path.js";
import { StorageError } from "../../storage/types.js";

const adapter = createStorageAdapter(storage);

function withPreview(entry: FileEntry, apiBase: string): FileEntry {
  if (entry.kind === "file" && entry.ext && extensionToCategory(entry.ext) === "image") {
    return { ...entry, previewUrl: `${apiBase}/${toUrlPath(entry.id)}` };
  }
  return entry;
}

/** `?tree` prefetches the whole storage tree in one response (see
 * `StorageAdapter.listAll`) instead of one folder at a time - only valid at
 * the root, and only actually available when the configured `storage.kind`
 * implements `listAll` (not R2/S3). `supported: false` tells the client to
 * fall back to per-folder `list()`, same contract as every other optional
 * `FileManagerSource` method. */
async function handleTree(apiBase: string): Promise<Response> {
  if (!adapter.listAll) return jsonResponse({ supported: false });
  const all = await adapter.listAll();
  const entries = all.map((entry) => withPreview(toFileEntry(entry), apiBase));
  return jsonResponse({ supported: true, entries });
}

export const GET: DryRouteHandler = async (context) => {
  try {
    const path = readSlug(context);
    if (context.url.searchParams.has("tree")) {
      if (path !== "") {
        throw new StorageError("invalid_path", "`?tree` is only valid at the storage root.");
      }
      return await handleTree(apiBaseFrom(context.url, "storage"));
    }

    const stat = await adapter.stat(path);
    if (!stat) throw new StorageError("not_found", `"${path}" does not exist.`);

    if (stat.kind === "folder") {
      const children = await adapter.list(path);
      const apiBase = apiBaseFrom(context.url, "storage");
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

async function handleUpload(request: Request, folder: string, apiBase: string): Promise<Response> {
  const target = await adapter.stat(folder);
  if (!target || target.kind !== "folder") {
    throw new StorageError("not_found", `"${folder}" is not an existing folder.`);
  }

  const form = await request.formData();
  const files = form.getAll("files").filter((value): value is File => value instanceof File);
  if (files.length === 0) {
    throw new StorageError("invalid_path", "No files in the upload.");
  }
  // Reject an in-batch name collision up front: writing sequentially and
  // only discovering the collision on the second file would otherwise leave
  // the first file actually written while reporting the whole batch failed.
  const seenNames = new Set<string>();
  for (const file of files) {
    if (seenNames.has(file.name)) {
      throw new StorageError("invalid_path", `Duplicate filename "${file.name}" in the same upload.`);
    }
    seenNames.add(file.name);
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
      Readable.fromWeb(file.stream() as unknown as Parameters<typeof Readable.fromWeb>[0]),
    );
    entries.push(withPreview(toFileEntry(stat), apiBase));
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

export const POST: DryRouteHandler = async (context) => {
  try {
    const path = readSlug(context);
    const contentType = context.request.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      return await handleUpload(context.request, path, apiBaseFrom(context.url, "storage"));
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
export const PUT: DryRouteHandler = async (context) => {
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
    const data = body
      ? Readable.fromWeb(body as unknown as Parameters<typeof Readable.fromWeb>[0])
      : new Uint8Array();
    const stat = await adapter.write(path, data);
    return jsonResponse({ entry: withPreview(toFileEntry(stat), apiBaseFrom(context.url, "storage")) }, 200);
  } catch (error) {
    return errorResponse(error);
  }
};

export const PATCH: DryRouteHandler = async (context) => {
  try {
    const from = readSlug(context);
    if (!from) throw new StorageError("invalid_path", "Cannot move/copy the storage root.");

    const body = (await context.request.json()) as { action?: string; to?: unknown };
    if (body.action !== "move" && body.action !== "copy") {
      throw new StorageError("invalid_path", `Unsupported action "${String(body.action)}".`);
    }
    const to = normalizeStoragePath(typeof body.to === "string" ? body.to : undefined);
    if (!to) throw new StorageError("invalid_path", "A destination path is required.");

    const apiBase = apiBaseFrom(context.url, "storage");
    // Same-path is a legitimate no-op for `move` (dropping a file back where
    // it started), but NOT for `copy` - falling through there lets the
    // adapter's normal existing-destination check 409, which is what the
    // client's `copyWithRetry` expects to trigger its "name copy" retry.
    if (to === from && body.action === "move") {
      const stat = await adapter.stat(from);
      if (!stat) throw new StorageError("not_found", `"${from}" does not exist.`);
      return jsonResponse({ entry: withPreview(toFileEntry(stat), apiBase) }, 200);
    }
    if (to.startsWith(`${from}/`)) {
      throw new StorageError(
        "invalid_path",
        "Cannot move/copy a folder into its own subtree.",
      );
    }

    const stat =
      body.action === "move" ? await adapter.move(from, to) : await adapter.copy(from, to);
    return jsonResponse({ entry: withPreview(toFileEntry(stat), apiBase) }, 200);
  } catch (error) {
    return errorResponse(error);
  }
};

export const DELETE: DryRouteHandler = async (context) => {
  try {
    const path = readSlug(context);
    if (!path) throw new StorageError("invalid_path", "Cannot delete the storage root.");
    await adapter.remove(path);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
};
