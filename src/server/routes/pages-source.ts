import type { DryRouteHandler } from "../context.js";
import { pagesSourceStorage } from "../config.js";
import { errorResponse, jsonResponse, readLeafName, readSlug } from "../route-helpers.js";
import { toFileEntry } from "../../storage/entry.js";
import { getStorageAdapter } from "../storage-adapters.js";
import { joinStoragePath, normalizeStoragePath } from "../../storage/path.js";
import { StorageError, type StorageAdapter } from "../../storage/types.js";

/**
 * The `pagesSource` storage root (`plans/app-r2.md` quyết định #6 - git is
 * still the source of truth on disk; `scripts/sync-pages-r2.ts` pushes
 * committed files into this root, never the other way round on its own).
 * What the browser build pipeline reads `page.tsx`/`layout.tsx` source text
 * and the tree from (mục 1's route manifest, mục 7's per-page compile) -
 * and, since Giai đoạn 6, what `PageEditor.tsx`'s in-browser editor writes
 * through too.
 *
 * GET stays open to any authenticated session (same "broadly read, narrowly
 * written" treatment `icons`/`richtext-components` GET already get - reading
 * page source is needed by the BUILD flow). The write methods below
 * (POST/PUT/PATCH/DELETE) are gated in `handler.ts` on `PAGE_BUILDER_RESOURCE_ID`
 * ("Page Builder") - originally a separate `system-code` toggle (quyết định
 * #12), merged with the build permission since the two were never granted
 * independently in practice.
 */
async function handleTree(adapter: StorageAdapter): Promise<Response> {
  if (!adapter.listAll) return jsonResponse({ supported: false });
  const all = await adapter.listAll();
  return jsonResponse({ supported: true, entries: all.map((entry) => toFileEntry(entry)) });
}

/** A page/layout/component source file - the same `.tsx`/`.ts`-only rule
 * `page-components.ts`'s own `requireComponentFileName` enforces for its
 * own tree, for the same reason: every file here is assumed to be real
 * TS/TSX by both `Editer`'s Language Service and the build pipeline's own
 * Sucrase compile. */
function isPageSourceFileName(name: string): boolean {
  return /\.tsx?$/i.test(name) && !name.toLowerCase().endsWith(".d.ts");
}

function requirePageSourceFileName(name: string): void {
  if (!isPageSourceFileName(name)) {
    throw new StorageError("invalid_path", `"${name}" must end in ".tsx" or ".ts".`);
  }
}

export const GET: DryRouteHandler = async (context) => {
  try {
    const adapter = getStorageAdapter(pagesSourceStorage, context);
    const path = readSlug(context);
    if (context.url.searchParams.has("tree")) {
      if (path !== "") return errorResponse(new Error('"?tree" is only valid at the pages-source root.'));
      return await handleTree(adapter);
    }

    const stat = await adapter.stat(path);
    if (!stat) {
      if (path === "") return jsonResponse({ path, entries: [] });
      return jsonResponse({ error: "not_found", message: `"${path}" does not exist.` }, 404);
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
      headers: { "Content-Type": "text/plain; charset=utf-8", "Last-Modified": new Date(file.modifiedAt).toUTCString() },
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
    const adapter = getStorageAdapter(pagesSourceStorage, context);
    const path = readSlug(context);
    return await handleCreateFolder(adapter, context.request, path);
  } catch (error) {
    return errorResponse(error);
  }
};

/** Create-or-overwrite one page/layout/component file's source at `slug` -
 * same "one call handles both new-file and save-edits" contract
 * `page-components.ts`'s own `PUT` has (`StorageAdapter.write` already
 * creates missing parent folders). */
export const PUT: DryRouteHandler = async (context) => {
  try {
    const adapter = getStorageAdapter(pagesSourceStorage, context);
    const path = readSlug(context);
    if (!path) throw new StorageError("invalid_path", "A page source file path is required.");
    requirePageSourceFileName(path);

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

/** Move/rename only - no "copy", same scope `page-components.ts`'s own
 * `PATCH` has. */
export const PATCH: DryRouteHandler = async (context) => {
  try {
    const adapter = getStorageAdapter(pagesSourceStorage, context);
    const from = readSlug(context);
    if (!from) throw new StorageError("invalid_path", "Cannot move/rename the root.");

    const body = (await context.request.json()) as { action?: string; to?: unknown };
    if (body.action !== "move") {
      throw new StorageError("invalid_path", `Unsupported action "${String(body.action)}".`);
    }
    const to = normalizeStoragePath(typeof body.to === "string" ? body.to : undefined);
    if (!to) throw new StorageError("invalid_path", "A destination path is required.");

    const source = await adapter.stat(from);
    if (source?.kind === "file") requirePageSourceFileName(to);

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
    const adapter = getStorageAdapter(pagesSourceStorage, context);
    const path = readSlug(context);
    if (!path) throw new StorageError("invalid_path", "Cannot delete the root.");
    await adapter.remove(path);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
};
