import type { DryRouteContext } from "../context.js";
import type { SessionPayload } from "../../lib/session-token.js";
import type { ContentTypeDefinition } from "../../content-types/types.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const tempDirBox = vi.hoisted(() => ({ path: "" }));

vi.mock("../config.js", async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  tempDirBox.path = mkdtempSync(join(tmpdir(), "drycms-ai-magic-write-"));
  return {
    ai: { mode: "server", lang: "English" },
    content: { engine: "sqlite", file: join(tempDirBox.path, "content.sqlite") },
    storage: { kind: "local", root: join(tempDirBox.path, "storage") },
  };
});

const { resolveEntryMedia } = await import("./ai-magic-write.js");
const { createContentEngineAdapter, createContentEntryEngineAdapter } = await import("../../content-types/engine/index.js");
const { getStorageAdapter } = await import("../storage-adapters.js");
const { content, storage } = await import("../config.js");
const { encodeEntryId } = await import("../../lib/id-hash.js");
const { entryMediaFolderPath, tempEntryMediaFolderPath } = await import("../../content-types/entry-media-paths.js");

afterAll(async () => {
  const { rm } = await import("node:fs/promises");
  await rm(tempDirBox.path, { recursive: true, force: true });
});

const schema = createContentEngineAdapter(content);
const entries = createContentEntryEngineAdapter(content);

const session: SessionPayload = { id: 1, name: "Media Admin", email: "media-admin@example.com" };

function context(): DryRouteContext {
  const url = new URL("http://localhost/dry/api/ai/magic-write");
  return { params: {}, request: new Request(url), url, env: {}, session };
}

/** Only the fields `resolveEntryMedia` actually reads. */
function request(overrides: { entryId?: string; slug?: string }) {
  return {
    typeSlug: "mediapost",
    entryId: overrides.entryId,
    currentValue: overrides.slug === undefined ? {} : { slug: overrides.slug },
    prompt: "hi",
    history: [],
    images: [],
    sessionImagePaths: [],
    aiKeyName: "key",
    aiModel: undefined,
    rewritePassage: undefined,
    rewriteInline: false,
  };
}

let sluggedType: ContentTypeDefinition;
let plainType: ContentTypeDefinition;
let savedEntryId: number;

beforeAll(async () => {
  sluggedType = {
    id: "custom-media-post",
    kind: "collection",
    name: "mediapost",
    label: "Media Post",
    // `features.slug` contributes the title/slug columns itself.
    features: { slug: true },
    fields: [{ id: "f-cover", name: "cover", label: "Cover", type: "image", config: {}, validation: {}, order: 0 }],
    version: 0,
  };
  await schema.applySave(sluggedType, await schema.planSave(sluggedType));

  plainType = {
    id: "custom-media-note",
    kind: "collection",
    name: "medianote",
    label: "Media Note",
    features: {},
    fields: [{ id: "f-body", name: "body", label: "Body", type: "text", config: {}, validation: {}, order: 0 }],
    version: 0,
  };
  await schema.applySave(plainType, await schema.planSave(plainType));

  const row = await entries.createEntry(sluggedType, [sluggedType], { title: "Saved Post", slug: "saved-post" });
  savedEntryId = row.id;

  const adapter = getStorageAdapter(storage, context());
  await adapter.mkdir(entryMediaFolderPath("saved-post"));
  await adapter.write(`${entryMediaFolderPath("saved-post")}/hero.webp`, new Uint8Array([1]));
  await adapter.write(`${entryMediaFolderPath("saved-post")}/notes.txt`, new Uint8Array([1]));

  const tempFolder = tempEntryMediaFolderPath("mediapost", session.email);
  await adapter.mkdir(tempFolder);
  await adapter.write(`${tempFolder}/draft-cover.png`, new Uint8Array([1]));
});

describe("resolveEntryMedia", () => {
  it("finds a saved entry's folder from its STORED slug, images only", async () => {
    const result = await resolveEntryMedia(context(), entries, [sluggedType], sluggedType, request({ entryId: encodeEntryId(savedEntryId) }) as never);
    expect(result.folder).toBe("entry/saved-post");
    expect(result.imagePaths).toEqual(["entry/saved-post/hero.webp"]);
  });

  it("ignores an unsaved slug rename - the folder only moves on save", async () => {
    const result = await resolveEntryMedia(
      context(),
      entries,
      [sluggedType],
      sluggedType,
      request({ entryId: encodeEntryId(savedEntryId), slug: "renamed-but-not-saved" }) as never,
    );
    expect(result.folder).toBe("entry/saved-post");
  });

  it("uses this admin's own staging folder for a brand-new entry", async () => {
    const result = await resolveEntryMedia(context(), entries, [sluggedType], sluggedType, request({ slug: "typed-but-unsaved" }) as never);
    expect(result.folder).toBe(tempEntryMediaFolderPath("mediapost", session.email));
    expect(result.imagePaths).toEqual([`${tempEntryMediaFolderPath("mediapost", session.email)}/draft-cover.png`]);
  });

  it("resolves to nothing for a type with no slug feature - it has no entry folder", async () => {
    const result = await resolveEntryMedia(context(), entries, [plainType], plainType, request({ entryId: encodeEntryId(savedEntryId) }) as never);
    expect(result).toEqual({ folder: "", imagePaths: [] });
  });

  it("resolves to nothing when the entry's folder was never created", async () => {
    const row = await entries.createEntry(sluggedType, [sluggedType], { title: "No Media", slug: "no-media" });
    const result = await resolveEntryMedia(context(), entries, [sluggedType], sluggedType, request({ entryId: encodeEntryId(row.id) }) as never);
    expect(result.folder).toBe("entry/no-media");
    expect(result.imagePaths).toEqual([]);
  });
});
