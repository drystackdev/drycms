import type { ResolvedFileContentOption } from "../../../integration/options.js";
import { defaultContentTypeDefinitions } from "../../seed.js";
import { findDependents } from "../../tree.js";
import type { ContentTypeDefinition } from "../../types.js";
import type { ContentEntryEngineAdapter } from "../entries-types.js";
import { ContentEngineError, type ContentEngineAdapter } from "../types.js";
import { createFileContentEntryEngineAdapter } from "./entries-file.js";
import { createFileDriver, safePathSegment, type FileDriver } from "./file-driver.js";
import { bumpDataVersion, getDataVersion } from "./index-store.js";
import { applyFileRewrite, planFileSave, type FileSavePlan } from "./migration-file.js";
import { deleteFilePermissions, syncFilePermissions } from "./permissions-file.js";

/** The whole content-types collection is one resource for versioning
 * purposes (see `status/build-cache.md`) - `"__content-types__"` can never
 * collide with a real content type name (`naming.ts`'s `CONTENT_TYPE_NAME_RE`
 * forbids a leading underscore). Reuses `index-store.ts`'s generic
 * `.index/<resource>._version.json` mechanism (same one entries use), just
 * keyed by this fixed resource name instead of a content type's own. */
const CONTENT_TYPES_RESOURCE = "__content-types__";

function typePath(id: string): string {
  return `content-types/${safePathSegment(id)}.json`;
}

function dataDir(typeName: string): string {
  return `data/${safePathSegment(typeName)}`;
}

/** Every content type's definition, aggregated into ONE file - a normal read
 * (`listContentTypes`/`getContentType`) then costs 1 request instead of
 * `listJsonFiles("content-types")` + one `readJson` per type. Same "derived,
 * rebuildable cache" principle `index-store.ts` already documents for entry
 * indexes: `content-types/<id>.json` stays the only source of truth, this is
 * purely an accelerator - self-healing (rebuilt + re-cached) if ever missing
 * or empty, same as every other `.index/*` file (malformed-but-present JSON
 * is a real error there too, not specially recovered), and kept current by
 * every write path (`ensureBooted`, `applySave`, `deleteContentType`) inside
 * their own transaction, so the cache update is atomic with the type write
 * it reflects. */
const CONTENT_TYPES_INDEX_PATH = ".index/content-types.json";

async function rebuildAllRaw(driver: FileDriver): Promise<ContentTypeDefinition[]> {
  const names = await driver.listJsonFiles("content-types");
  const out: ContentTypeDefinition[] = [];
  for (const name of names) {
    const def = await driver.readJson<ContentTypeDefinition>(`content-types/${name}.json`);
    if (def) out.push(def);
  }
  return out;
}

export function createFileContentEngineAdapter(option: ResolvedFileContentOption): ContentEngineAdapter {
  const driver: FileDriver = createFileDriver(option);
  let entryAdapter: ContentEntryEngineAdapter | undefined;
  function getEntryAdapter(): ContentEntryEngineAdapter {
    entryAdapter ??= createFileContentEntryEngineAdapter(option);
    return entryAdapter;
  }

  async function readAllRaw(): Promise<ContentTypeDefinition[]> {
    const cached = await driver.readJson<ContentTypeDefinition[]>(CONTENT_TYPES_INDEX_PATH);
    if (cached) return cached;
    // Cache missing/corrupt (first boot ever, or a manual repo edit) -
    // rebuild from the real source of truth and repair the cache for next time.
    const rebuilt = await rebuildAllRaw(driver);
    await driver.writeJson(CONTENT_TYPES_INDEX_PATH, rebuilt);
    return rebuilt;
  }

  /** Seeds whichever default content types (`seed.ts`) aren't already
   * present (by name, case-insensitively) - the file-engine analog of
   * `sqlite.ts`'s boot sequence (`pendingSeedStatements`), just writing
   * plain JSON definitions instead of running DDL - and syncs `permission`/
   * seeds Super Admin unconditionally on every boot, same as there. Run
   * once, lazily, memoized for this adapter's lifetime. */
  let bootPromise: Promise<void> | undefined;
  function ensureBooted(): Promise<void> {
    bootPromise ??= (async () => {
      const existing = await readAllRaw();
      const existingNames = new Set(existing.map((t) => t.name.toLowerCase()));
      const missing = defaultContentTypeDefinitions().filter((t) => !existingNames.has(t.name.toLowerCase()));
      let allTypes = existing;
      if (missing.length > 0) {
        // Every missing default type, plus the refreshed cache, land in one commit.
        allTypes = await driver.transaction(async (tx) => {
          for (const target of missing) {
            await tx.writeJson(typePath(target.id), target);
          }
          const rebuilt = await rebuildAllRaw(tx);
          await tx.writeJson(CONTENT_TYPES_INDEX_PATH, rebuilt);
          await bumpDataVersion(tx, CONTENT_TYPES_RESOURCE);
          return rebuilt;
        });
      }
      await syncFilePermissions(driver, getEntryAdapter(), allTypes);
    })();
    return bootPromise;
  }

  async function listContentTypes(): Promise<ContentTypeDefinition[]> {
    await ensureBooted();
    return readAllRaw();
  }

  async function getContentType(id: string): Promise<ContentTypeDefinition | null> {
    await ensureBooted();
    const all = await readAllRaw();
    return all.find((t) => t.id === id) ?? null;
  }

  async function planSave(next: ContentTypeDefinition): Promise<FileSavePlan> {
    const oldAllTypes = await listContentTypes();
    // Same explicit check as `sqlite.ts`'s `planSave`: `planFileSave` derives
    // `expectedVersion` from whatever's CURRENTLY in `oldAllTypes`, which
    // can't by itself catch a stale client edit (the caller's `next.version`
    // predating a save someone else already made) - checked here instead,
    // against what the caller actually submitted.
    const current = oldAllTypes.find((t) => t.id === next.id);
    const currentVersion = current?.version ?? 0;
    if (currentVersion !== next.version) {
      throw new ContentEngineError(
        "version_conflict",
        `Content type "${next.id}" changed since it was loaded (expected v${next.version}, found v${currentVersion}).`,
      );
    }
    const newAllTypes = [...oldAllTypes.filter((t) => t.id !== next.id), next];
    return planFileSave({ savedType: next, oldAllTypes, newAllTypes });
  }

  async function applySave(next: ContentTypeDefinition, plan: FileSavePlan): Promise<ContentTypeDefinition> {
    const allPlans = [plan.primary, ...plan.cascaded];

    // A stale plan (a concurrent edit landed between planSave() and this
    // call) must never be replayed against a schema it no longer matches -
    // re-verify every affected content type (primary AND every cascaded
    // dependent) is still at the version the plan was computed against.
    for (const p of allPlans) {
      const current = await getContentType(p.targetContentTypeId);
      const currentVersion = current?.version ?? 0;
      if (currentVersion !== p.expectedVersion) {
        throw new ContentEngineError(
          "version_conflict",
          `Content type "${p.targetContentTypeId}" changed since this plan was computed (expected v${p.expectedVersion}, found v${currentVersion}).`,
        );
      }
    }

    // Everything below - the primary type, every cascaded dependent, and
    // every rewritten record - lands as ONE commit on `github`/`gitlab` (see
    // `FileDriver.transaction()`): a save touching several files should
    // never be observable as a half-migrated schema if a commit partway
    // through failed. Permission sync runs in its own transaction right
    // after (see that call site's comment) rather than joining this one.
    await driver.transaction(async (tx) => {
      await tx.writeJson(typePath(next.id), { ...next, version: plan.primary.nextVersion });
      for (const p of plan.cascaded) {
        const dep = await tx.readJson<ContentTypeDefinition>(typePath(p.targetContentTypeId));
        if (dep) await tx.writeJson(typePath(p.targetContentTypeId), { ...dep, version: p.nextVersion });
      }

      if (plan.primary.needsRewrite) await applyFileRewrite(tx, plan.primary.typeName, plan.primary.rewrite);
      for (const p of plan.cascaded) {
        if (p.needsRewrite) await applyFileRewrite(tx, p.typeName, p.rewrite);
      }

      const rebuilt = await rebuildAllRaw(tx);
      await tx.writeJson(CONTENT_TYPES_INDEX_PATH, rebuilt);
      await bumpDataVersion(tx, CONTENT_TYPES_RESOURCE);
    });

    await syncFilePermissions(driver, getEntryAdapter(), await readAllRaw());

    const saved = await getContentType(next.id);
    if (!saved) throw new ContentEngineError("not_found", `Content type "${next.id}" not found after save.`);
    return saved;
  }

  async function deleteContentType(id: string): Promise<void> {
    const existing = await getContentType(id);
    if (!existing) throw new ContentEngineError("not_found", `Content type "${id}" not found.`);

    const allTypes = await listContentTypes();
    if (existing.kind === "component") {
      const dependents = findDependents(id, allTypes);
      if (dependents.length > 0) {
        throw new ContentEngineError(
          "in_use",
          `Component "${existing.name}" is still used by: ${dependents.map((d) => d.name).join(", ")}.`,
        );
      }
    }

    await deleteFilePermissions(driver, getEntryAdapter(), allTypes, id);

    // The type definition itself, its whole data folder, and every stray
    // index file - one commit, same rationale as `applySave`.
    await driver.transaction(async (tx) => {
      await tx.removeJson(typePath(id));

      if (existing.kind !== "component") {
        await tx.removeDir(dataDir(existing.name));
        const indexNames = await tx.listJsonFiles(".index");
        const prefix = `${existing.name}.`;
        for (const name of indexNames) {
          if (name.startsWith(prefix)) await tx.removeJson(`.index/${name}.json`);
        }
      }

      const rebuilt = await rebuildAllRaw(tx);
      await tx.writeJson(CONTENT_TYPES_INDEX_PATH, rebuilt);
      await bumpDataVersion(tx, CONTENT_TYPES_RESOURCE);
    });
  }

  return {
    listContentTypes,
    getContentType,
    planSave,
    applySave,
    deleteContentType,
    getResourceVersion: () => getDataVersion(driver, CONTENT_TYPES_RESOURCE),
  };
}
