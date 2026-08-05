import type { DryRouteHandler } from "../context.js";
import { pageComponentsStorage } from "../config.js";
import {
  errorResponse,
  jsonResponse,
  readLeafName,
  readSlug,
} from "../route-helpers.js";
import { toFileEntry } from "../../storage/entry.js";
import { getStorageAdapter } from "../storage-adapters.js";
import { joinStoragePath, normalizeStoragePath } from "../../storage/path.js";
import { StorageError, type StorageAdapter } from "../../storage/types.js";

/** Component Builder only ever stores `.tsx`/`.ts` source - anything else
 * (an upload, a renamed extension) would silently break both `Editer`'s
 * TS Language Service (which assumes every file in the tree is real
 * TS/TSX) and the Sucrase preview transform. */
function isComponentFileName(name: string): boolean {
  return /\.tsx?$/i.test(name) && !name.toLowerCase().endsWith(".d.ts");
}

function requireComponentFileName(name: string): void {
  if (!isComponentFileName(name)) {
    throw new StorageError("invalid_path", `"${name}" must end in ".tsx" or ".ts".`);
  }
}

/** `?tree` prefetches the whole component tree in one response, same
 * contract as `routes/storage.ts`'s `handleTree` - the folder-tree sidebar
 * needs the full tree up front, not one folder at a time. */
async function handleTree(adapter: StorageAdapter): Promise<Response> {
  if (!adapter.listAll) return jsonResponse({ supported: false });
  const all = await adapter.listAll();
  return jsonResponse({ supported: true, entries: all.map((entry) => toFileEntry(entry)) });
}

export const GET: DryRouteHandler = async (context) => {
  try {
    const adapter = getStorageAdapter(pageComponentsStorage, context);
    const path = readSlug(context);
    if (context.url.searchParams.has("tree")) {
      if (path !== "") {
        throw new StorageError("invalid_path", "`?tree` is only valid at the root.");
      }
      return await handleTree(adapter);
    }

    const stat = await adapter.stat(path);
    if (!stat) {
      if (path === "") return jsonResponse({ path, entries: [] });
      throw new StorageError("not_found", `"${path}" does not exist.`);
    }

    if (stat.kind === "folder") {
      const children = await adapter.list(path);
      return jsonResponse({ path, entries: children.map((child) => toFileEntry(child)) });
    }

    const file = await adapter.read(path);
    const chunks: Buffer[] = [];
    for await (const chunk of file.stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return new Response(Buffer.concat(chunks).toString("utf-8"), {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Last-Modified": new Date(file.modifiedAt).toUTCString(),
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
};

async function handleCreateFolder(adapter: StorageAdapter, request: Request, folder: string): Promise<Response> {
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
    const adapter = getStorageAdapter(pageComponentsStorage, context);
    const path = readSlug(context);
    return await handleCreateFolder(adapter, context.request, path);
  } catch (error) {
    return errorResponse(error);
  }
};

/** Create-or-overwrite one component file's source at `slug` - the same
 * `write()` call handles both "new file" and "save edits", since
 * `StorageAdapter.write` already creates missing parent folders. */
export const PUT: DryRouteHandler = async (context) => {
  try {
    const adapter = getStorageAdapter(pageComponentsStorage, context);
    const path = readSlug(context);
    if (!path) throw new StorageError("invalid_path", "A component file path is required.");
    requireComponentFileName(path);

    const existing = await adapter.stat(path);
    if (existing?.kind === "folder") {
      throw new StorageError("invalid_path", `"${path}" is a folder.`);
    }

    const code = await context.request.text();
    const stat = await adapter.write(path, new TextEncoder().encode(code));
    return jsonResponse({ entry: toFileEntry(stat) }, 200);
  } catch (error) {
    return errorResponse(error);
  }
};

/** Move/rename only - no "copy" (unlike `routes/storage.ts`), Component
 * Builder has no product surface for duplicating a component yet. */
export const PATCH: DryRouteHandler = async (context) => {
  try {
    const adapter = getStorageAdapter(pageComponentsStorage, context);
    const from = readSlug(context);
    if (!from) throw new StorageError("invalid_path", "Cannot move/rename the root.");

    const body = (await context.request.json()) as { action?: string; to?: unknown };
    if (body.action !== "move") {
      throw new StorageError("invalid_path", `Unsupported action "${String(body.action)}".`);
    }
    const to = normalizeStoragePath(typeof body.to === "string" ? body.to : undefined);
    if (!to) throw new StorageError("invalid_path", "A destination path is required.");

    const source = await adapter.stat(from);
    if (source?.kind === "file") requireComponentFileName(to);

    if (to === from) {
      if (!source) throw new StorageError("not_found", `"${from}" does not exist.`);
      return jsonResponse({ entry: toFileEntry(source) }, 200);
    }
    if (to.startsWith(`${from}/`)) {
      throw new StorageError("invalid_path", "Cannot move a folder into its own subtree.");
    }

    const stat = await adapter.move(from, to);
    return jsonResponse({ entry: toFileEntry(stat) }, 200);
  } catch (error) {
    return errorResponse(error);
  }
};

export const DELETE: DryRouteHandler = async (context) => {
  try {
    const adapter = getStorageAdapter(pageComponentsStorage, context);
    const path = readSlug(context);
    if (!path) throw new StorageError("invalid_path", "Cannot delete the root.");
    await adapter.remove(path);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
};
