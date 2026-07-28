import type { ResolvedFileContentOption } from "../../../integration/options.js";
import { defaultContentTypeDefinitions } from "../../seed.js";
import { findDependents } from "../../tree.js";
import type { ContentTypeDefinition } from "../../types.js";
import type { ContentEntryEngineAdapter } from "../entries-types.js";
import { ContentEngineError, type ContentEngineAdapter } from "../types.js";
import { createFileContentEntryEngineAdapter } from "./entries-file.js";
import { createFileDriver, safePathSegment, type FileDriver } from "./file-driver.js";
import { applyFileRewrite, planFileSave, type FileSavePlan } from "./migration-file.js";
import { deleteFilePermissions, syncFilePermissions } from "./permissions-file.js";

function typePath(id: string): string {
  return `content-types/${safePathSegment(id)}.json`;
}

function dataDir(typeName: string): string {
  return `data/${safePathSegment(typeName)}`;
}

export function createFileContentEngineAdapter(option: ResolvedFileContentOption): ContentEngineAdapter {
  const driver: FileDriver = createFileDriver(option);
  let entryAdapter: ContentEntryEngineAdapter | undefined;
  function getEntryAdapter(): ContentEntryEngineAdapter {
    entryAdapter ??= createFileContentEntryEngineAdapter(option);
    return entryAdapter;
  }

  async function readAllRaw(): Promise<ContentTypeDefinition[]> {
    const names = await driver.listJsonFiles("content-types");
    const out: ContentTypeDefinition[] = [];
    for (const name of names) {
      const def = await driver.readJson<ContentTypeDefinition>(`content-types/${name}.json`);
      if (def) out.push(def);
    }
    return out;
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
      for (const target of missing) {
        await driver.writeJson(typePath(target.id), target);
      }
      const allTypes = missing.length > 0 ? await readAllRaw() : existing;
      await syncFilePermissions(getEntryAdapter(), allTypes);
    })();
    return bootPromise;
  }

  async function listContentTypes(): Promise<ContentTypeDefinition[]> {
    await ensureBooted();
    return readAllRaw();
  }

  async function getContentType(id: string): Promise<ContentTypeDefinition | null> {
    await ensureBooted();
    return driver.readJson<ContentTypeDefinition>(typePath(id));
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

    await driver.writeJson(typePath(next.id), { ...next, version: plan.primary.nextVersion });
    for (const p of plan.cascaded) {
      const dep = await getContentType(p.targetContentTypeId);
      if (dep) await driver.writeJson(typePath(p.targetContentTypeId), { ...dep, version: p.nextVersion });
    }

    if (plan.primary.needsRewrite) await applyFileRewrite(driver, plan.primary.typeName, plan.primary.rewrite);
    for (const p of plan.cascaded) {
      if (p.needsRewrite) await applyFileRewrite(driver, p.typeName, p.rewrite);
    }

    await syncFilePermissions(getEntryAdapter(), await readAllRaw());

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

    await deleteFilePermissions(getEntryAdapter(), allTypes, id);
    await driver.removeJson(typePath(id));

    if (existing.kind !== "component") {
      await driver.removeDir(dataDir(existing.name));
      const indexNames = await driver.listJsonFiles(".index");
      const prefix = `${existing.name}.`;
      for (const name of indexNames) {
        if (name.startsWith(prefix)) await driver.removeJson(`.index/${name}.json`);
      }
    }
  }

  return { listContentTypes, getContentType, planSave, applySave, deleteContentType };
}
