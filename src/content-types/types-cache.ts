import { typesCacheStorage } from "../server/config.js";
import type { DryRouteContext } from "../server/context.js";
import { getStorageAdapter } from "../server/storage-adapters.js";
import { getContentAdapters } from "../server/content-adapters.js";
import { StorageError } from "../storage/types.js";
import { generateDryTypes } from "./codegen.js";
import { isNodeRuntime } from "../lib/runtime-env.js";

const CACHE_ENTRY_NAME = "dry.generated.d.ts";

/**
 * Writes `dry.generated.d.ts`'s generated content to a `types-cache` storage
 * root (see `plans/app-router.md`'s "Cache cho `dry.generated.d.ts`") - now
 * actually read back by `routes/types-cache.ts` for the browser build
 * pipeline's Editer `extraFiles` (`plans/app-r2.md` mục 10), the "future
 * browser-based code editor" this was originally prep for.
 *
 * ALSO makes sure the real on-disk `.dry/dry.generated.d.ts` exists (still
 * needed by local `tsc`/IDE tooling - `reader.md`'s own decision, unchanged,
 * though the file itself moved out of `src/apps/` and out of git on
 * 2026-08-10: it's derived from the live content-type schema, not from
 * code, so it doesn't belong in commits any more than `.dry/content.sqlite`
 * does) - but only when a filesystem is actually available. This function is
 * no longer called from Node-only scripts exclusively (see
 * `routes/content-types.ts`'s `regenerateTypesCache`, which runs on every
 * request-handling runtime including a Workers isolate, which has no
 * filesystem at all) - a bare `node:fs/promises` import at module scope
 * would have broken that runtime outright, not just skipped the disk write,
 * so the import itself is deferred into the branch that needs it.
 *
 * Takes `context` so the storage write can resolve a LIVE R2 binding under
 * `kind: "cloudflare"` (`getStorageAdapter`, not the raw `createStorageAdapter`
 * this used to call directly) - found live, 2026-08-13: a freshly
 * (re)created R2 bucket has no cached `dry.generated.d.ts` yet, so the very
 * first Page Editor session after a fresh deploy always hit
 * `readGeneratedDryTypes`'s "not found, regenerate" fallback, which called
 * this function and threw `storage.kind "r2" requires a live R2 bucket
 * binding` - silently swallowed by `routes/types-cache.ts`'s GET (its own
 * "never fatal" contract), so the Editer just quietly had no `dry()`/
 * `params()`/`setTitle()`/`dryBind()` ambient globals in scope, surfacing
 * only as "Cannot find name 'setTitle'"-style diagnostics with no hint why.
 *
 * `tsconfig.json` needs ONE path that's correct no matter which of this
 * app's several run modes last touched it - `.dry/` itself is that stable
 * anchor (`resolvePath(process.cwd(), ".dry")`, ignoring `overrides`/E2E
 * entirely), but `typesCacheStorage`'s OWN root is not: `options.ts`'s
 * `localBaseDir` redirects it to `test-results/e2e-data/types-cache` under
 * `DRYCMS_E2E=1`, and to a per-test temp dir under a unit test's
 * `overrides.localDataRoot`. When the storage write above already landed at
 * the plain, un-overridden `.dry/types-cache/` (the common `bun run dev`
 * case), `.dry/dry.generated.d.ts` is made a SYMLINK to that file instead of
 * a second independent write - same bytes, one real copy. Anywhere else
 * (E2E, an override, `kind: "cloudflare"`'s R2 storage, or a platform where
 * `symlink` itself fails - Windows commonly needs Developer Mode/admin
 * rights for it) falls back to writing a real, independent file at the
 * stable path, exactly as before - a stale/dangling symlink left over from
 * an E2E run would otherwise break `tsc`/the IDE until the next plain `dev`
 * run regenerated it.
 */
export async function writeGeneratedDryTypes(output: string, context: Pick<DryRouteContext, "env">): Promise<void> {
  const storage = getStorageAdapter(typesCacheStorage, context);
  await storage.write(CACHE_ENTRY_NAME, Buffer.from(output, "utf8"));

  if (!isNodeRuntime()) return;
  // The path below is resolved from the working directory rather than from
  // any config a test could point elsewhere - so under vitest this would
  // overwrite it with whatever the test passed in. That's exactly what
  // happened once for real, back when this lived at the committed
  // `src/apps/dry.generated.d.ts`: `sivelap` shipped a copy containing only
  // `declare const marker: 'stored-verbatim';` - the fixture from
  // `server/routes/types-cache.test.ts`, committed after a test run left it
  // dirty. Only the on-disk mirror is skipped; the `typesCacheStorage` write
  // above is what those tests actually assert on, and it already goes to a
  // temp dir they control. Moving the file under `.dry/` (gitignored) removes
  // the "committed" half of that risk, but the write is still skipped here
  // since nothing should clobber a file mid-test-run regardless.
  if (process.env.VITEST) return;
  try {
    const { mkdir, rm, symlink, writeFile } = await import("node:fs/promises");
    const { relative: relativePath, resolve: resolvePath } = await import("node:path");
    const generatedDir = resolvePath(process.cwd(), ".dry");
    await mkdir(generatedDir, { recursive: true });
    const onDiskPath = resolvePath(generatedDir, "dry.generated.d.ts");
    const stableTypesCacheRoot = resolvePath(generatedDir, "types-cache");

    if (typesCacheStorage.kind === "local" && typesCacheStorage.root === stableTypesCacheRoot) {
      const target = relativePath(generatedDir, resolvePath(stableTypesCacheRoot, CACHE_ENTRY_NAME));
      try {
        await rm(onDiskPath, { force: true });
        await symlink(target, onDiskPath);
        return;
      } catch (error) {
        // `symlink` itself can fail even where `writeFile` wouldn't (e.g.
        // Windows without Developer Mode/admin rights) - fall through to a
        // real independent copy rather than leave nothing on disk at all.
        console.error("[drycms] failed to symlink on-disk dry.generated.d.ts, writing a real copy instead:", error);
      }
    }
    await writeFile(onDiskPath, output);
  } catch (error) {
    // Best-effort: a request-time caller (`regenerateTypesCache`) must never
    // fail the schema-apply response just because, say, the working
    // directory isn't writable in some deploy environment - the
    // `types-cache` storage write above already succeeded, which is the
    // copy every runtime actually depends on going forward.
    console.error("[drycms] failed to write on-disk dry.generated.d.ts:", error);
  }
}

/**
 * Read side of `writeGeneratedDryTypes` above - the real, current `dry()`
 * ambient types (collection/singleton names, field shapes), straight from
 * `typesCacheStorage`. Shared by every reader that needs this content: the
 * browser Editer's own route (`routes/types-cache.ts`'s `GET`), the Page
 * Editor Magic Chat's `kind: read, root: "types"`, and the MCP
 * `read_dry_types` tool - all three want the exact same "read, or lazily
 * regenerate if the cache hasn't been populated yet" behavior, so it lives
 * here once rather than three times.
 */
export async function readGeneratedDryTypes(context: DryRouteContext): Promise<string> {
  const adapter = getStorageAdapter(typesCacheStorage, context);
  try {
    const file = await adapter.read(CACHE_ENTRY_NAME);
    const chunks: Buffer[] = [];
    for await (const chunk of file.stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks).toString("utf-8");
  } catch (error) {
    if (!(error instanceof StorageError) || error.code !== "not_found") throw error;
    // Not generated yet - same lazy-regenerate fallback `routes/types-cache.ts`'s
    // `GET` originally had inline (see that file's own doc comment for why a
    // miss is regenerated on the spot rather than treated as a real error).
    const output = generateDryTypes(await getContentAdapters(context).schema.listContentTypes());
    await writeGeneratedDryTypes(output, context);
    return output;
  }
}
