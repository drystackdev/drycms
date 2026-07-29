import type { ResolvedFileContentOption } from "../../../integration/options.js";
import type { RelationCardinality } from "../../field-registry.js";
import type { ContentTypeDefinition } from "../../types.js";
import { applyTimestamps, rowToValue, validateEntryValue, valueToRow, type EntryValue } from "../entry-codec.js";
import { buildEntryFieldTree, type EntryFieldNode } from "../entry-tree.js";
import { ContentEntryError, type ContentEntryEngineAdapter, type EntryPage, type EntryQuery, type EntryRow } from "../entries-types.js";
import { mapWithConcurrency } from "../../../storage/util.js";
import { createFileDriver, safePathSegment, type FileDriver } from "./file-driver.js";
import {
  bumpDataVersion,
  getDataVersion,
  nextId,
  patchReverseIndex,
  readReverseIndexMap,
  readReverseTargets,
  releaseUnique,
  reserveUnique,
  RelationTargetClaimedError,
  UniqueConflictError,
} from "./index-store.js";

type Row = Record<string, unknown>;

/** Singletons are stored at the fixed id `1` - same `data/<type>/<id>.json`
 * layout as a collection, just never anything else in that folder, so
 * `getFileEntry`/`createFileEntry`(-with-id)/`updateFileEntry` are reusable
 * as-is instead of needing a parallel "look for any row" scan the way
 * `entries-sqlite.ts` does. */
const SINGLETON_ID = 1;

function dataDir(typeName: string): string {
  return `data/${safePathSegment(typeName)}`;
}

function recordPath(typeName: string, id: number): string {
  return `${dataDir(typeName)}/${id}.json`;
}

interface UniqueFieldRef {
  fieldId: string;
  fieldName: string;
  label: string;
  columnName: string;
}

/** Only descends through `flatten` - a `validation.unique` field nested
 * inside a REPEATABLE component is validated for every other rule but its
 * uniqueness isn't enforced by this engine (would need a uniqueness scope
 * spanning every item across every record - out of scope for v1; SQL
 * enforces it because it's just another real column, wherever it lives). */
function collectUniqueColumns(nodes: EntryFieldNode[]): UniqueFieldRef[] {
  const out: UniqueFieldRef[] = [];
  for (const node of nodes) {
    if (node.kind === "flatten") {
      out.push(...collectUniqueColumns(node.children));
    } else if (node.kind === "column" && node.validation.unique) {
      out.push({ fieldId: node.fieldId, fieldName: node.fieldName, label: node.label, columnName: node.columnName });
    }
  }
  return out;
}

interface MirrorableRelation {
  fieldId: string;
  fieldName: string;
  label: string;
  cardinality: RelationCardinality;
  /** JSON key this relation's forward value is stored under on the row -
   * `columnName` for `manyToOne` (a single id), `tableName` (repurposed as a
   * plain, already-collision-free JSON key - see the plan doc's "Core
   * data-model decision") for `oneToMany`/`manyToMany` (an id array). */
  storageKey: string;
  /** `oneToMany` only - "each target row is claimed by at most one row
   * here" (see `field-registry.ts`'s `RelationFieldConfig` doc), the
   * file-engine equivalent of SQL's `UNIQUE` constraint on `target_id`. */
  exclusive: boolean;
}

/** Only descends through `flatten` - a relation nested inside a repeatable
 * component can never be mirrored anyway (see `entry-tree.ts`'s
 * `buildRelationMirrorNode`, which only ever resolves against the ROOT
 * tree's own columns/children), so it needs no reverse-index upkeep; its
 * forward value is written inline by `assembleWritableFields` regardless. */
function collectMirrorableRelations(nodes: EntryFieldNode[]): MirrorableRelation[] {
  const out: MirrorableRelation[] = [];
  for (const node of nodes) {
    if (node.kind === "flatten") {
      out.push(...collectMirrorableRelations(node.children));
    } else if (node.kind === "relation" && node.columnName) {
      out.push({ fieldId: node.fieldId, fieldName: node.fieldName, label: node.label, cardinality: node.cardinality, storageKey: node.columnName, exclusive: false });
    } else if (node.kind === "relation" && node.tableName) {
      out.push({
        fieldId: node.fieldId,
        fieldName: node.fieldName,
        label: node.label,
        cardinality: node.cardinality,
        storageKey: node.tableName,
        exclusive: node.cardinality === "oneToMany",
      });
    }
  }
  return out;
}

function targetIds(cardinality: RelationCardinality, storageKey: string, row: Row): number[] {
  const raw = row[storageKey];
  if (cardinality === "manyToOne") return typeof raw === "number" ? [raw] : [];
  return Array.isArray(raw) ? raw.filter((v): v is number => typeof v === "number") : [];
}

function targetIdsFromRow(rel: MirrorableRelation, row: Row): number[] {
  return targetIds(rel.cardinality, rel.storageKey, row);
}

type ResolvedRelationMirrorNode = Extract<EntryFieldNode, { kind: "relation-mirror"; resolved: true }>;

/** Only descends through `flatten`, same as `collectMirrorableRelations` -
 * a `relation-mirror` field is itself never `child-table`-shaped (see
 * `tree.ts`'s `walk()`), so it can only ever appear at the root or nested
 * inside a non-repeatable component. */
function collectRelationMirrorFields(nodes: EntryFieldNode[]): { node: ResolvedRelationMirrorNode; fieldName: string }[] {
  const out: { node: ResolvedRelationMirrorNode; fieldName: string }[] = [];
  for (const node of nodes) {
    if (node.kind === "flatten") {
      out.push(...collectRelationMirrorFields(node.children));
    } else if (node.kind === "relation-mirror" && node.resolved) {
      out.push({ node, fieldName: node.fieldName });
    }
  }
  return out;
}

/** Resolves the mirrored field's OWN storage identity on `sourceTypeId` -
 * same `MirrorableRelation` shape `collectMirrorableRelations` already
 * produces for a type's OWN relation fields, just looked up by id on a
 * DIFFERENT (source) type's tree, so writing through a mirror field reuses
 * the exact same `storageKey`/`exclusive` semantics as a direct write. */
function resolveSourceRelation(allTypes: ContentTypeDefinition[], sourceTypeId: string, sourceFieldId: string): MirrorableRelation | undefined {
  const sourceType = allTypes.find((t) => t.id === sourceTypeId);
  if (!sourceType) return undefined;
  const sourceNodes = buildEntryFieldTree(sourceType, allTypes);
  return collectMirrorableRelations(sourceNodes).find((r) => r.fieldId === sourceFieldId);
}

function assertValid(nodes: EntryFieldNode[], value: EntryValue): void {
  const errors = validateEntryValue(nodes, value);
  if (Object.keys(errors).length > 0) {
    throw new ContentEntryError("validation_failed", "Validation failed.", errors);
  }
}

function getAtPath(value: EntryValue, path: string): unknown {
  let cur: unknown = value;
  for (const part of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function compareValues(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return -1;
  if (b === null || b === undefined) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

async function readRecord(driver: FileDriver, typeName: string, id: number): Promise<Row | null> {
  return driver.readJson<Row>(recordPath(typeName, id));
}

/** Per-call cache for `readReverseIndexMap`, keyed by `sourceTypeName` +
 * `sourceFieldId` - a `relation-mirror` field's reverse-index file is the
 * SAME file for every record of the type being resolved, so a caller
 * resolving a page of N records (`listEntries`) passes one shared cache down
 * through the recursion instead of re-fetching that file N times. */
type ReverseIndexCache = Map<string, Promise<Record<string, number[]>>>;

function cachedReverseIndexMap(driver: FileDriver, cache: ReverseIndexCache | undefined, sourceTypeName: string, sourceFieldId: string): Promise<Record<string, number[]>> {
  if (!cache) return readReverseIndexMap(driver, sourceTypeName, sourceFieldId);
  const key = `${sourceTypeName} ${sourceFieldId}`;
  let mapPromise = cache.get(key);
  if (!mapPromise) {
    mapPromise = readReverseIndexMap(driver, sourceTypeName, sourceFieldId);
    cache.set(key, mapPromise);
  }
  return mapPromise;
}

/** Fills in every field `rowToValue` (reused, unchanged) deliberately
 * skips: `component-repeat` items (recursing `rowToValue` per item, same
 * as `entries-sqlite.ts`'s `populateChildFields`, just reading a nested
 * JSON array already sitting in `row` instead of running a child-table
 * query), `relation` fields with `tableName` (the array is likewise
 * already in `row`), and `relation-mirror` (resolved from the
 * reverse-index instead of physical storage - it's never stored at all).
 * Sibling fields are independent writes into `value`, so they resolve
 * concurrently rather than one at a time. */
async function populateFileChildFields(driver: FileDriver, nodes: EntryFieldNode[], row: Row, id: number, value: EntryValue, cache?: ReverseIndexCache): Promise<void> {
  await Promise.all(
    nodes.map(async (node) => {
      if (node.kind === "flatten") {
        await populateFileChildFields(driver, node.children, row, id, value[node.fieldName] as EntryValue, cache);
      } else if (node.kind === "component-repeat") {
        const rawItems = Array.isArray(row[node.tableName]) ? (row[node.tableName] as Row[]) : [];
        value[node.fieldName] = await Promise.all(
          rawItems.map(async (itemRow) => {
            const item = rowToValue(node.itemFields, itemRow);
            await populateFileChildFields(driver, node.itemFields, itemRow, id, item, cache);
            return item;
          }),
        );
      } else if (node.kind === "relation" && node.tableName) {
        value[node.fieldName] = targetIds(node.cardinality, node.tableName, row);
      } else if (node.kind === "relation-mirror" && node.resolved) {
        const map = await cachedReverseIndexMap(driver, cache, node.sourceTableName, node.sourceFieldId);
        const targets = map[String(id)] ?? [];
        value[node.fieldName] = node.reverseCardinality === "manyToOne" ? (targets[0] ?? null) : targets;
      }
    }),
  );
}

/** Fills in the row keys `valueToRow` (reused, unchanged) deliberately
 * skips - the counterpart to `populateFileChildFields`, on the write
 * side. Mutates `row` in place; must run AFTER `valueToRow`/
 * `applyTimestamps` have already populated it. */
async function assembleWritableFields(nodes: EntryFieldNode[], value: EntryValue, row: Row): Promise<void> {
  for (const node of nodes) {
    if (node.kind === "flatten") {
      await assembleWritableFields(node.children, (value[node.fieldName] as EntryValue) ?? {}, row);
    } else if (node.kind === "component-repeat") {
      const items = Array.isArray(value[node.fieldName]) ? (value[node.fieldName] as EntryValue[]) : [];
      const itemRows: Row[] = [];
      for (const item of items) {
        const itemRow = await valueToRow(node.itemFields, item);
        await assembleWritableFields(node.itemFields, item, itemRow);
        itemRows.push(itemRow);
      }
      row[node.tableName] = itemRows;
    } else if (node.kind === "relation" && node.tableName) {
      const targetIds = Array.isArray(value[node.fieldName]) ? (value[node.fieldName] as unknown[]) : [];
      row[node.tableName] = targetIds.filter((v): v is number => typeof v === "number");
    }
  }
}

/** Reserves every `validation.unique` field's new value and every
 * exclusive (`oneToMany`) relation's new target claims BEFORE the record
 * itself is written, so a genuine conflict never leaves a partial record
 * behind - on any conflict, everything already reserved in this same call
 * is rolled back and a field-level `ContentEntryError` is thrown, shaped
 * like `entries-sqlite.ts`'s `translateUniqueViolation` output. */
async function reserveAll(
  driver: FileDriver,
  typeName: string,
  id: number,
  uniqueFields: UniqueFieldRef[],
  relations: MirrorableRelation[],
  rowData: Row,
  existingRow: Row | null,
): Promise<void> {
  const appliedUnique: UniqueFieldRef[] = [];
  const appliedRelations: MirrorableRelation[] = [];
  try {
    for (const uf of uniqueFields) {
      const oldValue = existingRow ? existingRow[uf.columnName] : undefined;
      await reserveUnique(driver, typeName, uf.fieldId, id, rowData[uf.columnName], oldValue);
      appliedUnique.push(uf);
    }
    for (const rel of relations) {
      const oldTargetIds = existingRow ? targetIdsFromRow(rel, existingRow) : [];
      const newTargetIds = targetIdsFromRow(rel, rowData);
      await patchReverseIndex(driver, typeName, rel.fieldId, id, oldTargetIds, newTargetIds, rel.exclusive);
      appliedRelations.push(rel);
    }
  } catch (error) {
    for (const rel of appliedRelations) {
      const oldTargetIds = existingRow ? targetIdsFromRow(rel, existingRow) : [];
      const newTargetIds = targetIdsFromRow(rel, rowData);
      await patchReverseIndex(driver, typeName, rel.fieldId, id, newTargetIds, oldTargetIds, false).catch(() => undefined);
    }
    for (const uf of appliedUnique) {
      await releaseUnique(driver, typeName, uf.fieldId, id, rowData[uf.columnName]).catch(() => undefined);
      if (existingRow) {
        await reserveUnique(driver, typeName, uf.fieldId, id, existingRow[uf.columnName], undefined).catch(() => undefined);
      }
    }
    if (error instanceof UniqueConflictError) {
      const uf = uniqueFields.find((f) => f.fieldId === error.fieldId)!;
      const message = `"${uf.label}" is already in use.`;
      throw new ContentEntryError("validation_failed", message, { [uf.fieldName]: message });
    }
    if (error instanceof RelationTargetClaimedError) {
      const rel = relations.find((r) => r.fieldId === error.fieldId)!;
      const message = `"${rel.label}" target is already claimed by another entry.`;
      throw new ContentEntryError("validation_failed", message, { [rel.fieldName]: message });
    }
    throw error;
  }
}

async function releaseAll(driver: FileDriver, typeName: string, id: number, uniqueFields: UniqueFieldRef[], relations: MirrorableRelation[], existingRow: Row): Promise<void> {
  for (const uf of uniqueFields) {
    await releaseUnique(driver, typeName, uf.fieldId, id, existingRow[uf.columnName]);
  }
  for (const rel of relations) {
    const oldTargetIds = targetIdsFromRow(rel, existingRow);
    await patchReverseIndex(driver, typeName, rel.fieldId, id, oldTargetIds, [], false);
  }
}

/** Reads `sourceId`'s own record on `sourceTypeName`, applies `mutate` to
 * its relation array field at `storageKey`, writes it back, and patches
 * that field's own reverse-index to match - the file-engine primitive
 * `writeRelationMirrorField` composes to write THROUGH a mirror field, the
 * same way `entries-sqlite.ts`'s `insertRelationChildRow`/`DELETE ...
 * WHERE target_id` pair does for SQL. A dangling `sourceId` (record since
 * deleted) is silently ignored, same as every other unenforced-FK read
 * elsewhere in this adapter. */
async function mutateSourceArray(driver: FileDriver, sourceTypeName: string, sourceId: number, storageKey: string, sourceFieldId: string, mutate: (ids: number[]) => number[], exclusive: boolean): Promise<void> {
  const path = recordPath(sourceTypeName, sourceId);
  const row = await driver.readJson<Row>(path);
  if (!row) return;
  const oldIds = Array.isArray(row[storageKey]) ? (row[storageKey] as unknown[]).filter((v): v is number => typeof v === "number") : [];
  const newIds = mutate(oldIds);
  row[storageKey] = newIds;
  await driver.writeJson(path, row);
  await patchReverseIndex(driver, sourceTypeName, sourceFieldId, sourceId, oldIds, newIds, exclusive);
}

/** Same primitive as `mutateSourceArray`, for a `manyToOne` source field
 * (a single id, not an array). */
async function setSourceManyToOneValue(driver: FileDriver, sourceTypeName: string, sourceId: number, storageKey: string, sourceFieldId: string, newValue: number | null): Promise<void> {
  const path = recordPath(sourceTypeName, sourceId);
  const row = await driver.readJson<Row>(path);
  if (!row) return;
  const oldValue = typeof row[storageKey] === "number" ? (row[storageKey] as number) : null;
  if (oldValue === newValue) return;
  row[storageKey] = newValue;
  await driver.writeJson(path, row);
  await patchReverseIndex(driver, sourceTypeName, sourceFieldId, sourceId, oldValue === null ? [] : [oldValue], newValue === null ? [] : [newValue], false);
}

/** Writes an edited `relation-mirror` field's value THROUGH the mirrored
 * field's own physical storage on whichever OTHER record(s) it lives on -
 * unlike a normal relation field (which owns its own row and can freely
 * overwrite it), a mirror write must touch ONLY the source rows/links
 * relevant to THIS row's id (`targetId`), read from the reverse-index to
 * know its OWN previous claims, never disturbing unrelated rows. Mirrors
 * `entries-sqlite.ts`'s `writeRelationMirror`'s 3-way cardinality switch. */
async function writeRelationMirrorField(driver: FileDriver, allTypes: ContentTypeDefinition[], node: ResolvedRelationMirrorNode, targetId: number, incoming: unknown): Promise<void> {
  const rel = resolveSourceRelation(allTypes, node.sourceTypeId, node.sourceFieldId);
  if (!rel) return; // source relation no longer exists/resolvable - degrade gracefully, same as a dangling reference elsewhere.
  const sourceType = allTypes.find((t) => t.id === node.sourceTypeId)!;
  const sourceTypeName = sourceType.name;

  if (node.reverseCardinality === "oneToMany") {
    // Mirrors a `manyToOne` source field: incoming is number[] of source
    // ids to claim EXCLUSIVELY for `targetId` - no exclusivity CHECK needed
    // here (unlike `oneToMany`'s own forward write): a `manyToOne` column
    // freely accepts being pointed at by any number of different targets
    // over time, just never more than one at once per source row, which a
    // plain overwrite already guarantees.
    const oldSourceIds = await readReverseTargets(driver, sourceTypeName, node.sourceFieldId, targetId);
    const newSourceIds = (Array.isArray(incoming) ? incoming : []).filter((v): v is number => typeof v === "number");
    for (const sid of oldSourceIds.filter((id) => !newSourceIds.includes(id))) {
      await setSourceManyToOneValue(driver, sourceTypeName, sid, rel.storageKey, node.sourceFieldId, null);
    }
    for (const sid of newSourceIds.filter((id) => !oldSourceIds.includes(id))) {
      await setSourceManyToOneValue(driver, sourceTypeName, sid, rel.storageKey, node.sourceFieldId, targetId);
    }
    return;
  }

  if (node.reverseCardinality === "manyToOne") {
    // Mirrors a `oneToMany` source field: incoming is number|null - an
    // exclusive claim, same as a direct `oneToMany` write (the source's own
    // `exclusive: true` still applies, now enforced on whichever NEW source
    // record is being claimed).
    const oldSourceIds = await readReverseTargets(driver, sourceTypeName, node.sourceFieldId, targetId);
    const oldSourceId = oldSourceIds[0] ?? null;
    const newSourceId = typeof incoming === "number" ? incoming : null;
    if (oldSourceId === newSourceId) return;
    if (oldSourceId !== null) {
      await mutateSourceArray(driver, sourceTypeName, oldSourceId, rel.storageKey, node.sourceFieldId, (ids) => ids.filter((id) => id !== targetId), rel.exclusive);
    }
    if (newSourceId !== null) {
      await mutateSourceArray(driver, sourceTypeName, newSourceId, rel.storageKey, node.sourceFieldId, (ids) => (ids.includes(targetId) ? ids : [...ids, targetId]), rel.exclusive);
    }
    return;
  }

  // Mirrors a `manyToMany` source field: incoming is number[], free linking.
  const oldSourceIds = await readReverseTargets(driver, sourceTypeName, node.sourceFieldId, targetId);
  const newSourceIds = (Array.isArray(incoming) ? incoming : []).filter((v): v is number => typeof v === "number");
  for (const sid of oldSourceIds.filter((id) => !newSourceIds.includes(id))) {
    await mutateSourceArray(driver, sourceTypeName, sid, rel.storageKey, node.sourceFieldId, (ids) => ids.filter((id) => id !== targetId), false);
  }
  for (const sid of newSourceIds.filter((id) => !oldSourceIds.includes(id))) {
    await mutateSourceArray(driver, sourceTypeName, sid, rel.storageKey, node.sourceFieldId, (ids) => (ids.includes(targetId) ? ids : [...ids, targetId]), false);
  }
}

async function writeRelationMirrorFields(driver: FileDriver, nodes: EntryFieldNode[], allTypes: ContentTypeDefinition[], id: number, value: EntryValue): Promise<void> {
  for (const { node, fieldName } of collectRelationMirrorFields(nodes)) {
    await writeRelationMirrorField(driver, allTypes, node, id, value[fieldName]);
  }
}

/** Driver-parameterized read - no transaction needed (read-only), but takes
 * `driver` explicitly (rather than a fixed adapter-bound instance) so it can
 * also be called with a `tx` mid-transaction, reading back a just-staged
 * write (see `createFileEntry`/`updateFileEntry` below). */
export async function getFileEntry(driver: FileDriver, type: ContentTypeDefinition, allTypes: ContentTypeDefinition[], id: number): Promise<EntryRow | null> {
  const row = await readRecord(driver, type.name, id);
  if (!row) return null;
  const nodes = buildEntryFieldTree(type, allTypes);
  const value = rowToValue(nodes, row);
  await populateFileChildFields(driver, nodes, row, id, value);
  return { id, value };
}

/** The actual write logic behind `createFileEntry`/`saveFileSingletonEntry` -
 * takes `driver` explicitly so callers can run several of these inside ONE
 * shared `driver.transaction()` (e.g. `permissions-file.ts` batching many
 * rows into a single commit at boot), rather than each call opening its own
 * transaction: the record write, every unique/reverse-index reservation, and
 * every relation-mirror write it touches on OTHER records all land together. */
export async function createFileEntryWithId(driver: FileDriver, type: ContentTypeDefinition, allTypes: ContentTypeDefinition[], id: number, value: EntryValue): Promise<EntryRow> {
  const nodes = buildEntryFieldTree(type, allTypes);
  assertValid(nodes, value);

  const rowData: Row = applyTimestamps(nodes, await valueToRow(nodes, value), "create");
  rowData.id = id;
  await assembleWritableFields(nodes, value, rowData);

  const uniqueFields = collectUniqueColumns(nodes);
  const relations = collectMirrorableRelations(nodes);
  await reserveAll(driver, type.name, id, uniqueFields, relations, rowData, null);

  await driver.writeJson(recordPath(type.name, id), rowData);
  await writeRelationMirrorFields(driver, nodes, allTypes, id, value);
  return (await getFileEntry(driver, type, allTypes, id))!;
}

/** Auto-assigns the next id, then delegates to `createFileEntryWithId` - the
 * driver-parameterized counterpart to `ContentEntryEngineAdapter.createEntry`. */
export async function createFileEntry(driver: FileDriver, type: ContentTypeDefinition, allTypes: ContentTypeDefinition[], value: EntryValue): Promise<EntryRow> {
  const id = await nextId(driver, type.name);
  return createFileEntryWithId(driver, type, allTypes, id, value);
}

/** Same rationale as `createFileEntryWithId` - the driver-parameterized
 * counterpart to `ContentEntryEngineAdapter.updateEntry`. */
export async function updateFileEntry(driver: FileDriver, type: ContentTypeDefinition, allTypes: ContentTypeDefinition[], id: number, value: EntryValue): Promise<EntryRow> {
  const nodes = buildEntryFieldTree(type, allTypes);
  assertValid(nodes, value);

  const existingRow = await readRecord(driver, type.name, id);
  if (!existingRow) {
    throw new ContentEntryError("not_found", `Entry ${id} not found on "${type.name}".`);
  }

  const rowData: Row = applyTimestamps(nodes, await valueToRow(nodes, value), "update");
  rowData.id = id;
  await assembleWritableFields(nodes, value, rowData);

  const uniqueFields = collectUniqueColumns(nodes);
  const relations = collectMirrorableRelations(nodes);
  await reserveAll(driver, type.name, id, uniqueFields, relations, rowData, existingRow);

  await driver.writeJson(recordPath(type.name, id), rowData);
  await writeRelationMirrorFields(driver, nodes, allTypes, id, value);
  return (await getFileEntry(driver, type, allTypes, id))!;
}

/** Same rationale as `createFileEntryWithId` - the driver-parameterized
 * counterpart to `ContentEntryEngineAdapter.deleteEntry`. */
export async function deleteFileEntry(driver: FileDriver, type: ContentTypeDefinition, allTypes: ContentTypeDefinition[], id: number): Promise<void> {
  const nodes = buildEntryFieldTree(type, allTypes);
  const existingRow = await readRecord(driver, type.name, id);
  if (!existingRow) return;

  const uniqueFields = collectUniqueColumns(nodes);
  const relations = collectMirrorableRelations(nodes);
  await releaseAll(driver, type.name, id, uniqueFields, relations, existingRow);
  await driver.removeJson(recordPath(type.name, id));
}

/** Driver-parameterized counterpart to `ContentEntryEngineAdapter.reorderEntries`
 * - a direct `sortIndex` patch per record (skipping `updateFileEntry`'s
 * unique/relation-mirror bookkeeping entirely, since a reorder never touches
 * any other field) rather than a full `updateFileEntry` call per row. */
export async function reorderFileEntries(
  driver: FileDriver,
  type: ContentTypeDefinition,
  updates: { id: number; sortIndex: number }[],
): Promise<void> {
  for (const { id, sortIndex } of updates) {
    const row = await readRecord(driver, type.name, id);
    if (!row) continue;
    row.sortIndex = sortIndex;
    await driver.writeJson(recordPath(type.name, id), row);
  }
}

/** Bounds how many records a single `listEntries` page reads at once on
 * `github`/`gitlab` - same rationale as `github.ts`'s `LISTALL_DATE_CONCURRENCY`:
 * bounded parallel reads instead of either the sequential-`await` cost of one
 * at a time, or an unbounded `Promise.all` opening a socket per record. */
const LIST_ENTRIES_READ_CONCURRENCY = 24;

async function listEntries(driver: FileDriver, type: ContentTypeDefinition, allTypes: ContentTypeDefinition[], query: EntryQuery): Promise<EntryPage> {
  const nodes = buildEntryFieldTree(type, allTypes);
  const names = await driver.listJsonFiles(dataDir(type.name));
  const ids = names.map(Number).filter((id) => Number.isInteger(id));

  // One reverse-index file per `relation-mirror` field, shared across the
  // whole page instead of re-read once per record (see `ReverseIndexCache`).
  const reverseCache: ReverseIndexCache = new Map();
  const resolved = await mapWithConcurrency(ids, LIST_ENTRIES_READ_CONCURRENCY, async (id): Promise<EntryRow | null> => {
    const row = await readRecord(driver, type.name, id);
    if (!row) return null;
    const value = rowToValue(nodes, row);
    await populateFileChildFields(driver, nodes, row, id, value, reverseCache);
    return { id, value };
  });
  let rows: EntryRow[] = resolved.filter((row): row is EntryRow => row !== null);

  if (query.search && query.searchableFields && query.searchableFields.length > 0) {
    const term = query.search.toLowerCase();
    rows = rows.filter((row) =>
      query.searchableFields!.some((field) => {
        const v = getAtPath(row.value, field);
        return typeof v === "string" && v.toLowerCase().includes(term);
      }),
    );
  }

  if (query.sortField) {
    const dir = query.sortDir === "asc" ? 1 : -1;
    rows = [...rows].sort((a, b) => dir * compareValues(getAtPath(a.value, query.sortField!), getAtPath(b.value, query.sortField!)));
  } else {
    rows = [...rows].sort((a, b) => b.id - a.id);
  }

  const total = rows.length;
  const pageSize = Math.max(1, query.pageSize);
  const offset = Math.max(0, query.page) * pageSize;
  return { total, rows: rows.slice(offset, offset + pageSize) };
}

export function createFileContentEntryEngineAdapter(option: ResolvedFileContentOption): ContentEntryEngineAdapter {
  const driver: FileDriver = createFileDriver(option);

  return {
    listEntries: (type, allTypes, query) => listEntries(driver, type, allTypes, query),
    getEntry: (type, allTypes, id) => getFileEntry(driver, type, allTypes, id),
    // Everything a create/update/delete touches - the record itself, its
    // unique-index/reverse-index entries, any relation-mirror writes it
    // makes on OTHER records, and the data-version bump - lands as one
    // commit (see `FileDriver.transaction()`), so a version bump can never
    // be observed without its data change or vice versa.
    createEntry: (type, allTypes, value) =>
      driver.transaction(async (tx) => {
        const row = await createFileEntry(tx, type, allTypes, value);
        await bumpDataVersion(tx, type.name);
        return row;
      }),
    updateEntry: (type, allTypes, id, value) =>
      driver.transaction(async (tx) => {
        const row = await updateFileEntry(tx, type, allTypes, id, value);
        await bumpDataVersion(tx, type.name);
        return row;
      }),
    deleteEntry: (type, allTypes, id) =>
      driver.transaction(async (tx) => {
        await deleteFileEntry(tx, type, allTypes, id);
        await bumpDataVersion(tx, type.name);
      }),
    reorderEntries: (type, allTypes, updates) =>
      driver.transaction(async (tx) => {
        await reorderFileEntries(tx, type, updates);
        await bumpDataVersion(tx, type.name);
      }),
    getSingletonEntry: (type, allTypes) => getFileEntry(driver, type, allTypes, SINGLETON_ID),
    saveSingletonEntry: (type, allTypes, value) =>
      driver.transaction(async (tx) => {
        const existing = await readRecord(tx, type.name, SINGLETON_ID);
        const row = existing
          ? await updateFileEntry(tx, type, allTypes, SINGLETON_ID, value)
          : await createFileEntryWithId(tx, type, allTypes, SINGLETON_ID, value);
        await bumpDataVersion(tx, type.name);
        return row;
      }),
    getResourceVersion: (type) => getDataVersion(driver, type.name),
  };
}
