import { Readable } from "node:stream";
import type { DryRouteHandler } from "../context.js";
import { icons } from "../config.js";
import type { FileEntry } from "../../storage/entry-types.js";
import { fetchIconifySvg } from "../../icons/iconify-client.js";
import { IconValidationError, sanitizeSvg } from "../../icons/sanitize-svg.js";
import { slugify } from "../../lib/slugify.js";
import { apiBaseFrom, errorResponse, jsonResponse, mimeType, readLeafName, readSlug } from "../route-helpers.js";
import { toFileEntry } from "../../storage/entry.js";
import { getStorageAdapter } from "../storage-adapters.js";
import { normalizeStoragePath } from "../../storage/path.js";
import { StorageError, type StorageAdapter, type StorageStatEntry } from "../../storage/types.js";

const DEFAULT_PAGE_SIZE = 48;

interface IconEntry extends FileEntry {
  url: string;
}

function toIconEntry(stat: StorageStatEntry, apiBase: string): IconEntry {
  const entry = toFileEntry(stat);
  return { ...entry, url: `${apiBase}/${encodeURIComponent(entry.name)}` };
}

/** `sanitizeSvg` throws its own `IconValidationError`, a plain `Error`
 * subclass with no HTTP-status mapping of its own (`route-helpers.ts`'s
 * `errorResponse` only special-cases `StorageError`, deliberately - it's a
 * storage-domain-generic helper shared with `routes/storage.ts`, and
 * shouldn't import an icons-specific error type). Re-wrapping here, at the
 * one place both `POST`'s manual-create and `PUT` actually call it, keeps
 * that layering while still surfacing a clean 400 instead of a 500. */
function sanitizeOrThrow(raw: string): string {
  try {
    return sanitizeSvg(raw);
  } catch (error) {
    if (error instanceof IconValidationError) {
      throw new StorageError("invalid_path", error.message);
    }
    throw error;
  }
}

/** Every icon is required to end in `.svg` regardless of what a caller's
 * `name`/`to` resolves to - `GET`'s `Content-Type` is derived from the file
 * extension (`mimeType()`), and every byte ever written here has already
 * been through `sanitizeSvg`, so a mismatched extension would just make a
 * real SVG file serve (and fail to render as an `<img>`) under the wrong
 * MIME type. */
function ensureSvgExtension(name: string): string {
  return name.toLowerCase().endsWith(".svg") ? name : `${name}.svg`;
}

/** Derives a icons-root filename from a human label, e.g. for the manual
 * add/edit form. `prefixParts` (an Iconify `prefix`, when importing) is
 * joined in front so icons pulled from different icon sets that happen to
 * share a base name (many sets have a "home") don't collide. */
function slugToFilename(label: string, prefixPart?: string): string {
  const slug = slugify(label);
  if (!slug) {
    throw new StorageError("invalid_path", `Icon name "${label}" has no usable characters.`);
  }
  return ensureSvgExtension(prefixPart ? `${slugify(prefixPart)}-${slug}` : slug);
}

async function handleList(adapter: StorageAdapter, url: URL, apiBase: string): Promise<Response> {
  const rawPage = Number(url.searchParams.get("page"));
  const rawPageSize = Number(url.searchParams.get("pageSize"));
  const page = Number.isSafeInteger(rawPage) && rawPage >= 0 ? Math.min(rawPage, 1_000_000) : 0;
  const pageSize = Number.isSafeInteger(rawPageSize) && rawPageSize > 0 ? Math.min(rawPageSize, 100) : DEFAULT_PAGE_SIZE;
  const search = (url.searchParams.get("search") ?? "").trim().slice(0, 200).toLowerCase();

  const all = (await adapter.list("")).filter((entry) => entry.kind === "file");
  const filtered = search ? all.filter((entry) => entry.name.toLowerCase().includes(search)) : all;
  filtered.sort((a, b) => a.name.localeCompare(b.name));

  const total = filtered.length;
  const pageEntries = filtered.slice(page * pageSize, page * pageSize + pageSize);
  return jsonResponse({ total, entries: pageEntries.map((entry) => toIconEntry(entry, apiBase)) });
}

export const GET: DryRouteHandler = async (context) => {
  try {
    const adapter = getStorageAdapter(icons, context);
    const name = readSlug(context);
    const apiBase = apiBaseFrom(context.url, "icons");

    if (name === "") {
      return await handleList(adapter, context.url, apiBase);
    }

    const stat = await adapter.stat(name);
    if (!stat || stat.kind !== "file") {
      throw new StorageError("not_found", `"${name}" does not exist.`);
    }
    const file = await adapter.read(name);
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

interface CreateBody {
  action: "create";
  name: unknown;
  svg: unknown;
}

interface ImportBody {
  action: "import";
  prefix: unknown;
  names: unknown;
}

async function handleCreate(adapter: StorageAdapter, body: CreateBody, apiBase: string): Promise<Response> {
  const name = readLeafName(body.name);
  const svg = typeof body.svg === "string" ? body.svg : "";
  const sanitized = sanitizeOrThrow(svg);
  const filename = slugToFilename(name);
  if (await adapter.stat(filename)) {
    throw new StorageError("already_exists", `An icon named "${filename}" already exists.`);
  }
  const stat = await adapter.write(filename, new TextEncoder().encode(sanitized));
  return jsonResponse({ entry: toIconEntry(stat, apiBase) }, 201);
}

interface SkippedIcon {
  name: string;
  reason: string;
}

async function handleImport(adapter: StorageAdapter, body: ImportBody, apiBase: string): Promise<Response> {
  const prefix = typeof body.prefix === "string" ? body.prefix.trim() : "";
  const names = Array.isArray(body.names) ? body.names.filter((n): n is string => typeof n === "string") : [];
  if (!prefix || names.length === 0) {
    throw new StorageError("invalid_path", "`prefix` and a non-empty `names` array are required.");
  }

  const { found, notFound } = await fetchIconifySvg(prefix, names);
  const created: IconEntry[] = [];
  const skipped: SkippedIcon[] = notFound.map((name) => ({ name, reason: "Not found in Iconify." }));

  for (const icon of found) {
    let filename: string;
    try {
      filename = slugToFilename(icon.name, prefix);
    } catch {
      skipped.push({ name: icon.name, reason: "Invalid icon name." });
      continue;
    }
    if (await adapter.stat(filename)) {
      skipped.push({ name: icon.name, reason: "Already exists." });
      continue;
    }
    let sanitized: string;
    try {
      sanitized = sanitizeSvg(icon.svg);
    } catch {
      skipped.push({ name: icon.name, reason: "Invalid SVG returned by Iconify." });
      continue;
    }
    const stat = await adapter.write(filename, new TextEncoder().encode(sanitized));
    created.push(toIconEntry(stat, apiBase));
  }

  return jsonResponse({ created, skipped }, 201);
}

export const POST: DryRouteHandler = async (context) => {
  try {
    const adapter = getStorageAdapter(icons, context);
    const apiBase = apiBaseFrom(context.url, "icons");
    const body = (await context.request.json()) as { action?: string };
    if (body.action === "create") return await handleCreate(adapter, body as unknown as CreateBody, apiBase);
    if (body.action === "import") return await handleImport(adapter, body as unknown as ImportBody, apiBase);
    throw new StorageError("invalid_path", `Unsupported action "${String(body.action)}".`);
  } catch (error) {
    return errorResponse(error);
  }
};

/** Backs the manual-edit form's Save: overwrite (or create) one icon's SVG
 * bytes at `slug`, always re-running `sanitizeSvg` - an edit is just as
 * capable of introducing something unsafe as the original creation was. */
export const PUT: DryRouteHandler = async (context) => {
  try {
    const adapter = getStorageAdapter(icons, context);
    const name = readSlug(context);
    if (!name) throw new StorageError("invalid_path", "An icon name is required.");
    const raw = await context.request.text();
    const sanitized = sanitizeOrThrow(raw);
    const stat = await adapter.write(ensureSvgExtension(name), new TextEncoder().encode(sanitized));
    return jsonResponse({ entry: toIconEntry(stat, apiBaseFrom(context.url, "icons")) }, 200);
  } catch (error) {
    return errorResponse(error);
  }
};

/** Rename only - unlike `routes/storage.ts`'s PATCH, there's no "copy"
 * concept for a flat icon library. */
export const PATCH: DryRouteHandler = async (context) => {
  try {
    const adapter = getStorageAdapter(icons, context);
    const from = readSlug(context);
    if (!from) throw new StorageError("invalid_path", "Cannot rename without a source name.");

    const body = (await context.request.json()) as { action?: string; to?: unknown };
    if (body.action !== "rename") {
      throw new StorageError("invalid_path", `Unsupported action "${String(body.action)}".`);
    }
    const to = ensureSvgExtension(readLeafName(body.to));
    const normalizedTo = normalizeStoragePath(to);
    if (normalizedTo === from) {
      const stat = await adapter.stat(from);
      if (!stat) throw new StorageError("not_found", `"${from}" does not exist.`);
      return jsonResponse({ entry: toIconEntry(stat, apiBaseFrom(context.url, "icons")) }, 200);
    }
    const stat = await adapter.move(from, normalizedTo);
    return jsonResponse({ entry: toIconEntry(stat, apiBaseFrom(context.url, "icons")) }, 200);
  } catch (error) {
    return errorResponse(error);
  }
};

export const DELETE: DryRouteHandler = async (context) => {
  try {
    const adapter = getStorageAdapter(icons, context);
    const name = readSlug(context);
    if (!name) throw new StorageError("invalid_path", "An icon name is required.");
    await adapter.remove(name);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
};
