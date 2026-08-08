import type { DryRouteHandler } from "../context.js";
import { pagesSourceStorage } from "../config.js";
import { errorResponse, jsonResponse, readSlug } from "../route-helpers.js";
import { toFileEntry } from "../../storage/entry.js";
import { getStorageAdapter } from "../storage-adapters.js";
import type { StorageAdapter } from "../../storage/types.js";

/**
 * READ side only of the `pagesSource` storage root (`plans/app-r2.md`
 * quyết định #6 - git is the source of truth, `scripts/sync-pages-r2.ts`
 * pushes into this root). What the browser build pipeline needs to fetch
 * `page.tsx`/`layout.tsx` source text and enumerate the tree (mục 1's route
 * manifest, mục 7's per-page compile). Write methods (PUT/PATCH/DELETE) are
 * deliberately absent - "sửa code trong browser" is Giai đoạn 6, gated by
 * `system-code`, not built yet; adding write here now would be a real
 * capability with no permission-checked route to review before it exists.
 */
async function handleTree(adapter: StorageAdapter): Promise<Response> {
  if (!adapter.listAll) return jsonResponse({ supported: false });
  const all = await adapter.listAll();
  return jsonResponse({ supported: true, entries: all.map((entry) => toFileEntry(entry)) });
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
