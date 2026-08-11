import { describe, expect, it, vi } from "vitest";
import { createMemoryFileSource } from "../mock/file-manager.js";
import { scopeFileSource } from "./scoped-source.js";
import type { FileEntry, FileManagerSource } from "./entry-types.js";

const seed: FileEntry[] = [
  { id: "entry", name: "entry", parentId: null, kind: "folder" },
  { id: "entry/blog-1", name: "blog-1", parentId: "entry", kind: "folder" },
  { id: "entry/blog-1/hero.jpg", name: "hero.jpg", parentId: "entry/blog-1", kind: "file", ext: "jpg" },
  { id: "entry/blog-1/sub", name: "sub", parentId: "entry/blog-1", kind: "folder" },
  { id: "entry/blog-1/sub/x.png", name: "x.png", parentId: "entry/blog-1/sub", kind: "file", ext: "png" },
  { id: "entry/blog-2", name: "blog-2", parentId: "entry", kind: "folder" },
  { id: "entry/blog-2/other.jpg", name: "other.jpg", parentId: "entry/blog-2", kind: "file", ext: "jpg" },
  { id: "readme.txt", name: "readme.txt", parentId: null, kind: "file", ext: "txt" },
];

describe("scopeFileSource", () => {
  it("falls back to listing the exact scope when the full tree hides a temp entry folder", async () => {
    const delegate: FileManagerSource = {
      listAll: async () => [],
      list: async (folderId) => folderId === ".tmp.blog.admin"
        ? [{ id: ".tmp.blog.admin/pasted.jpg", parentId: ".tmp.blog.admin", name: "pasted.jpg", kind: "file", previewUrl: "/storage/.tmp.blog.admin/pasted.jpg" }]
        : [],
    };

    const scoped = scopeFileSource(delegate, ".tmp.blog.admin");
    expect(await scoped.listAll?.()).toEqual([
      expect.objectContaining({ id: ".tmp.blog.admin/pasted.jpg", parentId: null, name: "pasted.jpg" }),
    ]);
  });
  it("list(null) shows only the scoped folder's immediate children, re-rooted but with absolute ids", async () => {
    const scoped = scopeFileSource(createMemoryFileSource(seed), "entry/blog-1");
    const entries = await scoped.list(null);
    // Ids stay storage-absolute - that's what a picked value gets stored as.
    expect(entries.map((e) => e.id).sort()).toEqual(["entry/blog-1/hero.jpg", "entry/blog-1/sub"]);
    // Only `parentId` is re-rooted, so `FileManager` treats the scope as root.
    expect(entries.every((e) => e.parentId === null)).toBe(true);
  });

  it("list(folderId) descends into a subfolder using its absolute id", async () => {
    const scoped = scopeFileSource(createMemoryFileSource(seed), "entry/blog-1");
    const entries = await scoped.list("entry/blog-1/sub");
    expect(entries).toEqual([
      expect.objectContaining({ id: "entry/blog-1/sub/x.png", parentId: "entry/blog-1/sub" }),
    ]);
  });

  it("still accepts a relative id, for a value stored before ids went absolute", async () => {
    const scoped = scopeFileSource(createMemoryFileSource(seed), "entry/blog-1");
    const entries = await scoped.list("sub");
    expect(entries).toEqual([expect.objectContaining({ id: "entry/blog-1/sub/x.png" })]);
  });

  it("listAll returns only descendants of the scoped folder, re-rooted", async () => {
    const scoped = scopeFileSource(createMemoryFileSource(seed), "entry/blog-1");
    const all = (await scoped.listAll!())!;
    expect(all.map((e) => e.id).sort()).toEqual([
      "entry/blog-1/hero.jpg",
      "entry/blog-1/sub",
      "entry/blog-1/sub/x.png",
    ]);
    expect(all.find((e) => e.id === "entry/blog-1/hero.jpg")?.parentId).toBe(null);
    // Nothing from the sibling "blog-2" folder or the storage root ever leaks through.
    expect(all.some((e) => e.id.includes("blog-2") || e.id === "readme.txt")).toBe(false);
  });

  it("exposes its scope root, so a picker can tell an entry-folder id apart", async () => {
    expect(scopeFileSource(createMemoryFileSource(seed), "entry/blog-1").scopeRoot).toBe("entry/blog-1");
  });

  it("mutating operations resolve ids against the scoped prefix", async () => {
    const delegate = createMemoryFileSource(seed);
    const scoped = scopeFileSource(delegate, "entry/blog-1");

    const created = await scoped.createFolder!(null, "photos");
    expect(created.id).toBe("entry/blog-1/photos");
    expect(await delegate.list("entry/blog-1")).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "entry/blog-1/photos" })]),
    );

    const uploaded = await scoped.upload!(null, [new File(["x"], "cover.jpg", { type: "image/jpeg" })]);
    expect(uploaded[0]?.id).toBe("entry/blog-1/cover.jpg");
    expect(await delegate.list("entry/blog-1")).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "entry/blog-1/cover.jpg" })]),
    );

    const renamed = await scoped.rename!("entry/blog-1/cover.jpg", "banner.jpg");
    expect(renamed.id).toBe("entry/blog-1/banner.jpg");

    await scoped.remove!(["entry/blog-1/banner.jpg"]);
    expect(await delegate.list("entry/blog-1")).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "banner.jpg" })]),
    );
  });

  it("list(null) on a not-yet-created folder resolves to empty instead of throwing", async () => {
    const throwingDelegate: FileManagerSource = {
      list: async () => {
        throw new Error("boom");
      },
    };
    const scoped = scopeFileSource(throwingDelegate, ".tmp.blog.person-example-com");
    await expect(scoped.list(null)).resolves.toEqual([]);
  });

  it("a failure below the scoped root still propagates", async () => {
    const throwingDelegate: FileManagerSource = {
      list: async (folderId) => {
        if (folderId === ".tmp.blog.person-example-com") return [];
        throw new Error("boom");
      },
    };
    const scoped = scopeFileSource(throwingDelegate, ".tmp.blog.person-example-com");
    await expect(scoped.list("sub")).rejects.toThrow("boom");
  });

  it("upload(null) creates the not-yet-existing scoped folder and retries, instead of failing", async () => {
    const created: string[] = [];
    let folderExists = false;
    const delegate: FileManagerSource = {
      list: async () => [],
      createFolder: async (folderId, name) => {
        if (folderId !== null) throw new Error(`unexpected parent "${String(folderId)}"`);
        created.push(name);
        folderExists = true;
        return { id: name, name, parentId: null, kind: "folder" };
      },
      upload: async (folderId, files) => {
        if (!folderExists) throw new Error(`"${String(folderId)}" is not an existing folder.`);
        return files.map((file) => ({
          id: `${folderId}/${file.name}`,
          name: file.name,
          parentId: folderId,
          kind: "file",
        }));
      },
    };
    const scoped = scopeFileSource(delegate, ".tmp.blog.person-example-com");

    const uploaded = await scoped.upload!(null, [new File(["x"], "cover.jpg", { type: "image/jpeg" })]);

    expect(created).toEqual([".tmp.blog.person-example-com"]);
    expect(uploaded[0]?.id).toBe(".tmp.blog.person-example-com/cover.jpg");
  });

  it("upload into a real (non-root) missing subfolder still propagates without retrying", async () => {
    const createFolder = vi.fn();
    const delegate: FileManagerSource = {
      list: async () => [],
      createFolder,
      upload: async () => {
        throw new Error("boom");
      },
    };
    const scoped = scopeFileSource(delegate, "entry/blog-1");

    await expect(
      scoped.upload!("sub", [new File(["x"], "cover.jpg", { type: "image/jpeg" })]),
    ).rejects.toThrow("boom");
    expect(createFolder).not.toHaveBeenCalled();
  });
});
