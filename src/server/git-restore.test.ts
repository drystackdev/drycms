import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DryRouteContext } from "./context.js";
import type { GitRepoConfig } from "./git-config.js";
import type { ContentTypeDefinition } from "../content-types/types.js";

/**
 * `git-restore.ts` against a real sqlite database and a real local
 * pages-source directory, with only the git side faked - the whole point of
 * this module is what it does to those two stores, so mocking them out would
 * test nothing (`status/git-versions-page.md`).
 */
const tempDirBox = vi.hoisted(() => ({ contentDir: "", pagesSourceDir: "" }));
/** The fake remote: two snapshots (HEAD and the target commit) plus whatever
 * `commitRepositoryChanges` was asked to push. */
const repoBox = vi.hoisted(() => ({
  head: { sha: "head0000", sourceByPath: {} as Record<string, string>, contentByPath: {} as Record<string, string> },
  target: { sha: "0ldc0mm", sourceByPath: {} as Record<string, string>, contentByPath: {} as Record<string, string> },
  committed: null as null | { files: Record<string, string | null>; message: string },
}));

vi.mock("./config.js", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { resolveOptions } = await import("./options.js");
  tempDirBox.contentDir = mkdtempSync(join(tmpdir(), "drycms-git-restore-content-"));
  tempDirBox.pagesSourceDir = mkdtempSync(join(tmpdir(), "drycms-git-restore-pages-"));
  const resolved = resolveOptions({}, { localDataRoot: tempDirBox.contentDir });
  return {
    content: { engine: "sqlite", file: join(tempDirBox.contentDir, "content.sqlite") },
    typesCacheStorage: resolved.typesCache.storage,
    pagesSourceStorage: { kind: "local", root: tempDirBox.pagesSourceDir },
  };
});

// Partial mock: `pages-source-github-sync.ts` (which this module calls for
// the current page-source tree) imports `PAGE_SOURCE_FILE_PATTERN` from the
// same module, so replacing it wholesale would break the half under test.
vi.mock("./git-source-sync.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./git-source-sync.js")>()),
  pullRepositorySnapshot: async (_config: GitRepoConfig, sha?: string) => ({
    ok: true,
    snapshot: sha ? repoBox.target : repoBox.head,
  }),
  commitRepositoryChanges: async (_config: GitRepoConfig, files: Record<string, string | null>, message: string) => {
    repoBox.committed = { files, message };
    return { ok: true, commitSha: "newc0mm" };
  },
}));

const { restoreCommit } = await import("./git-restore.js");
const { getContentAdapters } = await import("./content-adapters.js");
const { createStorageSchemaDocumentStore } = await import("./schema-document-storage.js");
const { getStorageAdapter } = await import("./storage-adapters.js");
const { pagesSourceStorage } = await import("./config.js");
const { serializeSchemaDocument } = await import("../content-types/schema-document.js");

afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(tempDirBox.contentDir, { recursive: true, force: true });
  await rm(tempDirBox.pagesSourceDir, { recursive: true, force: true });
});

const context = { env: {} } as unknown as DryRouteContext;
const config = { repo: "acme/site", branch: "main", token: "t", provider: "github", url: "https://github.com", user: "" } as GitRepoConfig;
const author = { name: "Tester", email: "tester@example.com" };

const NOTE: ContentTypeDefinition = {
  id: "custom-note",
  kind: "collection",
  name: "note",
  label: "Note",
  version: 0,
  fields: [{ id: "note-title", name: "title", label: "Title", type: "text", config: {}, validation: {}, order: 0 }],
};

async function seed() {
  const { schema, entries } = getContentAdapters(context);
  const live = await schema.getContentType(NOTE.id);
  const note = live ?? (await schema.applySave(NOTE, await schema.planSave(NOTE)));
  const allTypes = await schema.listContentTypes();
  return { schema, entries, note, allTypes };
}

beforeEach(() => {
  repoBox.committed = null;
});

describe("restoreCommit", () => {
  it("restores page source, reverts a mirrored entry, removes one created since, and leaves unmirrored rows alone", async () => {
    const { schema, entries, note } = await seed();
    const allTypes = await schema.listContentTypes();

    const reverted = await entries.createEntry(note, allTypes, { title: "current title" });
    const createdSince = await entries.createEntry(note, allTypes, { title: "created after the commit" });
    const neverMirrored = await entries.createEntry(note, allTypes, { title: "seeded row git never saw" });

    const storage = getStorageAdapter(pagesSourceStorage, context);
    await storage.write("pages/page.tsx", new TextEncoder().encode("export default () => <p>now</p>;"));
    await storage.write("pages/extra/page.tsx", new TextEncoder().encode("export default () => <p>added later</p>;"));

    const document = await createStorageSchemaDocumentStore(context).read();
    const documentText = serializeSchemaDocument(document!);

    repoBox.head = {
      sha: "head0000",
      sourceByPath: {
        "pages/page.tsx": "export default () => <p>now</p>;",
        "pages/extra/page.tsx": "export default () => <p>added later</p>;",
      },
      contentByPath: {
        "content/types.json": documentText,
        [`content/entries/note/${reverted.id}.json`]: JSON.stringify({ title: "current title" }),
        [`content/entries/note/${createdSince.id}.json`]: JSON.stringify({ title: "created after the commit" }),
      },
    };
    repoBox.target = {
      sha: "0ldc0mm",
      sourceByPath: { "pages/page.tsx": "export default () => <p>then</p>;" },
      contentByPath: {
        "content/types.json": documentText,
        [`content/entries/note/${reverted.id}.json`]: JSON.stringify({ title: "old title" }),
      },
    };

    const outcome = await restoreCommit(context, config, "0ldc0mm", { mode: "apply", author });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.errors).toEqual([]);
    expect(outcome.result.commitSha).toBe("newc0mm");

    // Page source: the old file is back, the one added later is gone.
    const restoredPage = await storage.read("pages/page.tsx");
    const chunks: Buffer[] = [];
    for await (const chunk of restoredPage.stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    expect(Buffer.concat(chunks).toString("utf-8")).toContain("then");
    expect(await storage.stat("pages/extra/page.tsx")).toBeNull();

    // Entries: reverted in place (same id), removed if git proves it was
    // created after the commit, untouched if git never mirrored it at all.
    const allTypesAfter = await schema.listContentTypes();
    const noteAfter = allTypesAfter.find((type) => type.id === NOTE.id)!;
    expect((await entries.getEntry(noteAfter, allTypesAfter, reverted.id))?.value.title).toBe("old title");
    expect(await entries.getEntry(noteAfter, allTypesAfter, createdSince.id)).toBeNull();
    expect((await entries.getEntry(noteAfter, allTypesAfter, neverMirrored.id))?.value.title).toBe("seeded row git never saw");

    // The restore is ONE forward commit: it re-adds what the commit had and
    // deletes what only HEAD had - it never rewinds the branch.
    expect(repoBox.committed?.message).toBe("Restore 0ldc0mm");
    expect(repoBox.committed?.files["pages/page.tsx"]).toContain("then");
    expect(repoBox.committed?.files["pages/extra/page.tsx"]).toBeNull();
    expect(repoBox.committed?.files[`content/entries/note/${createdSince.id}.json`]).toBeNull();
  });

  it("re-inserts a mirrored entry that was deleted since, at its original id", async () => {
    const { schema, entries, note } = await seed();
    const allTypes = await schema.listContentTypes();
    const row = await entries.createEntry(note, allTypes, { title: "will be deleted" });
    await entries.deleteEntry(note, allTypes, row.id);

    const documentText = serializeSchemaDocument((await createStorageSchemaDocumentStore(context).read())!);
    const source = { "pages/page.tsx": "export default () => <p>then</p>;" };
    repoBox.head = { sha: "head0000", sourceByPath: source, contentByPath: { "content/types.json": documentText } };
    repoBox.target = {
      sha: "0ldc0mm",
      sourceByPath: source,
      contentByPath: {
        "content/types.json": documentText,
        [`content/entries/note/${row.id}.json`]: JSON.stringify({ title: "will be deleted", createdAt: "2020-01-01T00:00:00.000Z" }),
      },
    };

    const outcome = await restoreCommit(context, config, "0ldc0mm", { mode: "apply", author });
    expect(outcome.ok).toBe(true);
    const allTypesAfter = await schema.listContentTypes();
    const noteAfter = allTypesAfter.find((type) => type.id === NOTE.id)!;
    const restored = await entries.getEntry(noteAfter, allTypesAfter, row.id);
    expect(restored?.value.title).toBe("will be deleted");
    expect(restored?.id).toBe(row.id);
  });

  it("plan mode reports the change without writing anything", async () => {
    const { schema, entries, note } = await seed();
    const allTypes = await schema.listContentTypes();
    const row = await entries.createEntry(note, allTypes, { title: "untouched by a plan" });

    const documentText = serializeSchemaDocument((await createStorageSchemaDocumentStore(context).read())!);
    repoBox.head = {
      sha: "head0000",
      sourceByPath: { "pages/page.tsx": "export default () => <p>now</p>;" },
      contentByPath: { "content/types.json": documentText, [`content/entries/note/${row.id}.json`]: JSON.stringify({ title: "untouched by a plan" }) },
    };
    repoBox.target = {
      sha: "0ldc0mm",
      sourceByPath: { "pages/page.tsx": "export default () => <p>planned</p>;" },
      contentByPath: { "content/types.json": documentText },
    };

    const outcome = await restoreCommit(context, config, "0ldc0mm", { mode: "plan", author });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.applied).toBe(false);
    expect(outcome.result.source.write).toContain("pages/page.tsx");
    expect(outcome.result.entries.remove).toBe(1);
    expect(repoBox.committed).toBeNull();

    const allTypesAfter = await schema.listContentTypes();
    const noteAfter = allTypesAfter.find((type) => type.id === NOTE.id)!;
    expect((await entries.getEntry(noteAfter, allTypesAfter, row.id))?.value.title).toBe("untouched by a plan");
  });
});
