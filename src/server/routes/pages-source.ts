import type { DryRouteHandler } from "../context.js";
import { pagesSourceStorage } from "../config.js";
import { errorResponse, jsonResponse, readLeafName, readSlug } from "../route-helpers.js";
import { toFileEntry } from "../../storage/entry.js";
import { getStorageAdapter } from "../storage-adapters.js";
import { joinStoragePath, normalizeStoragePath } from "../../storage/path.js";
import { StorageError, type StorageAdapter, type StorageStatEntry } from "../../storage/types.js";
import { isCoreStyleFilePath, MD_ROOT, rootOf, STYLES_ROOT } from "../app-router/source-roots.js";
import { clearAiPageSourceWrite } from "../ai-page-source-flags.js";

/**
 * The `pagesSource` storage root (`plans/app-r2.md` quyết định #6 - git is
 * still the source of truth on disk; the Page Editor writes
 * committed files into this root, never the other way round on its own).
 * What the browser build pipeline reads `page.tsx`/`layout.tsx` source text
 * and the tree from (mục 1's route manifest, mục 7's per-page compile) -
 * and, since Giai đoạn 6, what `PageBuilder.tsx`'s in-browser editor writes
 * through too.
 *
 * Every method is gated in `handler.ts` on `PAGE_BUILDER_RESOURCE_ID`
 * ("Page Builder") - originally a separate `system-code` toggle (quyết định
 * #12), merged with the build permission since the two were never granted
 * independently in practice. `GET` also admits a role with no code-edit
 * grant but real content permissions on at least one type
 * (`permissions.ts`'s `isVeiEditableType`) - it needs to read page source to
 * render a VEI preview, even though it can never write any; every write
 * method stays exclusively behind the code-edit permission, no exception.
 */
async function readFileText(adapter: StorageAdapter, path: string): Promise<string> {
  const file = await adapter.read(path);
  const chunks: Buffer[] = [];
  for await (const chunk of file.stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf-8");
}

/** Recursive `list()` walk, siblings fetched in parallel - the fallback for
 * a backend with no `listAll()` (R2/S3, `storage/types.ts`'s own doc on why
 * that's never implemented there). Page source is one small, bounded tree
 * (a tenant's own pages/component/styles/md files), nothing like the
 * unbounded media buckets that restriction exists to protect - and doing the
 * walk here, Worker-to-storage, replaces what `pages-source-http.ts`'s
 * `listAllFilesRecursive` used to do one browser round trip PER FOLDER,
 * serially. */
async function walkAll(adapter: StorageAdapter, folder = ""): Promise<StorageStatEntry[]> {
  const children = await adapter.list(folder);
  const nested = await Promise.all(
    children.map((child) => (child.kind === "folder" ? walkAll(adapter, child.path) : Promise.resolve([child]))),
  );
  return nested.flat();
}

/** `?content` bundles every source file's text into this same response -
 * one browser round trip for the whole tree instead of one per file
 * (`pages-source-http.ts`'s `loadAllPagesSource`, which `PageBuilder.tsx`
 * and `PageBuild.tsx` both gate their initial load on). */
async function handleTree(adapter: StorageAdapter, withContent: boolean): Promise<Response> {
  const all = adapter.listAll ? await adapter.listAll() : await walkAll(adapter);
  const entries = all.map((entry) => toFileEntry(entry));
  if (!withContent) return jsonResponse({ supported: true, entries });
  const content: Record<string, string> = {};
  await Promise.all(
    entries
      .filter((entry) => entry.kind === "file" && /\.(tsx|ts|css|md)$/i.test(entry.name))
      .map(async (entry) => {
        content[entry.id] = await readFileText(adapter, entry.id);
      }),
  );
  return jsonResponse({ supported: true, entries, content });
}

/** A page/layout/component source file - the same `.tsx`/`.ts`-only rule
 * `page-components.ts`'s own `requireComponentFileName` enforces for its
 * own tree, for the same reason: every file here is assumed to be real
 * TS/TSX by both `Editer`'s Language Service and the build pipeline's own
 * Sucrase compile. The `styles/` root (`source-roots.ts`) is plain Tailwind
 * `.css`, never compiled by that pipeline; `md/` (`MD_ROOT`) is plain
 * Markdown, never compiled OR imported by anything - both exceptions. */
export function isPageSourceFileName(path: string): boolean {
  const root = rootOf(path)?.id;
  if (root === STYLES_ROOT) return /\.css$/i.test(path);
  if (root === MD_ROOT) return /\.md$/i.test(path);
  return /\.tsx?$/i.test(path) && !path.toLowerCase().endsWith(".d.ts");
}

export function requirePageSourceFileName(path: string): void {
  if (isPageSourceFileName(path)) return;
  const root = rootOf(path)?.id;
  const expected = root === STYLES_ROOT ? '".css"' : root === MD_ROOT ? '".md"' : '".tsx" or ".ts"';
  throw new StorageError("invalid_path", `"${path}" must end in ${expected}.`);
}

export const GET: DryRouteHandler = async (context) => {
  try {
    const adapter = getStorageAdapter(pagesSourceStorage, context);
    const path = readSlug(context);
    if (context.url.searchParams.has("tree")) {
      if (path !== "") return errorResponse(new Error('"?tree" is only valid at the pages-source root.'));
      return await handleTree(adapter, context.url.searchParams.has("content"));
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
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Last-Modified": new Date(file.modifiedAt).toUTCString(),
        // Executable source is highly mutable in dev and permission-gated;
        // browser/proxy reuse only creates stale editors/previews here.
        "Cache-Control": "private, no-store",
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
    if (readSlug(context) === "commit") {
      const [{ loadGithubSyncConfig }, { commitPagesSourceChanges }] = await Promise.all([
        import("./pages-source-github-sync.js"),
        import("../git-source-sync.js"),
      ]);
      const loaded = await loadGithubSyncConfig(context);
      if ("error" in loaded) return jsonResponse({ committed: false, reason: loaded.error }, 412);
      const body = (await context.request.json()) as {
        message?: unknown; author?: { name?: unknown; email?: unknown }; files?: Record<string, unknown>;
      };
      const files = Object.fromEntries(Object.entries(body.files ?? {}).filter((entry): entry is [string, string | null] => typeof entry[1] === "string" || entry[1] === null));
      const message = typeof body.message === "string" && body.message.trim() ? body.message.trim() : "Update page source";
      const author = {
        name: typeof body.author?.name === "string" && body.author.name.trim() ? body.author.name.trim() : context.session?.name || "drycms",
        email: typeof body.author?.email === "string" && body.author.email.trim() ? body.author.email.trim() : `${context.session?.id ?? "admin"}@page-builder.drycms`,
      };
      const result = await commitPagesSourceChanges(loaded.config, files, message, author);
      return result.ok ? jsonResponse({ committed: true, commitSha: result.commitSha }) : jsonResponse({ committed: false, reason: result.reason }, 502);
    }
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

    const expectedHash = context.request.headers.get("X-Dry-Base-Source-Hash");
    if (expectedHash !== null) {
      let current = "";
      if (existing?.kind === "file") {
        const file = await adapter.read(path);
        const chunks: Buffer[] = [];
        for await (const chunk of file.stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        current = Buffer.concat(chunks).toString("utf-8");
      }
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(current)));
      const currentHash = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
      if (currentHash !== expectedHash) {
        return jsonResponse(
          { error: "conflict", message: `"${path}" changed on storage. Reload it before saving your local edit.` },
          409,
        );
      }
    }

    const code = await context.request.text();
    const stat = await adapter.write(path, new TextEncoder().encode(code));
    // This admin session just explicitly reviewed and persisted `path` -
    // resolves any pending "AI overwrote this, nobody's acknowledged it yet"
    // flag from an MCP `write_page_source` call (`ai-page-source-flags.ts`'s
    // own doc comment on why Save, not just a build, clears it for anything
    // other than a `page.tsx`). A no-op if `path` wasn't flagged.
    await clearAiPageSourceWrite(path, context.env);
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
    if (isCoreStyleFilePath(path)) {
      throw new StorageError("protected", `"${path}" is a built-in file and can't be deleted.`);
    }
    await adapter.remove(path);
    return new Response(null, { status: 204 });
  } catch (error) {
    return errorResponse(error);
  }
};
