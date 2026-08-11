import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createLocalStorageAdapter } from "../storage/local.js";
import type { StorageAdapter } from "../storage/types.js";
import { listEntryMediaImages, removeEntryMediaFolder, syncEntryMediaFolder } from "./entry-media.js";
import { entryMediaFolderPath, tempEntryMediaFolderPath } from "./entry-media-paths.js";

let dir: string;
let adapter: StorageAdapter;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "drycms-entry-media-"));
  adapter = createLocalStorageAdapter(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("syncEntryMediaFolder", () => {
  it("moves the temp folder to entry/<slug> on first save", async () => {
    const tempPath = tempEntryMediaFolderPath("blog", "person@example.com");
    await adapter.mkdir(tempPath);
    await adapter.write(`${tempPath}/hero.jpg`, new Uint8Array([1]));

    await syncEntryMediaFolder(adapter, { collectionName: "blog", userEmail: "person@example.com", toSlug: "my-post" });

    expect(await adapter.stat(tempPath)).toBeNull();
    expect(await adapter.stat(entryMediaFolderPath("my-post"))).toMatchObject({ kind: "folder" });
    expect(await adapter.stat(`${entryMediaFolderPath("my-post")}/hero.jpg`)).not.toBeNull();
  });

  it("no-ops on first save when nothing was ever uploaded to the temp folder", async () => {
    await syncEntryMediaFolder(adapter, { collectionName: "blog", userEmail: "person@example.com", toSlug: "my-post" });
    expect(await adapter.stat(entryMediaFolderPath("my-post"))).toBeNull();
  });

  it("renames entry/<fromSlug> to entry/<toSlug> when the slug changes", async () => {
    await adapter.mkdir(entryMediaFolderPath("old-slug"));
    await adapter.write(`${entryMediaFolderPath("old-slug")}/hero.jpg`, new Uint8Array([1]));

    await syncEntryMediaFolder(adapter, { collectionName: "blog", userEmail: "person@example.com", fromSlug: "old-slug", toSlug: "new-slug" });

    expect(await adapter.stat(entryMediaFolderPath("old-slug"))).toBeNull();
    expect(await adapter.stat(`${entryMediaFolderPath("new-slug")}/hero.jpg`)).not.toBeNull();
  });

  it("no-ops a rename when the entry never had a media folder", async () => {
    await syncEntryMediaFolder(adapter, { collectionName: "blog", userEmail: "person@example.com", fromSlug: "old-slug", toSlug: "new-slug" });
    expect(await adapter.stat(entryMediaFolderPath("new-slug"))).toBeNull();
  });

  it("is a no-op when fromSlug and toSlug are the same", async () => {
    await adapter.mkdir(entryMediaFolderPath("same-slug"));
    await syncEntryMediaFolder(adapter, { collectionName: "blog", userEmail: "person@example.com", fromSlug: "same-slug", toSlug: "same-slug" });
    expect(await adapter.stat(entryMediaFolderPath("same-slug"))).not.toBeNull();
  });

  it("is a no-op when toSlug is missing", async () => {
    await syncEntryMediaFolder(adapter, { collectionName: "blog", userEmail: "person@example.com", toSlug: null });
    expect(await adapter.list("")).toEqual([]);
  });
});

describe("removeEntryMediaFolder", () => {
  it("removes an entry's media folder", async () => {
    await adapter.mkdir(entryMediaFolderPath("my-post"));
    await removeEntryMediaFolder(adapter, "my-post");
    expect(await adapter.stat(entryMediaFolderPath("my-post"))).toBeNull();
  });

  it("no-ops when the entry never had a media folder", async () => {
    await expect(removeEntryMediaFolder(adapter, "never-had-one")).resolves.toBeUndefined();
  });
});

describe("listEntryMediaImages", () => {
  it("lists only the image files in the folder, as full storage paths", async () => {
    const folder = entryMediaFolderPath("my-post");
    await adapter.mkdir(folder);
    await adapter.write(`${folder}/hero.JPG`, new Uint8Array([1]));
    await adapter.write(`${folder}/diagram.svg`, new Uint8Array([1]));
    await adapter.write(`${folder}/notes.pdf`, new Uint8Array([1]));
    await adapter.mkdir(`${folder}/gallery`);

    expect((await listEntryMediaImages(adapter, folder)).sort()).toEqual([
      "entry/my-post/diagram.svg",
      "entry/my-post/hero.JPG",
    ]);
  });

  it("reads a brand-new entry's hidden temp folder, which parent listings omit", async () => {
    const tempPath = tempEntryMediaFolderPath("blog", "person@example.com");
    await adapter.mkdir(tempPath);
    await adapter.write(`${tempPath}/pasted.png`, new Uint8Array([1]));

    expect(await listEntryMediaImages(adapter, tempPath)).toEqual([`${tempPath}/pasted.png`]);
  });

  it("resolves to nothing for a folder that doesn't exist yet", async () => {
    await expect(listEntryMediaImages(adapter, entryMediaFolderPath("never-uploaded"))).resolves.toEqual([]);
  });

  it("caps how many paths it hands back", async () => {
    const folder = entryMediaFolderPath("many");
    await adapter.mkdir(folder);
    for (let index = 0; index < 5; index++) await adapter.write(`${folder}/img-${index}.png`, new Uint8Array([1]));

    expect(await listEntryMediaImages(adapter, folder, 2)).toHaveLength(2);
  });
});
