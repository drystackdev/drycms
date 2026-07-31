import { findDependents } from "../../tree.js";
import type { ContentTypeDefinition } from "../../types.js";
import { buildEntryFieldTree, type EntryFieldNode } from "../entry-tree.js";
import type { FileDriver } from "./file-driver.js";
import { safePathSegment } from "./file-driver.js";

/**
 * File-engine counterpart to `migration.ts`'s `DestructiveChange`/`SavePlan` -
 * same id-based-diff CONCEPT and the same top-level `primary`/`cascaded`/
 * `destructiveSummary` shape (see the plan doc's "ported, not copied"
 * decision), but there is no DDL: a "migration" here is a bulk rewrite pass
 * over already-stored JSON records, not a `Statement[]`.
 */
export type FileDestructiveChange =
  | { kind: "field-removed"; typeName: string; fieldName: string }
  | { kind: "field-renamed"; typeName: string; fieldName: string; detail: string }
  | { kind: "shape-changed"; typeName: string; fieldName: string; detail: string }
  | { kind: "retyped"; typeName: string; fieldName: string; detail: string };

export interface RewriteOp {
  removeKeys: string[];
  renameKeys: { from: string; to: string }[];
  transforms: { key: string; toKey: string; kind: "retype-scalar" | "wrap-array" | "unwrap-array"; fieldType?: string }[];
}

export interface FileMigrationPlan {
  targetContentTypeId: string;
  typeName: string;
  needsRewrite: boolean;
  rewrite: RewriteOp;
  destructive: FileDestructiveChange[];
  /** Same optimistic-lock pair as SQL's `MigrationPlan` - EVERY plan carries
   * its own, not just the primary: a cascaded dependent's EFFECTIVE schema
   * changed (the component it embeds did), so its own version must bump and
   * be re-verified at apply time too, even though its own `fields[]` array
   * is textually unchanged. */
  expectedVersion: number;
  nextVersion: number;
}

export interface FileSavePlan {
  primary: FileMigrationPlan;
  /** Only non-empty when saving a `component` - one plan per transitive
   * dependent whose stored records need rewriting even though that
   * dependent's own `fields` didn't change (see `tree.ts`'s
   * `findDependents`, reused verbatim - it's a pure `ContentTypeDefinition[]`
   * graph walk, no SQL). */
  cascaded: FileMigrationPlan[];
  destructiveSummary: FileDestructiveChange[];
}

interface FileLeaf {
  fieldId: string;
  fieldName: string;
  storageKey: string;
  shape: "column" | "child-table";
  fieldType?: string;
}

/** Only descends through `flatten` (matches `entries-file.ts`'s own
 * `collectUniqueColumns`/`collectMirrorableRelations`) - a `relation-mirror`
 * node is virtual (never physical storage, see `entry-tree.ts`) and is
 * skipped entirely; a field nested inside a repeatable component gets its
 * own fresh leaf set the moment that component is itself diffed (its
 * `itemFields` are re-walked from scratch, never flattened into the
 * parent's). */
function collectLeaves(nodes: EntryFieldNode[]): FileLeaf[] {
  const out: FileLeaf[] = [];
  for (const node of nodes) {
    if (node.kind === "flatten") {
      out.push(...collectLeaves(node.children));
    } else if (node.kind === "column") {
      out.push({ fieldId: node.fieldId, fieldName: node.fieldName, storageKey: node.columnName, shape: "column", fieldType: node.fieldType });
    } else if (node.kind === "component-repeat") {
      out.push({ fieldId: node.fieldId, fieldName: node.fieldName, storageKey: node.tableName, shape: "child-table" });
    } else if (node.kind === "relation") {
      if (node.columnName) {
        out.push({ fieldId: node.fieldId, fieldName: node.fieldName, storageKey: node.columnName, shape: "column", fieldType: "relation" });
      } else if (node.tableName) {
        out.push({ fieldId: node.fieldId, fieldName: node.fieldName, storageKey: node.tableName, shape: "child-table" });
      }
    }
  }
  return out;
}

/** Diffs one content type's old vs new field tree by field id (never by
 * name/position - a rename is "the same id, a different storage key", not a
 * drop+add) - the file-engine analog of `migration.ts`'s `diffColumns`.
 * `oldType: undefined` means the type is brand new (nothing to rewrite). */
export function diffFileType(
  oldType: ContentTypeDefinition | undefined,
  oldAllTypes: ContentTypeDefinition[],
  newType: ContentTypeDefinition,
  newAllTypes: ContentTypeDefinition[],
): FileMigrationPlan {
  const expectedVersion = oldType?.version ?? 0;
  const nextVersion = expectedVersion + 1;
  const oldLeaves = oldType ? collectLeaves(buildEntryFieldTree(oldType, oldAllTypes)) : [];
  const newLeaves = collectLeaves(buildEntryFieldTree(newType, newAllTypes));
  const oldById = new Map(oldLeaves.map((l) => [l.fieldId, l]));
  const newById = new Map(newLeaves.map((l) => [l.fieldId, l]));
  const allIds = new Set([...oldById.keys(), ...newById.keys()]);

  const rewrite: RewriteOp = { removeKeys: [], renameKeys: [], transforms: [] };
  const destructive: FileDestructiveChange[] = [];

  for (const id of allIds) {
    const o = oldById.get(id);
    const n = newById.get(id);
    if (o && !n) {
      rewrite.removeKeys.push(o.storageKey);
      destructive.push({ kind: "field-removed", typeName: newType.name, fieldName: o.fieldName });
    } else if (o && n) {
      if (o.shape !== n.shape) {
        rewrite.transforms.push({ key: o.storageKey, toKey: n.storageKey, kind: n.shape === "child-table" ? "wrap-array" : "unwrap-array", fieldType: n.fieldType });
        destructive.push({ kind: "shape-changed", typeName: newType.name, fieldName: n.fieldName, detail: `${o.shape} -> ${n.shape}` });
      } else if (o.shape === "column" && o.fieldType !== n.fieldType) {
        rewrite.transforms.push({ key: o.storageKey, toKey: n.storageKey, kind: "retype-scalar", fieldType: n.fieldType });
        destructive.push({ kind: "retyped", typeName: newType.name, fieldName: n.fieldName, detail: `${o.fieldType} -> ${n.fieldType}` });
      } else if (o.storageKey !== n.storageKey) {
        rewrite.renameKeys.push({ from: o.storageKey, to: n.storageKey });
        destructive.push({ kind: "field-renamed", typeName: newType.name, fieldName: n.fieldName, detail: `${o.storageKey} -> ${n.storageKey}` });
      }
    }
    // `!o && n` (a field just added): nothing to migrate.
  }

  const needsRewrite = rewrite.removeKeys.length + rewrite.renameKeys.length + rewrite.transforms.length > 0;
  return { targetContentTypeId: newType.id, typeName: newType.name, needsRewrite, rewrite, destructive, expectedVersion, nextVersion };
}

/** Orchestration entry point, mirroring `migration.ts`'s `planSave` -
 * `component`s produce no rewrite of their own (nothing stores a component's
 * fields directly), but every transitive dependent's stored records need
 * rewriting even though the dependent's own `fields` didn't change. */
export function planFileSave(input: {
  savedType: ContentTypeDefinition;
  oldAllTypes: ContentTypeDefinition[];
  newAllTypes: ContentTypeDefinition[];
}): FileSavePlan {
  const { savedType, oldAllTypes, newAllTypes } = input;
  const oldType = oldAllTypes.find((t) => t.id === savedType.id);

  const primary =
    savedType.kind === "component"
      ? {
          targetContentTypeId: savedType.id,
          typeName: savedType.name,
          needsRewrite: false,
          rewrite: { removeKeys: [], renameKeys: [], transforms: [] },
          destructive: [],
          expectedVersion: oldType?.version ?? 0,
          nextVersion: (oldType?.version ?? 0) + 1,
        }
      : diffFileType(oldType, oldAllTypes, savedType, newAllTypes);

  let cascaded: FileMigrationPlan[] = [];
  if (savedType.kind === "component") {
    const dependents = findDependents(savedType.id, newAllTypes);
    cascaded = dependents.map((dep) => diffFileType(oldAllTypes.find((t) => t.id === dep.id), oldAllTypes, dep, newAllTypes));
  }

  const destructiveSummary = [primary, ...cascaded].flatMap((p) => p.destructive);
  return { primary, cascaded, destructiveSummary };
}

function coerceScalar(raw: unknown, fieldType: string | undefined): unknown {
  if (raw === null || raw === undefined) return null;
  switch (fieldType) {
    case "number": {
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    }
    case "boolean":
      return raw === true || raw === 1 || raw === "true";
    case "date": {
      const d = new Date(raw as string | number);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }
    default:
      return String(raw);
  }
}

/** Applies a `RewriteOp` to every stored record in `typeName`'s collection -
 * the file-engine's only form of "migration", run bulk (not per-row-on-next-
 * read) so stored JSON stays a faithful, current snapshot of the schema
 * (important for the git-diffability the whole engine is for). Best-effort:
 * a value that can't be sensibly coerced becomes `null` rather than blocking
 * the whole save, same spirit as SQL's `CAST` in `recreateTableStatements`
 * (which silently produces `0`/`NULL` for a non-numeric-looking TEXT too). */
export async function applyFileRewrite(driver: FileDriver, typeName: string, op: RewriteOp): Promise<void> {
  if (!op.removeKeys.length && !op.renameKeys.length && !op.transforms.length) return;
  const dir = `data/${safePathSegment(typeName)}`;
  const names = await driver.listJsonFiles(dir);

  for (const name of names) {
    const path = `${dir}/${name}.json`;
    const row = await driver.readJson<Record<string, unknown>>(path);
    if (!row) continue;
    let changed = false;

    for (const key of op.removeKeys) {
      if (key in row) {
        delete row[key];
        changed = true;
      }
    }
    for (const { from, to } of op.renameKeys) {
      if (from in row) {
        row[to] = row[from];
        delete row[from];
        changed = true;
      }
    }
    for (const t of op.transforms) {
      if (!(t.key in row)) continue;
      const raw = row[t.key];
      if (t.kind === "wrap-array") {
        row[t.toKey] = raw === null || raw === undefined ? [] : [raw];
      } else if (t.kind === "unwrap-array") {
        row[t.toKey] = Array.isArray(raw) ? (raw[0] ?? null) : null;
      } else {
        row[t.toKey] = coerceScalar(raw, t.fieldType);
      }
      if (t.key !== t.toKey) delete row[t.key];
      changed = true;
    }

    if (changed) await driver.writeJson(path, row);
  }
}
