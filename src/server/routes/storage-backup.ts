import { buffer } from "node:stream/consumers";
import type { DryRouteHandler } from "../context.js";
import { storage } from "../config.js";
import { requireSuperAdmin } from "../admin-access.js";
import { jsonResponse, errorResponse } from "../route-helpers.js";
import { getStorageAdapter } from "../storage-adapters.js";
import { StorageError, type StorageAdapter, type StorageStatEntry } from "../../storage/types.js";
import { ZipWriter, parseZip } from "../../storage/zip.js";

/** Recursive per-folder walk, only used when `adapter.listAll` is missing
 * (R2 - see `StorageAdapter.listAll`'s own doc comment for why a full-bucket
 * listing isn't exposed there). Same shape as `pages-source-github-restore.ts`'s
 * `listAllSourcePaths` - kept as its own local copy rather than a shared
 * export, matching that file's own precedent for this exact pattern. */
async function walkFiles(adapter: StorageAdapter, folder: string): Promise<StorageStatEntry[]> {
  const entries = await adapter.list(folder, true);
  const files: StorageStatEntry[] = [];
  for (const entry of entries) {
    if (entry.kind === "folder") files.push(...(await walkFiles(adapter, entry.path)));
    else files.push(entry);
  }
  return files;
}

/** Every real file in storage, `.avatar`/`.tmp.*` staging folders included
 * (`includeHidden: true`) - a backup has to cover everything, not just what
 * the Media page's own browsing UI shows. */
async function listAllFiles(adapter: StorageAdapter): Promise<StorageStatEntry[]> {
  if (adapter.listAll) return (await adapter.listAll(true)).filter((entry) => entry.kind === "file");
  return walkFiles(adapter, "");
}

function backupFileTimestamp(): string {
  return new Date().toISOString().replace(/[:]/g, "-").replace(/\..+$/, "");
}

/**
 * `GET {path}/api/storage-backup` - downloads every file under the Media
 * storage root (`config.ts`'s `storage`, the same root `routes/storage.ts`
 * serves - local disk or the `MEDIA_BUCKET` R2 bucket, per `content.engine`'s
 * `kind`) as a single `.zip`. Streamed one file at a time
 * (`storage/zip.ts`'s `ZipWriter`) rather than built in memory and sent all
 * at once - a real Media library can easily be larger than a Worker
 * isolate's memory ceiling, and this way peak memory is "one file's bytes",
 * not "every file's bytes".
 */
export const GET: DryRouteHandler = async (context) => {
  const denied = await requireSuperAdmin(context, "Only Super Admin can back up storage.");
  if (denied) return denied;
  try {
    const adapter = getStorageAdapter(storage, context);
    const files = await listAllFiles(adapter);

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          const writer = new ZipWriter();
          for (const file of files) {
            const read = await adapter.read(file.path);
            const data = await buffer(read.stream);
            controller.enqueue(writer.addEntry({ path: file.path, data, modifiedAt: Date.parse(file.modifiedAt ?? "") || undefined }));
          }
          controller.enqueue(writer.finish());
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="drycms-media-backup-${backupFileTimestamp()}.zip"`,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
};

/**
 * `POST {path}/api/storage-backup` - restores a `.zip` backup previously
 * downloaded from this same `GET`: every current file in storage is removed,
 * then every entry in the zip is written - a full replace, not a merge, same
 * "restore fully replaces current state" contract `routes/backup.ts`'s
 * database restore already established. Not atomic (neither is the database
 * restore) - a failure partway through can leave storage with only some
 * files removed/restored.
 */
export const POST: DryRouteHandler = async (context) => {
  const denied = await requireSuperAdmin(context, "Only Super Admin can restore storage.");
  if (denied) return denied;
  try {
    const form = await context.request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new StorageError("invalid_path", "A backup zip file is required.");

    const entries = parseZip(new Uint8Array(await file.arrayBuffer()));
    if (entries.length === 0) throw new StorageError("invalid_path", "The backup file has no entries to restore.");

    const adapter = getStorageAdapter(storage, context);
    const currentFiles = await listAllFiles(adapter);
    for (const existing of currentFiles) await adapter.remove(existing.path);
    for (const entry of entries) await adapter.write(entry.path, entry.data);

    return jsonResponse({ applied: true, fileCount: entries.length });
  } catch (error) {
    return errorResponse(error);
  }
};
