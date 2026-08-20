import type { DryRouteContext } from "./context.js";
import type { GitRepoConfig } from "./git-config.js";
import { pagesSourceStorage } from "./config.js";
import { getStorageAdapter } from "./storage-adapters.js";
import { getContentAdapters } from "./content-adapters.js";
import { commitRepositoryChanges, pullRepositorySnapshot } from "./git-source-sync.js";
import { readPagesSourceTree } from "./routes/pages-source-github-sync.js";
import { regenerateTypesCache, runBatch } from "./routes/content-types.js";
import { createStorageSchemaDocumentStore } from "./schema-document-storage.js";
import { SCHEMA_DOCUMENT_PATH, parseSchemaDocument, serializeSchemaDocument } from "../content-types/schema-document.js";
import { isGitMirrorEligible, isGitMirrorEligibleEntry } from "../content-types/git-mirror.js";
import { PAGES_SOURCE_ROOTS } from "./app-router/source-roots.js";
import type { ContentTypeDefinition } from "../content-types/types.js";
import type { EntryValue } from "../content-types/engine/entry-codec.js";
import type { DestructiveChange } from "../content-types/migration.js";

/**
 * "Go back to this commit" for the whole tenant - the engine behind the
 * Versions page (`pages/settings/Versions.tsx`, `status/git-versions-page.md`).
 *
 * Three things move together, because a commit describes all three at once:
 * page source (`pagesSourceStorage`), the content-type schema
 * (`content/types.json` + the real tables it describes), and mirrored entry
 * rows (`content/entries/**`). They are restored in that order - code first
 * (it can't fail), schema next (it decides which tables the rows go into),
 * rows last.
 *
 * Two rules shape everything below:
 *
 * - **Forward-only history.** Nothing here rewrites or drops a commit: the
 *   restored state is committed as ONE NEW commit on top of the branch
 *   (`commitRepositoryChanges`), so "go back" is itself a step forward and
 *   two admins can never lose each other's work.
 * - **Only what git knows about is touched.** An entry row is deleted only
 *   when its mirror file exists at HEAD but not at the target commit - i.e.
 *   git can prove it was created after that commit. A row that has never
 *   been mirrored (seeded data, anything written before content history was
 *   turned on) is left completely alone rather than assumed deleted, because
 *   `content/entries/**` is a mirror of changes, not a full dump of D1.
 */

/** `content/entries/<typeName>/<id>.json`, or `.../singleton.json` for a
 * singleton - the layout `routes/content-history.ts` writes. */
const ENTRY_PATH_RE = /^content\/entries\/([^/]+)\/([^/]+)\.json$/;

interface MirroredEntryFile {
  typeName: string;
  /** `null` for the singleton file. */
  entryId: number | null;
  content: string;
}

function parseEntryPath(path: string, content: string): MirroredEntryFile | null {
  const match = ENTRY_PATH_RE.exec(path);
  if (!match) return null;
  const [, typeName, key] = match as unknown as [string, string, string];
  if (key === "singleton") return { typeName, entryId: null, content };
  if (!/^\d+$/.test(key)) return null;
  return { typeName, entryId: Number(key), content };
}

function mirroredEntries(files: Record<string, string>): MirroredEntryFile[] {
  return Object.entries(files)
    .map(([path, content]) => parseEntryPath(path, content))
    .filter((entry): entry is MirroredEntryFile => entry !== null);
}

/** Two definitions are "the same schema" when everything but the
 * optimistic-concurrency `version` matches - a restore must not re-run a
 * migration (and bump every dependent's version) for a type the target
 * commit describes exactly as it already is. */
function sameDefinition(left: ContentTypeDefinition, right: ContentTypeDefinition): boolean {
  const strip = ({ version: _version, ...rest }: ContentTypeDefinition) => JSON.stringify(rest);
  return strip(left) === strip(right);
}

export interface RestoreSchemaPlan {
  /** Labels of the types this restore will re-apply (create or migrate). */
  apply: string[];
  /** Labels of live types the target commit doesn't have any more. */
  remove: string[];
  /** Data-losing migrations the re-apply implies, as `migration.ts` reports
   * them - shown in the confirm dialog before anything is written. */
  destructive: DestructiveChange[];
}

export interface RestorePlan {
  sha: string;
  /** Page-source files to write / delete in `pagesSourceStorage`. */
  source: { write: string[]; remove: string[] };
  schema: RestoreSchemaPlan;
  entries: { restore: number; remove: number };
  /** Things a restore deliberately will NOT do, each with its reason -
   * always shown to the admin, never silently swallowed. */
  warnings: string[];
}

export interface RestoreResult extends RestorePlan {
  applied: boolean;
  /** The new commit this restore pushed, when it got that far. */
  commitSha?: string;
  /** Why no commit was pushed (the restore itself still applied). */
  commitReason?: string;
  /** Per-item failures that did NOT stop the rest of the restore. */
  errors: string[];
}

export type RestoreOutcome = { ok: true; result: RestoreResult } | { ok: false; reason: string };

interface RestoreOptions {
  mode: "plan" | "apply";
  author: { name: string; email: string };
}

export interface EntryPullResult {
  /** Mirrored entries written into this install's live database. */
  restored: number;
  /** Mirrored entries skipped because their content type doesn't exist (or
   * isn't git-mirror-eligible) in the current schema, each as `"type#id"`. */
  skipped: string[];
  applied: boolean;
  errors: string[];
}

export type EntryPullOutcome = { ok: true; result: EntryPullResult } | { ok: false; reason: string };

/**
 * The reverse direction of `content-history.ts`'s own mirror write: pulls
 * every `content/entries/**` file at the branch's current HEAD and writes it
 * into THIS install's live database (`Backup.tsx`'s "Entry" section) - e.g.
 * hydrating a freshly cloned branch whose local sqlite has never seen these
 * rows, since the mirror otherwise only ever flows D1 -> git.
 *
 * Deliberately narrower than `restoreCommit` above: no page source, no
 * schema, no target commit to diff against - just HEAD's mirror files
 * written straight into the matching live rows. Only entries git already has
 * a mirror file for are touched; nothing is deleted, since the mirror is a
 * record of past changes, not a full dump of every row.
 */
export async function pullEntriesFromGit(
  context: DryRouteContext,
  config: GitRepoConfig,
  options: { mode: "plan" | "apply" },
): Promise<EntryPullOutcome> {
  const head = await pullRepositorySnapshot(config);
  if (!head.ok) return { ok: false, reason: head.reason };

  const { schema: schemaAdapter, entries: entryAdapter } = getContentAdapters(context);
  const allTypes = await schemaAdapter.listContentTypes();
  const typeByName = new Map(allTypes.filter(isGitMirrorEligible).map((type) => [type.name, type]));

  const skipped: string[] = [];
  const toRestore = mirroredEntries(head.snapshot.contentByPath).filter((entry) => {
    if (typeByName.has(entry.typeName)) return true;
    skipped.push(`${entry.typeName}#${entry.entryId ?? "singleton"}`);
    return false;
  });

  if (options.mode === "plan") {
    return { ok: true, result: { restored: toRestore.length, skipped, applied: false, errors: [] } };
  }

  const errors: string[] = [];
  let restored = 0;
  for (const entry of toRestore) {
    const type = typeByName.get(entry.typeName)!;
    try {
      const value = JSON.parse(entry.content) as EntryValue;
      // Defense in depth, same reasoning as `restoreCommit` above - the
      // write side never mirrors the Super Admin role row, but a pull must
      // not trust that blindly.
      if (!isGitMirrorEligibleEntry(type, value)) continue;
      if (entry.entryId === null) await entryAdapter.saveSingletonEntry(type, allTypes, value);
      else await entryAdapter.restoreEntry(type, allTypes, entry.entryId, value);
      restored++;
    } catch (error) {
      errors.push(`${entry.typeName}#${entry.entryId ?? "singleton"}: ${error instanceof Error ? error.message : "could not be restored."}`);
    }
  }
  return { ok: true, result: { restored, skipped, applied: true, errors } };
}

export async function restoreCommit(
  context: DryRouteContext,
  config: GitRepoConfig,
  sha: string,
  options: RestoreOptions,
): Promise<RestoreOutcome> {
  const target = await pullRepositorySnapshot(config, sha);
  if (!target.ok) return { ok: false, reason: target.reason };
  const head = await pullRepositorySnapshot(config);
  if (!head.ok) return { ok: false, reason: head.reason };

  const warnings: string[] = [];
  const errors: string[] = [];
  const { schema: schemaAdapter, entries: entryAdapter } = getContentAdapters(context);

  // 1. Page source ------------------------------------------------------
  const currentSource = await readPagesSourceTree(context);
  const sourceWrite = Object.keys(target.snapshot.sourceByPath)
    .filter((path) => currentSource[path] !== target.snapshot.sourceByPath[path])
    .sort();
  // Deleting is scoped to the four page-source roots: `readPagesSourceTree`
  // returns every `.tsx/.ts/.css/.md` in the store, but the snapshot only
  // ever carries files under a root (`isRestorablePath`), so an unrooted file
  // would look "missing from the commit" and be deleted on the strength of a
  // filter, not a fact.
  const sourceRemove = Object.keys(currentSource)
    .filter((path) => !(path in target.snapshot.sourceByPath) && PAGES_SOURCE_ROOTS.some((root) => path.startsWith(`${root.id}/`)))
    .sort();

  // 2. Schema -----------------------------------------------------------
  const targetDocText = target.snapshot.contentByPath[SCHEMA_DOCUMENT_PATH];
  const liveTypes = await schemaAdapter.listContentTypes();
  let targetDoc: ReturnType<typeof parseSchemaDocument> | null = null;
  if (targetDocText === undefined) {
    warnings.push(`This commit has no "${SCHEMA_DOCUMENT_PATH}", so content types and entries are left exactly as they are - only page source is restored.`);
  } else {
    try {
      targetDoc = parseSchemaDocument(targetDocText);
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : `"${SCHEMA_DOCUMENT_PATH}" could not be read at this commit.` };
    }
  }

  const toApply: ContentTypeDefinition[] = [];
  const toRemove: ContentTypeDefinition[] = [];
  if (targetDoc) {
    for (const wanted of targetDoc.applied) {
      const live = liveTypes.find((type) => type.id === wanted.id);
      if (live && sameDefinition(live, wanted)) continue;
      // The live version is what `planSave`'s optimistic-concurrency check
      // compares against; the snapshot's own (older) number would be
      // rejected as a stale edit on every single restore.
      toApply.push({ ...wanted, version: live?.version ?? 0 });
    }
    for (const live of liveTypes) {
      if (targetDoc.applied.some((wanted) => wanted.id === live.id)) continue;
      if (live.locked || live.frozen) {
        warnings.push(`"${live.label || live.name}" is a protected system type and is kept, even though this commit doesn't have it.`);
        continue;
      }
      toRemove.push(live);
    }
  }

  // 3. Entries ----------------------------------------------------------
  // The schema AFTER this restore decides which types entries may go into:
  // a row can only be written into a table the restored schema describes.
  const restoredTypes = targetDoc
    ? targetDoc.applied.map((wanted) => ({ ...wanted, version: liveTypes.find((live) => live.id === wanted.id)?.version ?? 0 }))
    : liveTypes;
  const typeByName = new Map(restoredTypes.filter(isGitMirrorEligible).map((type) => [type.name, type]));

  const targetEntries = targetDoc ? mirroredEntries(target.snapshot.contentByPath) : [];
  const headEntries = targetDoc ? mirroredEntries(head.snapshot.contentByPath) : [];
  const targetEntryKeys = new Set(targetEntries.map((entry) => `${entry.typeName}/${entry.entryId ?? "singleton"}`));

  const entriesToRestore = targetEntries.filter((entry) => {
    if (typeByName.has(entry.typeName)) return true;
    warnings.push(`Entry "${entry.typeName}" from this commit was skipped - that content type doesn't exist in the restored schema.`);
    return false;
  });
  /** Created after the target commit (git has a mirror file for it at HEAD
   * and none at `sha`), so restoring means removing it again. A singleton
   * has no such thing as "not existing yet" - its row always stays. */
  const entriesToRemove = headEntries.filter(
    (entry) => entry.entryId !== null && typeByName.has(entry.typeName) && !targetEntryKeys.has(`${entry.typeName}/${entry.entryId}`),
  );

  const plan: RestorePlan = {
    sha: target.snapshot.sha,
    source: { write: sourceWrite, remove: sourceRemove },
    schema: {
      apply: toApply.map((type) => type.label || type.name),
      remove: toRemove.map((type) => type.label || type.name),
      destructive: [],
    },
    entries: { restore: entriesToRestore.length, remove: entriesToRemove.length },
    warnings,
  };

  if (options.mode === "plan") {
    if (toApply.length > 0) {
      const planned = await runBatch(schemaAdapter, entryAdapter, "plan", toApply.map((definition) => ({ definition })), context);
      plan.schema.destructive = planned.results.flatMap((result) => result.destructiveSummary ?? []);
      for (const result of planned.results) if (!result.ok && result.error) errors.push(`${result.label}: ${result.error}`);
    }
    return { ok: true, result: { ...plan, applied: false, errors } };
  }

  // 4. Apply ------------------------------------------------------------
  const storage = getStorageAdapter(pagesSourceStorage, context);
  for (const path of sourceRemove) await storage.remove(path);
  for (const path of sourceWrite) {
    await storage.write(path, new TextEncoder().encode(target.snapshot.sourceByPath[path]!));
  }

  if (toApply.length > 0) {
    // `commitToGit: false`: this restore pushes ONE commit of its own at the
    // end, covering code + schema + entries together.
    const applied = await runBatch(schemaAdapter, entryAdapter, "apply", toApply.map((definition) => ({ definition })), context, { commitToGit: false });
    for (const result of applied.results) if (!result.ok && result.error) errors.push(`${result.label}: ${result.error}`);
  }
  for (const type of toRemove) {
    try {
      await schemaAdapter.deleteContentType(type.id);
    } catch (error) {
      errors.push(`${type.label || type.name}: ${error instanceof Error ? error.message : "could not be deleted."}`);
    }
  }
  if (toRemove.length > 0) await regenerateTypesCache(schemaAdapter, context);

  // Entries go in against the schema as it is NOW - after the migrations
  // above, not the list that was planned against the old one.
  const allTypes = await schemaAdapter.listContentTypes();
  const liveByName = new Map(allTypes.filter(isGitMirrorEligible).map((type) => [type.name, type]));

  for (const entry of entriesToRestore) {
    const type = liveByName.get(entry.typeName);
    if (!type) continue;
    try {
      const value = JSON.parse(entry.content) as EntryValue;
      // Defense in depth: a legacy or hand-edited mirror file could still
      // carry a Super Admin role row even though the write side no longer
      // ever produces one - never let a restore write it back.
      if (!isGitMirrorEligibleEntry(type, value)) continue;
      if (entry.entryId === null) await entryAdapter.saveSingletonEntry(type, allTypes, value);
      else await entryAdapter.restoreEntry(type, allTypes, entry.entryId, value);
    } catch (error) {
      errors.push(`${entry.typeName}#${entry.entryId ?? "singleton"}: ${error instanceof Error ? error.message : "could not be restored."}`);
    }
  }
  for (const entry of entriesToRemove) {
    const type = liveByName.get(entry.typeName);
    if (!type || entry.entryId === null) continue;
    try {
      await entryAdapter.deleteEntry(type, allTypes, entry.entryId);
    } catch (error) {
      errors.push(`${entry.typeName}#${entry.entryId}: ${error instanceof Error ? error.message : "could not be removed."}`);
    }
  }

  // Staged (not yet applied) schema drafts are part of the file too, so a
  // restore puts them back as the commit had them - the `applied` half stays
  // whatever the migrations above actually produced.
  const documentStore = createStorageSchemaDocumentStore(context);
  const currentDoc = await documentStore.read();
  if (targetDoc && currentDoc) await documentStore.write({ ...currentDoc, drafts: targetDoc.drafts });

  // 5. One commit for the whole restore ---------------------------------
  const files: Record<string, string | null> = {};
  const targetFiles = { ...target.snapshot.sourceByPath, ...target.snapshot.contentByPath };
  const headFiles = { ...head.snapshot.sourceByPath, ...head.snapshot.contentByPath };
  // What the schema document really looks like after the migrations, not the
  // bytes from the past: `revision` only ever moves forward, and re-committing
  // an older one would make the next apply diff against a document that no
  // longer matches the tables.
  const restoredDoc = await documentStore.read();
  if (restoredDoc) targetFiles[SCHEMA_DOCUMENT_PATH] = serializeSchemaDocument(restoredDoc);
  for (const [path, content] of Object.entries(targetFiles)) {
    if (headFiles[path] !== content) files[path] = content;
  }
  for (const path of Object.keys(headFiles)) {
    if (!(path in targetFiles)) files[path] = null;
  }

  const short = target.snapshot.sha.slice(0, 7);
  const commitMessage = `Restore ${short}`;
  if (Object.keys(files).length === 0) {
    return { ok: true, result: { ...plan, applied: true, commitReason: "The repository already matched this commit - nothing to commit.", errors } };
  }
  const committed = await commitRepositoryChanges(config, files, commitMessage, options.author);
  return {
    ok: true,
    result: {
      ...plan,
      applied: true,
      commitSha: committed.ok ? committed.commitSha : undefined,
      commitReason: committed.ok ? undefined : committed.reason,
      errors,
    },
  };
}
