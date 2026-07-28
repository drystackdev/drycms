import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGitlabStorageAdapter } from "./gitlab.js";
import { StorageError, type StorageAdapter } from "./types.js";

const HOST = "https://gitlab.example.com";
const PROJECT = "acme/media";
const BRANCH = "main";

interface FakeFile {
  id: string;
  content: Buffer;
}

interface FakeTreeItem {
  id: string;
  name: string;
  type: "tree" | "blob";
  path: string;
}

interface FakeCommitAction {
  action: "create" | "delete" | "move" | "update";
  file_path: string;
  previous_path?: string;
  content?: string;
}

/**
 * A minimal in-memory double for the slice of the GitLab REST API `gitlab.ts`
 * actually calls (Repository Tree, Repository Files - HEAD/GET raw/POST/PUT,
 * the atomic multi-action Commits endpoint, and the Repository Blobs
 * endpoint) - stateful, so behavior can be asserted the same way
 * `github.test.ts` asserts against its own fake, without hitting the network.
 */
class FakeGitlab {
  files = new Map<string, FakeFile>();
  /** Simulates GitLab's `per_page` cap - small values exercise the
   * `x-next-page` pagination loop `fetchTree` relies on. */
  treePageSize = 1000;
  private counter = 0;
  private nextId(): string {
    return `blob-${++this.counter}`;
  }

  private basename(path: string): string {
    const index = path.lastIndexOf("/");
    return index === -1 ? path : path.slice(index + 1);
  }

  /** `null` = nothing at all exists under `path` (a real GitLab project
   * 404s the Tree API the same way for an unknown path or an empty prefix). */
  private allTreeItems(path: string, recursive: boolean): FakeTreeItem[] | null {
    const prefix = path ? `${path}/` : "";
    if (!recursive) {
      const names = new Set<string>();
      for (const p of this.files.keys()) {
        if (!p.startsWith(prefix)) continue;
        const first = p.slice(prefix.length).split("/")[0];
        if (first) names.add(first);
      }
      if (names.size === 0) return null;
      return [...names].map((name) => {
        const childPath = path ? `${path}/${name}` : name;
        const file = this.files.get(childPath);
        return file
          ? { id: file.id, name, type: "blob" as const, path: childPath }
          : { id: "tree", name, type: "tree" as const, path: childPath };
      });
    }

    const items: FakeTreeItem[] = [];
    const dirPaths = new Set<string>();
    let any = false;
    for (const [p, file] of this.files) {
      if (!p.startsWith(prefix)) continue;
      any = true;
      items.push({ id: file.id, name: this.basename(p), type: "blob", path: p });
      const rel = p.slice(prefix.length);
      const segments = rel.split("/");
      for (let i = 1; i < segments.length; i++) dirPaths.add(prefix + segments.slice(0, i).join("/"));
    }
    if (!any) return null;
    for (const d of dirPaths) items.push({ id: "tree", name: this.basename(d), type: "tree", path: d });
    return items;
  }

  private json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
  }

  async handle(url: string, init?: RequestInit): Promise<Response> {
    const parsed = new URL(url);
    const method = init?.method ?? "GET";
    const base = `/api/v4/projects/${encodeURIComponent(PROJECT)}`;

    if (parsed.pathname === `${base}/repository/tree`) {
      const path = parsed.searchParams.get("path") ?? "";
      const recursive = parsed.searchParams.get("recursive") === "true";
      const page = Number(parsed.searchParams.get("page") ?? "1");
      const all = this.allTreeItems(path, recursive);
      if (all === null) return this.json({ message: "404 Tree Not Found" }, 404);
      const start = (page - 1) * this.treePageSize;
      const slice = all.slice(start, start + this.treePageSize);
      const hasNext = start + this.treePageSize < all.length;
      return this.json(slice, 200, hasNext ? { "x-next-page": String(page + 1) } : {});
    }

    const filesPrefix = `${base}/repository/files/`;
    if (parsed.pathname.startsWith(filesPrefix)) {
      const rest = parsed.pathname.slice(filesPrefix.length);
      const isRaw = rest.endsWith("/raw");
      const path = decodeURIComponent(isRaw ? rest.slice(0, -4) : rest);

      if (method === "HEAD") {
        const file = this.files.get(path);
        if (!file) return new Response(null, { status: 404 });
        return new Response(null, {
          status: 200,
          headers: { "x-gitlab-size": String(file.content.length), "x-gitlab-blob-id": file.id },
        });
      }
      if (isRaw && method === "GET") {
        const file = this.files.get(path);
        if (!file) return new Response(null, { status: 404 });
        // A real GitLab server sends `Content-Length` for the raw endpoint;
        // this in-memory `Response` doesn't compute it automatically the way
        // an actual HTTP round trip would, so it's set explicitly here.
        return new Response(file.content, { status: 200, headers: { "content-length": String(file.content.length) } });
      }
      if (method === "POST" || method === "PUT") {
        const body = JSON.parse(init!.body as string) as { content: string };
        const id = this.nextId();
        this.files.set(path, { id, content: Buffer.from(body.content, "base64") });
        return this.json({ file_path: path }, method === "POST" ? 201 : 200);
      }
    }

    if (parsed.pathname === `${base}/repository/commits` && method === "GET") {
      return this.json([{ committed_date: "2024-01-01T00:00:00.000Z" }]);
    }

    if (parsed.pathname === `${base}/repository/commits` && method === "POST") {
      const body = JSON.parse(init!.body as string) as { commit_message: string; actions: FakeCommitAction[] };
      this.lastCommitActions = body.actions;
      this.lastCommitMessage = body.commit_message;
      for (const action of body.actions) {
        if (action.action === "create" || action.action === "update") {
          this.files.set(action.file_path, { id: this.nextId(), content: Buffer.from(action.content ?? "", "base64") });
        } else if (action.action === "delete") {
          this.files.delete(action.file_path);
        } else if (action.action === "move") {
          const existing = this.files.get(action.previous_path!);
          this.files.delete(action.previous_path!);
          if (action.content !== undefined) {
            this.files.set(action.file_path, { id: this.nextId(), content: Buffer.from(action.content, "base64") });
          } else if (existing) {
            this.files.set(action.file_path, existing);
          }
        }
      }
      return this.json({ id: "commit-sha" }, 201);
    }

    if (parsed.pathname.startsWith(`${base}/repository/blobs/`)) {
      const id = decodeURIComponent(parsed.pathname.slice(`${base}/repository/blobs/`.length));
      const entry = [...this.files.values()].find((file) => file.id === id);
      if (!entry) return this.json({ message: "404 Blob Not Found" }, 404);
      return this.json({ content: entry.content.toString("base64"), encoding: "base64" });
    }

    throw new Error(`Unhandled fake GitLab request: ${method} ${url}`);
  }

  lastCommitActions: FakeCommitAction[] = [];
  lastCommitMessage = "";
}

let fake: FakeGitlab;
let adapter: StorageAdapter;

beforeEach(() => {
  fake = new FakeGitlab();
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => fake.handle(url, init)),
  );
  adapter = createGitlabStorageAdapter({
    kind: "gitlab",
    host: HOST,
    project: PROJECT,
    branch: BRANCH,
    token: "test-token",
    root: "",
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createGitlabStorageAdapter", () => {
  it("lists an empty root as an empty array", async () => {
    expect(await adapter.list("")).toEqual([]);
  });

  it("mkdir creates a folder with a hidden .dir marker, excluded from list()", async () => {
    const entry = await adapter.mkdir("docs");
    expect(entry).toMatchObject({ path: "docs", name: "docs", kind: "folder", fileCount: 0 });

    const listed = await adapter.list("");
    expect(listed).toEqual([expect.objectContaining({ path: "docs", kind: "folder" })]);
    expect(fake.files.get("docs/.dir")?.content.toString("utf8")).toBe("");
  });

  it("mkdir rejects a collision", async () => {
    await adapter.mkdir("docs");
    await expect(adapter.mkdir("docs")).rejects.toMatchObject({ code: "already_exists" });
  });

  it("write creates a file and reports its size, as its own commit", async () => {
    const entry = await adapter.write("notes.txt", new TextEncoder().encode("hello"));
    expect(entry).toMatchObject({ path: "notes.txt", kind: "file", size: 5 });
    expect(fake.files.get("notes.txt")?.content.toString("utf8")).toBe("hello");
  });

  it("write accepts a readable stream", async () => {
    const { Readable } = await import("node:stream");
    const stream = Readable.from([Buffer.from("streamed")]);
    const entry = await adapter.write("stream.txt", stream);
    expect(entry.size).toBe(8);
  });

  it("write refuses to overwrite a folder", async () => {
    await adapter.mkdir("docs");
    await expect(adapter.write("docs", new Uint8Array())).rejects.toMatchObject({ code: "invalid_path" });
  });

  it("write overwrites an existing file's content", async () => {
    await adapter.write("notes.txt", new TextEncoder().encode("hello"));
    await adapter.write("notes.txt", new TextEncoder().encode("bye"));
    expect(fake.files.get("notes.txt")?.content.toString("utf8")).toBe("bye");
  });

  it("stat returns null for a missing path", async () => {
    expect(await adapter.stat("missing.txt")).toBeNull();
  });

  it("read streams a file's bytes", async () => {
    await adapter.write("notes.txt", new TextEncoder().encode("hello"));
    const result = await adapter.read("notes.txt");
    expect(result.size).toBe(5);
    const chunks: Buffer[] = [];
    for await (const chunk of result.stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).toString("utf8")).toBe("hello");
  });

  it("read rejects a missing file", async () => {
    await expect(adapter.read("missing.txt")).rejects.toMatchObject({ code: "not_found" });
  });

  it("read rejects a folder", async () => {
    await adapter.mkdir("docs");
    await expect(adapter.read("docs")).rejects.toMatchObject({ code: "invalid_path" });
  });

  it("folder size/fileCount reflect immediate children only", async () => {
    await adapter.mkdir("docs");
    await adapter.write("docs/a.txt", new TextEncoder().encode("12345"));
    await adapter.mkdir("docs/nested");
    await adapter.write("docs/nested/deep.txt", new TextEncoder().encode("ignored, not counted"));

    const stat = await adapter.stat("docs");
    expect(stat).toMatchObject({ size: 5, fileCount: 2 });
  });

  it("stat/list/listAll report a file's blob id as contentHash, never for folders", async () => {
    await adapter.write("a.txt", new TextEncoder().encode("hi"));
    await adapter.mkdir("docs");

    const stat = await adapter.stat("a.txt");
    expect(stat?.contentHash).toBe(fake.files.get("a.txt")?.id);
    expect((await adapter.stat("docs"))?.contentHash).toBeUndefined();

    const listed = await adapter.list("");
    expect(listed.find((e) => e.path === "a.txt")?.contentHash).toBe(fake.files.get("a.txt")?.id);
    expect(listed.find((e) => e.path === "docs")?.contentHash).toBeUndefined();

    const all = await adapter.listAll!();
    expect(all.find((e) => e.path === "a.txt")?.contentHash).toBe(fake.files.get("a.txt")?.id);
    expect(all.find((e) => e.path === "docs")?.contentHash).toBeUndefined();
  });

  it("move renames and rejects a colliding destination", async () => {
    await adapter.write("a.txt", new TextEncoder().encode("hi"));
    const moved = await adapter.move("a.txt", "b.txt");
    expect(moved.path).toBe("b.txt");
    expect(await adapter.stat("a.txt")).toBeNull();

    await adapter.write("c.txt", new TextEncoder().encode("hi"));
    await expect(adapter.move("b.txt", "c.txt")).rejects.toMatchObject({ code: "already_exists" });
  });

  it("move is recursive for folders", async () => {
    await adapter.mkdir("docs");
    await adapter.write("docs/a.txt", new TextEncoder().encode("hi"));
    await adapter.move("docs", "archive");
    expect(await adapter.stat("docs")).toBeNull();
    const listed = await adapter.list("archive");
    expect(listed).toEqual([expect.objectContaining({ path: "archive/a.txt" })]);
  });

  it("move sends no blob content - GitLab's native move action keeps bytes as-is", async () => {
    await adapter.write("a.txt", new TextEncoder().encode("hi"));
    await adapter.move("a.txt", "b.txt");
    expect(fake.lastCommitActions).toEqual([{ action: "move", previous_path: "a.txt", file_path: "b.txt" }]);
  });

  it("copy duplicates recursively, leaving the source untouched", async () => {
    await adapter.mkdir("docs");
    await adapter.write("docs/a.txt", new TextEncoder().encode("hi"));
    await adapter.copy("docs", "docs-copy");

    expect(await adapter.stat("docs/a.txt")).not.toBeNull();
    const listed = await adapter.list("docs-copy");
    expect(listed).toEqual([expect.objectContaining({ path: "docs-copy/a.txt" })]);
  });

  it("copy rejects a colliding destination", async () => {
    await adapter.write("a.txt", new TextEncoder().encode("hi"));
    await adapter.write("b.txt", new TextEncoder().encode("hi"));
    await expect(adapter.copy("a.txt", "b.txt")).rejects.toMatchObject({ code: "already_exists" });
  });

  it("remove deletes a file, and is recursive for folders", async () => {
    await adapter.write("a.txt", new TextEncoder().encode("hi"));
    await adapter.remove("a.txt");
    expect(await adapter.stat("a.txt")).toBeNull();

    await adapter.mkdir("docs");
    await adapter.write("docs/a.txt", new TextEncoder().encode("hi"));
    await adapter.remove("docs");
    expect(await adapter.stat("docs")).toBeNull();
  });

  it("remove rejects a missing path", async () => {
    await expect(adapter.remove("missing.txt")).rejects.toMatchObject({ code: "not_found" });
  });

  it("root-level operations are rejected", async () => {
    await expect(adapter.mkdir("")).rejects.toThrow(StorageError);
    await expect(adapter.remove("")).rejects.toThrow(StorageError);
    await expect(adapter.move("", "x")).rejects.toThrow(StorageError);
    await expect(adapter.copy("", "x")).rejects.toThrow(StorageError);
  });

  it("listAll flattens every file/folder at every depth, with recursive folder size/fileCount", async () => {
    await adapter.mkdir("docs");
    await adapter.write("docs/a.txt", new TextEncoder().encode("12345"));
    await adapter.mkdir("docs/nested");
    await adapter.write("docs/nested/deep.txt", new TextEncoder().encode("deep"));
    await adapter.write("top.txt", new TextEncoder().encode("x"));

    const all = await adapter.listAll!();
    const paths = all.map((entry) => entry.path).sort();
    expect(paths).toEqual(["docs", "docs/a.txt", "docs/nested", "docs/nested/deep.txt", "top.txt"]);
    expect(all.find((entry) => entry.path === "docs")).toMatchObject({ kind: "folder", size: 9, fileCount: 2 });
    expect(all.find((entry) => entry.path === "docs/nested")).toMatchObject({
      kind: "folder",
      size: 4,
      fileCount: 1,
    });
  });

  it("listAll on an empty root is an empty array", async () => {
    expect(await adapter.listAll!()).toEqual([]);
  });

  it("listAll respects a configured storage root, scoping out sibling paths", async () => {
    const scoped = createGitlabStorageAdapter({
      kind: "gitlab",
      host: HOST,
      project: PROJECT,
      branch: BRANCH,
      token: "test-token",
      root: "assets",
    });
    await scoped.write("a.txt", new TextEncoder().encode("hi"));
    fake.files.set("outside.txt", { id: "blob-outside", content: Buffer.from("nope") });

    const all = await scoped.listAll!();
    expect(all.map((entry) => entry.path)).toEqual(["a.txt"]);
  });

  it("pages through a tree response split across multiple pages", async () => {
    fake.treePageSize = 1;
    await adapter.write("a.txt", new TextEncoder().encode("hi"));
    await adapter.write("b.txt", new TextEncoder().encode("hi"));
    await adapter.write("c.txt", new TextEncoder().encode("hi"));

    const all = await adapter.listAll!();
    expect(all.map((entry) => entry.path).sort()).toEqual(["a.txt", "b.txt", "c.txt"]);
  });

  it("every write is committed with an ISO-8601 UTC timestamp + action name", async () => {
    const putCalls: Array<{ message: string }> = [];
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST" && url.includes("/repository/files/")) {
        const body = JSON.parse(init.body as string) as { commit_message: string };
        putCalls.push({ message: body.commit_message });
      }
      return fake.handle(url, init);
    });

    await adapter.write("notes.txt", new TextEncoder().encode("hi"));
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0].message).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z write: notes\.txt$/);
  });

  describe("writeBatch", () => {
    it("lands several writes/removes as one commit", async () => {
      await adapter.write("keep.json", new TextEncoder().encode("{}"));
      await adapter.write("gone.json", new TextEncoder().encode("{}"));

      let commitPosts = 0;
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/repository/commits") && init?.method === "POST") commitPosts++;
        return fake.handle(url, init);
      });

      await adapter.writeBatch!(
        [
          { path: "a.json", data: new TextEncoder().encode('{"a":1}') },
          { path: "b.json", data: new TextEncoder().encode('{"b":2}') },
          { path: "gone.json", data: null },
        ],
        "batch save",
      );

      // Exactly one commit for all three ops, not one per file.
      expect(commitPosts).toBe(1);
      expect(fake.lastCommitActions).toEqual(
        expect.arrayContaining([
          { action: "create", file_path: "a.json", content: expect.any(String), encoding: "base64" },
          { action: "create", file_path: "b.json", content: expect.any(String), encoding: "base64" },
          { action: "delete", file_path: "gone.json" },
        ]),
      );
      expect(fake.files.get("a.json")?.content.toString("utf8")).toBe('{"a":1}');
      expect(fake.files.get("b.json")?.content.toString("utf8")).toBe('{"b":2}');
      expect(fake.files.has("gone.json")).toBe(false);
      expect(fake.files.get("keep.json")?.content.toString("utf8")).toBe("{}");
    });

    it("uses an update action for a path that already exists", async () => {
      await adapter.write("a.json", new TextEncoder().encode("old"));
      await adapter.writeBatch!([{ path: "a.json", data: new TextEncoder().encode("new") }], "update via batch");
      expect(fake.lastCommitActions).toEqual([{ action: "update", file_path: "a.json", content: expect.any(String), encoding: "base64" }]);
      expect(fake.files.get("a.json")?.content.toString("utf8")).toBe("new");
    });

    it("is a no-op given an empty op list", async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      const before = fetchMock.mock.calls.length;
      await adapter.writeBatch!([], "empty");
      expect(fetchMock.mock.calls.length).toBe(before);
    });
  });
});
