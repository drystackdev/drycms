import { Readable } from "node:stream";
import { text as readStreamText } from "node:stream/consumers";
import type { DryRouteHandler } from "../context.js";
import { storage } from "../config.js";
import type { FileEntry } from "../../storage/entry-types.js";
import { extensionToCategory } from "../../storage/entry-utils.js";
import {
  apiBaseFrom,
  errorResponse,
  jsonResponse,
  mimeType,
  readLeafName,
  readSlug,
  toUrlPath,
  unauthenticatedResponse,
} from "../route-helpers.js";
import { toFileEntry } from "../../storage/entry.js";
import { getStorageAdapter } from "../storage-adapters.js";
import { isSuperAdminSession } from "../admin-access.js";
import { joinStoragePath, normalizeStoragePath, storagePathParent } from "../../storage/path.js";
import { StorageError, type StorageAdapter } from "../../storage/types.js";
import { sanitizeSvg, IconValidationError } from "../../icons/sanitize-svg.js";
import { fetchAllowingOneRedirect, validateOutboundUrlForRequest } from "../outbound-url.js";

const MAX_IMPORTED_IMAGE_BYTES = 20 * 1024 * 1024;

function isSvgName(name: string): boolean {
  return /\.svg$/i.test(name);
}

/** Legacy `.svg` files predate the upload block below and may still carry
 * `<script>`/event-handler payloads, so the raw bytes stay locked behind
 * `application/octet-stream` + `attachment` (see the `GET` handler). The
 * Media page still needs to show *something* for them, so `previewUrl`
 * points image entries at `?preview` instead of the raw path - that variant
 * runs the same allowlist sanitizer the Icon Management feature uses before
 * ever writing a file, and serves the result as real `image/svg+xml` (or
 * 422s if nothing safe survives, e.g. a script-only payload). */
function withPreview(entry: FileEntry, apiBase: string): FileEntry {
  if (entry.kind === "file" && entry.ext && extensionToCategory(entry.ext) === "image") {
    const url = `${apiBase}/${toUrlPath(entry.id)}`;
    return { ...entry, previewUrl: isSvgName(entry.name) ? `${url}?preview` : url };
  }
  return entry;
}

/** `?tree` prefetches the whole storage tree in one response (see
 * `StorageAdapter.listAll`) instead of one folder at a time - only valid at
 * the root, and only actually available when the configured `storage.kind`
 * implements `listAll` (not R2/S3). `supported: false` tells the client to
 * fall back to per-folder `list()`, same contract as every other optional
 * `FileManagerSource` method. */
async function handleTree(adapter: StorageAdapter, apiBase: string, includeHidden: boolean): Promise<Response> {
  if (!adapter.listAll) return jsonResponse({ supported: false });
  const all = await adapter.listAll(includeHidden);
  const entries = all.map((entry) => withPreview(toFileEntry(entry), apiBase));
  return jsonResponse({ supported: true, entries });
}

export const GET: DryRouteHandler = async (context) => {
  try {
    const adapter = getStorageAdapter(storage, context);
    const path = readSlug(context);
    if (context.url.searchParams.has("tree")) {
      if (path !== "") {
        throw new StorageError("invalid_path", "`?tree` is only valid at the storage root.");
      }
      const includeHidden = await isSuperAdminSession(context);
      return await handleTree(adapter, apiBaseFrom(context.url, "storage"), includeHidden);
    }

    const stat = await adapter.stat(path);
    if (!stat) throw new StorageError("not_found", `"${path}" does not exist.`);

    if (stat.kind === "folder") {
      // Unlike a single file read (see the module-level comment on
      // `withPreview`), a folder listing enumerates every name/size in it -
      // real management surface, not public media - so it stays behind the
      // session `handler.ts` otherwise would have already required for this
      // route. `handler.ts` lets an unauthenticated `GET` this far only
      // because it can't tell file from folder without this same `stat()`.
      if (!context.session) return unauthenticatedResponse();
      // `.avatar`/`.tmp.*` staging folders (see `isHiddenName` in
      // `local.ts`/`r2.ts`) are implementation details for everyone else,
      // but a super admin browsing Media can still open and inspect them.
      const includeHidden = await isSuperAdminSession(context);
      const children = await adapter.list(path, includeHidden);
      const apiBase = apiBaseFrom(context.url, "storage");
      const entries = children.map((child) => withPreview(toFileEntry(child), apiBase));
      return jsonResponse({ path, entries });
    }

    const file = await adapter.read(path);
    const isSvg = isSvgName(stat.name);

    if (isSvg && context.url.searchParams.has("preview")) {
      let sanitized: string;
      try {
        sanitized = sanitizeSvg(await readStreamText(file.stream));
      } catch (error) {
        if (error instanceof IconValidationError) {
          throw new StorageError("unsupported", "This SVG has no safe content to preview.");
        }
        throw error;
      }
      return new Response(sanitized, {
        status: 200,
        headers: { "Content-Type": "image/svg+xml" },
      });
    }

    // Prefer the backend's own web stream (R2) - converting a Node stream
    // back to a web one costs a copy per chunk AND breaks on client cancel
    // under `nodejs_compat` (see `StorageReadResult.webStream`).
    return new Response(file.webStream ?? (Readable.toWeb(file.stream) as unknown as ReadableStream), {
      status: 200,
      headers: {
        // SVG is not accepted for new generic uploads. Legacy files are
        // still served as downloads so an old stored payload cannot execute
        // as an active document in an image preview or a new browser tab.
        "Content-Type": isSvg ? "application/octet-stream" : mimeType(stat.name),
        "Content-Length": String(file.size),
        "Last-Modified": new Date(file.modifiedAt).toUTCString(),
        ...(isSvg ? {
          "Content-Disposition": "attachment; filename=download.svg",
          "Content-Security-Policy": "sandbox; default-src 'none'",
        } : {}),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
};

async function handleUpload(adapter: StorageAdapter, request: Request, folder: string, apiBase: string): Promise<Response> {
  const target = await adapter.stat(folder);
  if (!target || target.kind !== "folder") {
    throw new StorageError("not_found", `"${folder}" is not an existing folder.`);
  }

  const form = await request.formData();
  const files = form.getAll("files").filter((value): value is File => value instanceof File);
  if (files.length === 0) {
    throw new StorageError("invalid_path", "No files in the upload.");
  }
  if (files.length > 100) {
    throw new StorageError("unsupported", "At most 100 files can be uploaded per request.");
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
    if (isSvgName(name)) throw new StorageError("unsupported", "SVG uploads are disabled in generic storage; use the managed Icons area.");
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

async function handleCreateFolder(adapter: StorageAdapter, body: { action?: string; name?: unknown }, folder: string): Promise<Response> {
  if (body.action !== "mkdir") {
    throw new StorageError("invalid_path", `Unsupported action "${String(body.action)}".`);
  }
  const name = readLeafName(body.name);
  const targetPath = normalizeStoragePath(joinStoragePath(folder, name));
  const stat = await adapter.mkdir(targetPath);
  return jsonResponse({ entry: toFileEntry(stat) }, 201);
}

function importedImageName(url: string, contentType: string): string {
  const raw = decodeURIComponent(new URL(url).pathname.split("/").pop() || "").replace(/[^A-Za-z0-9._-]+/g, "-");
  if (raw && /\.(?:avif|gif|jpe?g|png|webp)$/i.test(raw)) return raw;
  const extension = contentType.split(";")[0]?.split("/")[1]?.replace("jpeg", "jpg").replace(/[^A-Za-z0-9]/g, "") || "png";
  return `pasted-image.${extension}`;
}

async function handleImportUrl(adapter: StorageAdapter, body: { url?: unknown }, folder: string, apiBase: string): Promise<Response> {
  const target = await adapter.stat(folder);
  if (!target || target.kind !== "folder") throw new StorageError("not_found", `"${folder}" is not an existing folder.`);
  if (typeof body.url !== "string") throw new StorageError("invalid_path", "An image URL is required.");

  const url = await validateOutboundUrlForRequest(body.url, "Image URL");
  let response: Response;
  try {
    response = await fetchAllowingOneRedirect(url, { headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif" } }, "Image URL");
  } catch (error) {
    // `fetchAllowingOneRedirect` throws a plain `Error` (redirect refused,
    // DNS/network failure) rather than a `StorageError` - it's built on
    // `outbound-url.ts`'s shared primitives, which `routes/ai.ts` also uses
    // and which surface any `Error`'s message directly, with no reason to
    // know about this module's error type. Translate it here so the caller
    // gets the real reason instead of `errorResponse`'s generic 500 fallback.
    throw new StorageError("unsupported", error instanceof Error ? error.message : "Image download failed.");
  }
  if (!response.ok) throw new StorageError("unsupported", `Image download failed (${response.status}).`);
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!/^image\/(?:avif|gif|jpeg|png|webp)(?:;|$)/.test(contentType)) {
    throw new StorageError("unsupported", "The URL did not return a supported raster image.");
  }
  const declaredSize = Number(response.headers.get("content-length") ?? 0);
  if (declaredSize > MAX_IMPORTED_IMAGE_BYTES) throw new StorageError("unsupported", "The remote image is larger than 20 MB.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_IMPORTED_IMAGE_BYTES) throw new StorageError("unsupported", "The remote image is larger than 20 MB.");

  const name = readLeafName(importedImageName(url, contentType));
  let targetPath = normalizeStoragePath(joinStoragePath(folder, name));
  if (await adapter.stat(targetPath)) {
    const dot = name.lastIndexOf(".");
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const extension = dot > 0 ? name.slice(dot) : "";
    let suffix = 2;
    do {
      targetPath = normalizeStoragePath(joinStoragePath(folder, `${stem}-${suffix}${extension}`));
      suffix += 1;
    } while (await adapter.stat(targetPath));
  }
  const stat = await adapter.write(targetPath, bytes);
  return jsonResponse({ entry: withPreview(toFileEntry(stat), apiBase) }, 201);
}

export const POST: DryRouteHandler = async (context) => {
  try {
    const adapter = getStorageAdapter(storage, context);
    const path = readSlug(context);
    const contentType = context.request.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) {
      return await handleUpload(adapter, context.request, path, apiBaseFrom(context.url, "storage"));
    }
    if (contentType.includes("application/json")) {
      const body = (await context.request.json()) as { action?: string; name?: unknown; url?: unknown };
      if (body.action === "import-url") {
        return await handleImportUrl(adapter, body, path, apiBaseFrom(context.url, "storage"));
      }
      return await handleCreateFolder(adapter, body, path);
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
    const adapter = getStorageAdapter(storage, context);
    const path = readSlug(context);
    if (!path) throw new StorageError("invalid_path", "A file path is required.");
    if (isSvgName(path)) throw new StorageError("unsupported", "SVG uploads are disabled in generic storage; use the managed Icons area.");

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
    const adapter = getStorageAdapter(storage, context);
    const from = readSlug(context);
    if (!from) throw new StorageError("invalid_path", "Cannot move/copy the storage root.");

    const body = (await context.request.json()) as { action?: string; to?: unknown };
    if (body.action !== "move" && body.action !== "copy") {
      throw new StorageError("invalid_path", `Unsupported action "${String(body.action)}".`);
    }
    const to = normalizeStoragePath(typeof body.to === "string" ? body.to : undefined);
    if (!to) throw new StorageError("invalid_path", "A destination path is required.");
    if (isSvgName(to)) throw new StorageError("unsupported", "SVG files cannot be created in generic storage; use the managed Icons area.");

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

    const source = await adapter.stat(from);
    if (source?.kind === "file" && isSvgName(source.name)) {
      throw new StorageError("unsupported", "SVG files cannot be moved or copied from generic storage.");
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
    const adapter = getStorageAdapter(storage, context);
    const path = readSlug(context);
    if (!path) throw new StorageError("invalid_path", "Cannot delete the storage root.");
    await adapter.remove(path);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
};
