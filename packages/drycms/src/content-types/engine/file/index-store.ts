import { safePathSegment, type FileDriver } from "./file-driver.js";

/** Thrown by `reserveUnique` on a collision - caught and translated by
 * `entries-file.ts` into a `ContentEntryError("validation_failed", ...)`
 * shaped exactly like `entries-sqlite.ts`'s `translateUniqueViolation`
 * output, so the UI's inline-field-error contract is identical across
 * engines. */
export class UniqueConflictError extends Error {
  constructor(
    public fieldId: string,
    public value: unknown,
  ) {
    super(`Unique constraint violated for field "${fieldId}".`);
    this.name = "UniqueConflictError";
  }
}

function seqPath(typeName: string): string {
  return `.index/${safePathSegment(typeName)}._seq.json`;
}

function uniquePath(typeName: string, fieldId: string): string {
  return `.index/${safePathSegment(typeName)}.${safePathSegment(fieldId)}.unique.json`;
}

function reversePath(sourceTypeName: string, sourceFieldId: string): string {
  return `.index/${safePathSegment(sourceTypeName)}.${safePathSegment(sourceFieldId)}.reverse.json`;
}

function dataDir(typeName: string): string {
  return `data/${safePathSegment(typeName)}`;
}

/** Core resilience principle (see the plan doc): the record file under
 * `data/<type>/<id>.json` is the only source of truth. Every `.index/*`
 * file below is a derived, rebuildable cache - if it's ever missing or
 * corrupt, it's silently rebuilt from scratch rather than treated as an
 * error. */

/** Rebuilds `.index/<type>._seq.json` from the actual filenames present
 * under `data/<type>/` (ignores the fixed `"singleton"` filename a
 * singleton type uses) - always correct, just O(n) in the collection size,
 * which is fine: only ever runs when the counter file is missing/corrupt. */
async function rebuildSeq(driver: FileDriver, typeName: string): Promise<number> {
  const names = await driver.listJsonFiles(dataDir(typeName));
  let max = 0;
  for (const name of names) {
    const id = Number(name);
    if (Number.isInteger(id) && id > max) max = id;
  }
  return max;
}

/** Assigns the next id for a new record in `typeName`'s collection. */
export async function nextId(driver: FileDriver, typeName: string): Promise<number> {
  return driver.withLock(`seq:${typeName}`, async () => {
    const current = await driver.readJson<{ lastId: number }>(seqPath(typeName));
    const lastId = current && Number.isInteger(current.lastId) ? current.lastId : await rebuildSeq(driver, typeName);
    const next = lastId + 1;
    await driver.writeJson(seqPath(typeName), { lastId: next });
    return next;
  });
}

function serializeIndexKey(value: unknown): string {
  return JSON.stringify(value ?? null);
}

/** Checks a `validation.unique` field's new value against every OTHER
 * record's reserved value, then reserves it for `id` - all under one lock
 * acquisition, so two concurrent writers can never both "pass" the check for
 * the same value. `oldValue` (the record's own previous value, `undefined`
 * on create) is released from the map first so updating a record's own
 * unique field back to a value IT already owned never self-conflicts. Throws
 * `UniqueConflictError` on a genuine collision - nothing is written in that
 * case. */
export async function reserveUnique(
  driver: FileDriver,
  typeName: string,
  fieldId: string,
  id: number,
  newValue: unknown,
  oldValue: unknown,
): Promise<void> {
  const isEmpty = newValue === null || newValue === undefined || newValue === "";
  await driver.withLock(`unique:${typeName}.${fieldId}`, async () => {
    const map = (await driver.readJson<Record<string, number>>(uniquePath(typeName, fieldId))) ?? {};
    if (oldValue !== undefined) delete map[serializeIndexKey(oldValue)];
    if (isEmpty) {
      await driver.writeJson(uniquePath(typeName, fieldId), map);
      return;
    }
    const key = serializeIndexKey(newValue);
    const owner = map[key];
    if (owner !== undefined && owner !== id) {
      throw new UniqueConflictError(fieldId, newValue);
    }
    map[key] = id;
    await driver.writeJson(uniquePath(typeName, fieldId), map);
  });
}

/** Releases a deleted record's own reserved unique value, if any. */
export async function releaseUnique(driver: FileDriver, typeName: string, fieldId: string, id: number, value: unknown): Promise<void> {
  if (value === null || value === undefined || value === "") return;
  await driver.withLock(`unique:${typeName}.${fieldId}`, async () => {
    const map = (await driver.readJson<Record<string, number>>(uniquePath(typeName, fieldId))) ?? {};
    const key = serializeIndexKey(value);
    if (map[key] === id) {
      delete map[key];
      await driver.writeJson(uniquePath(typeName, fieldId), map);
    }
  });
}

/** The full `targetId -> sourceIds[]` map backing every `relationmirror`
 * field resolved through `(sourceTypeName, sourceFieldId)` - factored out of
 * `readReverseTargets` so a caller resolving the same field across many
 * records (`listEntries`) can fetch this once and look up each record's id
 * in memory, instead of paying one `readJson` per record for what is always
 * the same file. */
export async function readReverseIndexMap(driver: FileDriver, sourceTypeName: string, sourceFieldId: string): Promise<Record<string, number[]>> {
  return (await driver.readJson<Record<string, number[]>>(reversePath(sourceTypeName, sourceFieldId))) ?? {};
}

/** Every source-record id currently pointing at `targetId` through
 * `(sourceTypeName, sourceFieldId)`'s relation field - the read side of a
 * `relationmirror` field. */
export async function readReverseTargets(driver: FileDriver, sourceTypeName: string, sourceFieldId: string, targetId: number): Promise<number[]> {
  const map = await readReverseIndexMap(driver, sourceTypeName, sourceFieldId);
  return map[String(targetId)] ?? [];
}

/** Thrown by `patchReverseIndex` when `exclusive: true` (a `oneToMany`
 * relation - "each target row is claimed by at most one row here", see
 * `field-registry.ts`'s `RelationFieldConfig` doc) and a target is already
 * claimed by a DIFFERENT source row - the file-engine equivalent of SQL's
 * `UNIQUE` constraint on the child table's `target_id` column. */
export class RelationTargetClaimedError extends Error {
  constructor(
    public fieldId: string,
    public targetId: number,
    public claimedBySourceId: number,
  ) {
    super(`Target ${targetId} is already claimed by entry ${claimedBySourceId}.`);
    this.name = "RelationTargetClaimedError";
  }
}

/** Patches the reverse-index for `(sourceTypeName, sourceFieldId)` after
 * `sourceId`'s own relation field value changed from `oldTargetIds` to
 * `newTargetIds` - removes `sourceId` from every target it no longer points
 * at, adds it to every new one. Safe to call with `oldTargetIds: []` on
 * create and `newTargetIds: []` on delete. When `exclusive` (the field's
 * cardinality is `oneToMany`), every newly-claimed target is checked against
 * every OTHER source id already claiming it, atomically within the same lock
 * acquisition as the write - throws `RelationTargetClaimedError` and writes
 * nothing on a conflict. */
export async function patchReverseIndex(
  driver: FileDriver,
  sourceTypeName: string,
  sourceFieldId: string,
  sourceId: number,
  oldTargetIds: number[],
  newTargetIds: number[],
  exclusive = false,
): Promise<void> {
  const oldSet = new Set(oldTargetIds);
  const newSet = new Set(newTargetIds);
  const removed = oldTargetIds.filter((id) => !newSet.has(id));
  const added = newTargetIds.filter((id) => !oldSet.has(id));
  if (removed.length === 0 && added.length === 0) return;

  await driver.withLock(`reverse:${sourceTypeName}.${sourceFieldId}`, async () => {
    const path = reversePath(sourceTypeName, sourceFieldId);
    const map = (await driver.readJson<Record<string, number[]>>(path)) ?? {};

    if (exclusive) {
      for (const targetId of added) {
        const claimants = (map[String(targetId)] ?? []).filter((id) => id !== sourceId);
        if (claimants.length > 0) {
          throw new RelationTargetClaimedError(sourceFieldId, targetId, claimants[0]!);
        }
      }
    }

    for (const targetId of removed) {
      const key = String(targetId);
      map[key] = (map[key] ?? []).filter((id) => id !== sourceId);
      if (map[key]!.length === 0) delete map[key];
    }
    for (const targetId of added) {
      const key = String(targetId);
      const list = map[key] ?? [];
      if (!list.includes(sourceId)) list.push(sourceId);
      map[key] = list;
    }
    await driver.writeJson(path, map);
  });
}

/** Rebuilds `.index/<sourceType>.<sourceFieldId>.reverse.json` from scratch,
 * given every current source record's own target-id list for that field -
 * the counterpart to `rebuildSeq`, exposed for the same "always rebuildable
 * from the source of truth" guarantee. Callers (entries-file.ts, which
 * already has the field tree and the rows loaded) compute `rows`; this
 * function only owns the index file's own shape. */
export async function rebuildReverseIndex(
  driver: FileDriver,
  sourceTypeName: string,
  sourceFieldId: string,
  rows: { sourceId: number; targetIds: number[] }[],
): Promise<void> {
  const map: Record<string, number[]> = {};
  for (const { sourceId, targetIds } of rows) {
    for (const targetId of targetIds) {
      const key = String(targetId);
      const list = map[key] ?? [];
      list.push(sourceId);
      map[key] = list;
    }
  }
  await driver.withLock(`reverse:${sourceTypeName}.${sourceFieldId}`, () => driver.writeJson(reversePath(sourceTypeName, sourceFieldId), map));
}
