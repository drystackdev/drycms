import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGithubStorageAdapter } from "./github.js";
import { StorageError, type StorageAdapter } from "./types.js";

const OWNER = "acme";
const REPO = "media";
const BRANCH = "main";

interface FakeFile {
  sha: string;
  content: Buffer;
}

interface FakeChild {
  name: string;
  path: string;
  sha: string;
  size: number;
  type: "file" | "dir";
}

/**
 * A minimal in-memory double for the slice of the GitHub REST API
 * `github.ts` actually calls (Contents API list/get/put/delete, the
 * recursive Git Trees endpoint, and the Git Blobs endpoint) - stateful, so
 * behavior can be asserted the same way `local.test.ts` asserts against a
 * real temp directory, without hitting the network.
 */
class FakeGithub {
  files = new Map<string, FakeFile>();
  /** Simulates a `GITHUB_BRANCH` that doesn't exist in the repo. */
  missingBranch = false;
  /** Simulates GitHub cutting off a recursive tree response past its size limit. */
  treeTruncated = false;
  /** Makes the NEXT `PATCH .../git/refs/heads/{branch}` fail with a 422 (as if
   * a concurrent commit had landed first) - `writeBatch`'s bounded retry
   * should recover from exactly one of these. */
  refConflictOnce = false;
  private counter = 0;

  /** The repo's `default_branch`, as reported by `GET {base}` - what
   * `ensureBranch()`'s `resolveBaseSha()` falls back to when the configured
   * branch doesn't exist yet. */
  defaultBranch = BRANCH;

  // Git Data API state for `writeBatch`/`ensureBranch` - blobs created via
  // `POST .../git/blobs` (not yet attached to a path in `files`),
  // trees/commits built on top of them, and every branch ref's current head
  // (keyed by branch name, not just the adapter's configured `BRANCH` - the
  // branch-auto-create tests point an adapter at a DIFFERENT, not-yet-created
  // branch). A `PATCH`/`POST` on a ref is where a batch/branch-creation
  // actually lands: it replays the target commit's tree onto `files`,
  // mirroring how the real API only makes a commit's contents observable once
  // a ref points at it.
  private blobs = new Map<string, Buffer>();
  private trees = new Map<string, { path: string; sha: string | null }[]>();
  private commits = new Map<string, { treeSha: string }>();
  private refs = new Map<string, string>([[BRANCH, "commit-0"]]);

  constructor() {
    this.trees.set("tree-0", []);
    this.commits.set("commit-0", { treeSha: "tree-0" });
  }

  /** Simulates a brand new GitHub repo: no branches, no commits at all yet -
   * `refs` starts with `BRANCH` pre-created (like a normal, already-used
   * test repo); this clears it back out. */
  wipeAllRefs(): void {
    this.refs.clear();
  }

  private nextSha(): string {
    return `sha-${++this.counter}`;
  }

  /** Replays a commit's tree onto `files` - shared by landing a `writeBatch`
   * (`PATCH` on an existing branch's ref) and landing a newly-created branch
   * (`POST /git/refs`, which for a non-empty repo points at an already-real
   * commit, so this is a no-op replay of state that's already correct). */
  private landCommit(commitSha: string): void {
    const commit = this.commits.get(commitSha);
    const entries = commit ? (this.trees.get(commit.treeSha) ?? []) : [];
    for (const entry of entries) {
      if (entry.sha === null) {
        this.files.delete(entry.path);
      } else {
        const content = this.blobs.get(entry.sha) ?? this.files.get(entry.path)?.content;
        if (content) this.files.set(entry.path, { sha: entry.sha, content });
      }
    }
  }

  private basename(path: string): string {
    const index = path.lastIndexOf("/");
    return index === -1 ? path : path.slice(index + 1);
  }

  /** `null` = no file/folder at all exists at `path` (a real GitHub repo
   * 404s the same way for an unknown path or a genuinely empty prefix). */
  private listChildren(path: string): FakeChild[] | null {
    const prefix = path ? `${path}/` : "";
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
        ? { name, path: childPath, sha: file.sha, size: file.content.length, type: "file" as const }
        : { name, path: childPath, sha: "tree", size: 0, type: "dir" as const };
    });
  }

  private json(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }

  async handle(url: string, init?: RequestInit): Promise<Response> {
    const parsed = new URL(url);
    const method = init?.method ?? "GET";
    const base = `/repos/${OWNER}/${REPO}`;

    if (parsed.pathname === `${base}/contents` || parsed.pathname.startsWith(`${base}/contents/`)) {
      const raw = parsed.pathname.slice(`${base}/contents`.length);
      const path = raw.startsWith("/") ? decodeURIComponent(raw.slice(1)) : "";

      if (method === "GET") {
        if (this.missingBranch) {
          return this.json({ message: `No commit found for the ref ${BRANCH}` }, 404);
        }
        const file = this.files.get(path);
        if (file) {
          const headers = init?.headers as Record<string, string> | undefined;
          if (headers?.Accept === "application/vnd.github.raw") {
            return new Response(file.content, { status: 200 });
          }
          return this.json({ name: this.basename(path), path, sha: file.sha, size: file.content.length, type: "file" });
        }
        const children = this.listChildren(path);
        if (children === null) return this.json({ message: "Not Found" }, 404);
        return this.json(children);
      }
      if (method === "PUT") {
        const body = JSON.parse(init!.body as string) as { content: string };
        const sha = this.nextSha();
        const content = Buffer.from(body.content, "base64");
        this.files.set(path, { sha, content });
        return this.json({ content: { name: this.basename(path), path, sha, size: content.length, type: "file" } }, 201);
      }
      if (method === "DELETE") {
        this.files.delete(path);
        return this.json({});
      }
    }

    if (parsed.pathname === `${base}/commits`) {
      return this.json([{ commit: { committer: { date: "2024-01-01T00:00:00.000Z" } } }]);
    }

    if (parsed.pathname === `${base}/git/trees/${BRANCH}`) {
      const blobs = [...this.files.entries()].map(([path, file]) => ({
        path,
        type: "blob" as const,
        sha: file.sha,
        size: file.content.length,
      }));
      // Real GitHub's recursive tree also carries a "tree"-typed entry for
      // every directory level (git represents a folder as its own tree
      // object) - synthesized here from each blob's ancestor directories, the
      // same way a real repo would report them.
      const dirPaths = new Set<string>();
      for (const path of this.files.keys()) {
        const segments = path.split("/");
        for (let i = 1; i < segments.length; i++) dirPaths.add(segments.slice(0, i).join("/"));
      }
      const dirs = [...dirPaths].map((path) => ({ path, type: "tree" as const, sha: "tree" }));
      return this.json({ tree: [...blobs, ...dirs], truncated: this.treeTruncated });
    }

    if (parsed.pathname.startsWith(`${base}/git/blobs/`)) {
      const sha = parsed.pathname.slice(`${base}/git/blobs/`.length);
      const entry = [...this.files.values()].find((file) => file.sha === sha);
      if (!entry) return this.json({ message: "Not Found" }, 404);
      return this.json({ content: entry.content.toString("base64"), encoding: "base64" });
    }

    if (parsed.pathname === `${base}/git/blobs` && method === "POST") {
      const body = JSON.parse(init!.body as string) as { content: string; encoding: string };
      const sha = this.nextSha();
      this.blobs.set(sha, Buffer.from(body.content, "base64"));
      return this.json({ sha }, 201);
    }

    if (parsed.pathname === `${base}/git/trees` && method === "POST") {
      const body = JSON.parse(init!.body as string) as { base_tree: string; tree: { path: string; sha: string | null }[] };
      const sha = this.nextSha();
      this.trees.set(sha, body.tree);
      return this.json({ sha }, 201);
    }

    if (parsed.pathname === `${base}/git/commits` && method === "POST") {
      const body = JSON.parse(init!.body as string) as { tree: string; parents: string[] };
      const sha = this.nextSha();
      this.commits.set(sha, { treeSha: body.tree });
      return this.json({ sha }, 201);
    }

    if (parsed.pathname.startsWith(`${base}/git/commits/`) && method === "GET") {
      const sha = parsed.pathname.slice(`${base}/git/commits/`.length);
      const commit = this.commits.get(sha);
      if (!commit) return this.json({ message: "Not Found" }, 404);
      return this.json({ sha, tree: { sha: commit.treeSha } });
    }

    if (parsed.pathname === base && method === "GET") {
      return this.json({ default_branch: this.defaultBranch });
    }

    const refsHeadsPrefix = `${base}/git/refs/heads/`;
    if (parsed.pathname.startsWith(refsHeadsPrefix)) {
      const name = decodeURIComponent(parsed.pathname.slice(refsHeadsPrefix.length));
      if (method === "GET") {
        const sha = this.refs.get(name);
        if (!sha) return this.json({ message: `No commit found for the ref ${name}` }, 404);
        return this.json({ object: { sha } });
      }
      if (method === "PATCH") {
        if (this.refConflictOnce) {
          this.refConflictOnce = false;
          return this.json({ message: "Update is not a fast forward" }, 422);
        }
        const body = JSON.parse(init!.body as string) as { sha: string };
        this.landCommit(body.sha);
        this.refs.set(name, body.sha);
        return this.json({ ref: `refs/heads/${name}`, object: { sha: body.sha } });
      }
    }

    if (parsed.pathname === `${base}/git/refs` && method === "POST") {
      const body = JSON.parse(init!.body as string) as { ref: string; sha: string };
      const name = body.ref.replace(/^refs\/heads\//, "");
      if (this.refs.has(name)) return this.json({ message: "Reference already exists" }, 422);
      this.landCommit(body.sha);
      this.refs.set(name, body.sha);
      return this.json({ ref: body.ref, object: { sha: body.sha } }, 201);
    }

    throw new Error(`Unhandled fake GitHub request: ${method} ${url}`);
  }
}

let fake: FakeGithub;
let adapter: StorageAdapter;

beforeEach(() => {
  fake = new FakeGithub();
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init?: RequestInit) => fake.handle(url, init)),
  );
  adapter = createGithubStorageAdapter({
    kind: "github",
    owner: OWNER,
    repo: REPO,
    branch: BRANCH,
    token: "test-token",
    root: "",
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createGithubStorageAdapter", () => {
  it("lists an empty root as an empty array", async () => {
    expect(await adapter.list("")).toEqual([]);
  });

  it("a nonexistent branch throws distinctly, rather than reading back as an empty root", async () => {
    fake.missingBranch = true;
    await expect(adapter.list("")).rejects.toThrow(/branch "main" does not exist/);
  });

  it("list() never issues a /commits request - files carry size/contentHash but no modifiedAt", async () => {
    await adapter.write("a.txt", new TextEncoder().encode("hello"));

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockClear();

    const listed = await adapter.list("");

    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/commits"))).toBe(false);
    const file = listed.find((entry) => entry.path === "a.txt");
    expect(file).toMatchObject({ kind: "file", size: 5 });
    expect(file?.modifiedAt).toBeUndefined();
  });

  it("listNames returns names/kind without the per-entry lastModified lookup", async () => {
    await adapter.mkdir("docs");
    await adapter.write("docs/a.json", new TextEncoder().encode("{}"));
    await adapter.write("docs/b.json", new TextEncoder().encode("{}"));

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockClear();

    const names = await adapter.listNames!("docs");
    expect([...names].sort((a, b) => a.name.localeCompare(b.name))).toEqual([
      { name: "a.json", kind: "file" },
      { name: "b.json", kind: "file" },
    ]);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/commits"))).toBe(false);
  });

  it("listNames matches list()'s not_found/empty-root semantics", async () => {
    expect(await adapter.listNames!("")).toEqual([]);
    await expect(adapter.listNames!("missing")).rejects.toMatchObject({ code: "not_found" });
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

  it("stat/list/listAll report a file's git blob sha as contentHash, never for folders", async () => {
    await adapter.write("a.txt", new TextEncoder().encode("hi"));
    await adapter.mkdir("docs");

    const stat = await adapter.stat("a.txt");
    expect(stat?.contentHash).toBe(fake.files.get("a.txt")?.sha);
    expect((await adapter.stat("docs"))?.contentHash).toBeUndefined();

    const listed = await adapter.list("");
    expect(listed.find((e) => e.path === "a.txt")?.contentHash).toBe(fake.files.get("a.txt")?.sha);
    expect(listed.find((e) => e.path === "docs")?.contentHash).toBeUndefined();

    const all = await adapter.listAll!();
    expect(all.find((e) => e.path === "a.txt")?.contentHash).toBe(fake.files.get("a.txt")?.sha);
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
    // Unlike list()/stat() (immediate children only), listAll's "docs" totals
    // both its own a.txt (5) *and* nested/deep.txt (4) - a true recursive sum.
    expect(all.find((entry) => entry.path === "docs")).toMatchObject({ kind: "folder", size: 9, fileCount: 2 });
    expect(all.find((entry) => entry.path === "docs/nested")).toMatchObject({
      kind: "folder",
      size: 4,
      fileCount: 1,
    });
  });

  it("listAll never issues a /commits request - no modifiedAt, everything else comes free off the one recursive tree call", async () => {
    await adapter.mkdir("docs");
    await adapter.write("docs/a.txt", new TextEncoder().encode("12345"));
    await adapter.write("top.txt", new TextEncoder().encode("x"));

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockClear();

    const all = await adapter.listAll!();

    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/commits"))).toBe(false);
    const file = all.find((entry) => entry.path === "top.txt");
    expect(file).toMatchObject({ kind: "file", size: 1 });
    expect(file?.modifiedAt).toBeUndefined();
  });

  it("listAll on an empty root is an empty array", async () => {
    expect(await adapter.listAll!()).toEqual([]);
  });

  it("listAll respects a configured storage root, scoping out sibling paths", async () => {
    const scoped = createGithubStorageAdapter({
      kind: "github",
      owner: OWNER,
      repo: REPO,
      branch: BRANCH,
      token: "test-token",
      root: "assets",
    });
    await scoped.write("a.txt", new TextEncoder().encode("hi"));
    fake.files.set("outside.txt", { sha: "sha-outside", content: Buffer.from("nope") });

    const all = await scoped.listAll!();
    expect(all.map((entry) => entry.path)).toEqual(["a.txt"]);
  });

  it("a truncated recursive tree throws rather than silently acting on a partial view", async () => {
    await adapter.write("a.txt", new TextEncoder().encode("hi"));
    fake.treeTruncated = true;
    await expect(adapter.listAll!()).rejects.toThrow(/truncated/);
    await expect(adapter.remove("a.txt")).rejects.toThrow(/truncated/);
  });

  it("every write is committed with an ISO-8601 UTC timestamp + action name", async () => {
    const putCalls: Array<{ url: string; message: string }> = [];
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        const body = JSON.parse(init.body as string) as { message: string };
        putCalls.push({ url, message: body.message });
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

      const commitCalls: unknown[] = [];
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/git/commits") && init?.method === "POST") commitCalls.push(JSON.parse(init.body as string));
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
      expect(commitCalls).toHaveLength(1);
      expect(fake.files.get("a.json")?.content.toString("utf8")).toBe('{"a":1}');
      expect(fake.files.get("b.json")?.content.toString("utf8")).toBe('{"b":2}');
      expect(fake.files.has("gone.json")).toBe(false);
      // A path untouched by the batch survives.
      expect(fake.files.get("keep.json")?.content.toString("utf8")).toBe("{}");
    });

    it("is a no-op given an empty op list", async () => {
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      const before = fetchMock.mock.calls.length;
      await adapter.writeBatch!([], "empty");
      expect(fetchMock.mock.calls.length).toBe(before);
    });

    it("retries once on a ref conflict (a concurrent commit landing first), then succeeds", async () => {
      fake.refConflictOnce = true;
      await adapter.writeBatch!([{ path: "a.json", data: new TextEncoder().encode("{}") }], "retry me");
      expect(fake.files.get("a.json")?.content.toString("utf8")).toBe("{}");
    });
  });

  describe("a configured branch that doesn't exist yet", () => {
    function adapterOnBranch(branch: string) {
      return createGithubStorageAdapter({ kind: "github", owner: OWNER, repo: REPO, branch, token: "test-token", root: "" });
    }

    it("is created off the repo's default branch before the first operation, instead of throwing", async () => {
      // The default branch ("main") already has a commit/file on it; "feature-x" doesn't exist yet.
      await adapter.write("existing.txt", new TextEncoder().encode("hi"));
      const onFeature = adapterOnBranch("feature-x");

      await expect(onFeature.list("")).resolves.toEqual([expect.objectContaining({ path: "existing.txt" })]);

      const entry = await onFeature.write("new.txt", new TextEncoder().encode("hello"));
      expect(entry.kind).toBe("file");
      expect(fake.files.get("new.txt")?.content.toString("utf8")).toBe("hello");
    });

    it("is created from a fresh empty initial commit when the whole repo has no commits yet", async () => {
      fake.wipeAllRefs();
      fake.defaultBranch = "main";
      // Neither "main" nor "feature-x" has ever been created.
      const scratch = createGithubStorageAdapter({ kind: "github", owner: OWNER, repo: REPO, branch: "feature-x", token: "test-token", root: "" });
      await expect(scratch.list("")).resolves.toEqual([]);
      await expect(scratch.write("a.txt", new TextEncoder().encode("hi"))).resolves.toMatchObject({ path: "a.txt" });
    });

    it("only creates the branch once across several concurrent operations", async () => {
      let createCalls = 0;
      const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
      fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/git/refs") && init?.method === "POST") createCalls++;
        return fake.handle(url, init);
      });

      const onFeature = adapterOnBranch("feature-x");
      await Promise.all([onFeature.list(""), onFeature.stat("a.txt"), onFeature.list("")]);
      expect(createCalls).toBe(1);
    });
  });
});
