import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureBranchExists, listSnapshotCommits, pullPagesSourceSnapshot, pushPagesSourceSnapshot } from "./github-source-sync.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const CONFIG = { repo: "acme/site", branch: "main", token: "ghp_test" };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pushPagesSourceSnapshot", () => {
  it("returns pushed:false without calling GitHub when there are no source files", async () => {
    const result = await pushPagesSourceSnapshot({}, CONFIG, "empty");
    expect(result).toEqual({ pushed: false, reason: "No pages-source files to snapshot." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("commits blob->tree->commit->ref-patch, in order, when the branch already exists", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ object: { sha: "base-commit-sha" } })) // GET ref/heads/main
      .mockResolvedValueOnce(jsonResponse({ sha: "blob-sha-1" })) // POST blobs (page.tsx)
      .mockResolvedValueOnce(jsonResponse({ sha: "new-tree-sha" })) // POST trees
      .mockResolvedValueOnce(jsonResponse({ sha: "new-commit-sha" })) // POST commits
      .mockResolvedValueOnce(jsonResponse({})); // PATCH refs/heads/main

    const result = await pushPagesSourceSnapshot({ "page.tsx": "export default function Page(){}" }, CONFIG, "snapshot");

    expect(result).toEqual({ pushed: true, commitSha: "new-commit-sha" });
    expect(fetchMock).toHaveBeenCalledTimes(5);

    const [refUrl, refInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(refUrl).toBe("https://api.github.com/repos/acme/site/git/ref/heads/main");
    expect((refInit.headers as Record<string, string>).Authorization).toBe("Bearer ghp_test");

    const [blobUrl, blobInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(blobUrl).toBe("https://api.github.com/repos/acme/site/git/blobs");
    expect(JSON.parse(blobInit.body as string)).toEqual({ content: "export default function Page(){}", encoding: "utf-8" });

    const [treeUrl, treeInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(treeUrl).toBe("https://api.github.com/repos/acme/site/git/trees");
    expect(JSON.parse(treeInit.body as string)).toEqual({
      tree: [{ path: "page.tsx", mode: "100644", type: "blob", sha: "blob-sha-1" }],
    });

    const [commitUrl, commitInit] = fetchMock.mock.calls[3] as [string, RequestInit];
    expect(commitUrl).toBe("https://api.github.com/repos/acme/site/git/commits");
    expect(JSON.parse(commitInit.body as string)).toEqual({ message: "snapshot", tree: "new-tree-sha", parents: ["base-commit-sha"] });

    const [patchUrl, patchInit] = fetchMock.mock.calls[4] as [string, RequestInit];
    expect(patchUrl).toBe("https://api.github.com/repos/acme/site/git/refs/heads/main");
    expect(patchInit.method).toBe("PATCH");
    expect(JSON.parse(patchInit.body as string)).toEqual({ sha: "new-commit-sha", force: false });
  });

  it("creates a parentless root commit and a new ref when the target branch doesn't exist yet - never inherits another branch's content", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: "Not Found" }, 404)) // GET ref/heads/feature (missing)
      .mockResolvedValueOnce(jsonResponse({ sha: "blob-sha-1" })) // POST blobs
      .mockResolvedValueOnce(jsonResponse({ sha: "root-tree-sha" })) // POST trees (no base_tree)
      .mockResolvedValueOnce(jsonResponse({ sha: "root-commit-sha" })) // POST commits (no parents)
      .mockResolvedValueOnce(jsonResponse({}, 201)); // POST refs (create)

    const result = await pushPagesSourceSnapshot(
      { "page.tsx": "x" },
      { repo: "acme/site", branch: "feature", token: "ghp_test" },
      "snapshot",
    );

    expect(result).toEqual({ pushed: true, commitSha: "root-commit-sha" });
    expect(fetchMock).toHaveBeenCalledTimes(5);

    const [treeUrl, treeInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(treeUrl).toBe("https://api.github.com/repos/acme/site/git/trees");
    expect(JSON.parse(treeInit.body as string)).toEqual({
      tree: [{ path: "page.tsx", mode: "100644", type: "blob", sha: "blob-sha-1" }],
    });

    const [commitUrl, commitInit] = fetchMock.mock.calls[3] as [string, RequestInit];
    expect(commitUrl).toBe("https://api.github.com/repos/acme/site/git/commits");
    expect(JSON.parse(commitInit.body as string)).toEqual({ message: "snapshot", tree: "root-tree-sha", parents: [] });

    const [createRefUrl, createRefInit] = fetchMock.mock.calls[4] as [string, RequestInit];
    expect(createRefUrl).toBe("https://api.github.com/repos/acme/site/git/refs");
    expect(createRefInit.method).toBe("POST");
    expect(JSON.parse(createRefInit.body as string)).toEqual({ ref: "refs/heads/feature", sha: "root-commit-sha" });
  });

  it("never throws - a GitHub API error comes back as pushed:false with the error message", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ object: { sha: "base-commit-sha" } }))
      .mockResolvedValueOnce(jsonResponse({ message: "Bad credentials" }, 401));

    const result = await pushPagesSourceSnapshot({ "page.tsx": "x" }, CONFIG, "snapshot");
    expect(result).toEqual({ pushed: false, reason: "Bad credentials" });
  });

  it("never throws on a network failure either", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    const result = await pushPagesSourceSnapshot({ "page.tsx": "x" }, CONFIG, "snapshot");
    expect(result).toEqual({ pushed: false, reason: "network down" });
  });
});

describe("listSnapshotCommits", () => {
  it("lists the branch's commits, mapped to sha/message/authorName/date", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse([
        { sha: "sha-2", commit: { message: "Build all: 3 pages", author: { name: "Ada", date: "2026-08-09T00:00:00Z" } } },
        { sha: "sha-1", commit: { message: "Build: /about", author: { name: "Ada", date: "2026-08-08T00:00:00Z" } } },
      ]),
    );

    const result = await listSnapshotCommits(CONFIG, 30);

    expect(result).toEqual({
      ok: true,
      commits: [
        { sha: "sha-2", message: "Build all: 3 pages", authorName: "Ada", date: "2026-08-09T00:00:00Z" },
        { sha: "sha-1", message: "Build: /about", authorName: "Ada", date: "2026-08-08T00:00:00Z" },
      ],
    });
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.github.com/repos/acme/site/commits?sha=main&per_page=30");
  });

  it("falls back to the committer's name/date when there's no author", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([{ sha: "sha-1", commit: { message: "snapshot", committer: { name: "bot", date: "2026-08-09T00:00:00Z" } } }]));
    const result = await listSnapshotCommits(CONFIG, 30);
    expect(result).toEqual({ ok: true, commits: [{ sha: "sha-1", message: "snapshot", authorName: "bot", date: "2026-08-09T00:00:00Z" }] });
  });

  it("never throws - a GitHub API error comes back as ok:false with the error message", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "Bad credentials" }, 401));
    const result = await listSnapshotCommits(CONFIG, 30);
    expect(result).toEqual({ ok: false, reason: "Bad credentials" });
  });
});

describe("pullPagesSourceSnapshot", () => {
  it("resolves branch HEAD, then walks commit->tree->blobs, when no sha is given", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ object: { sha: "head-sha" } })) // GET ref/heads/main
      .mockResolvedValueOnce(jsonResponse({ sha: "head-sha", tree: { sha: "tree-sha" } })) // GET commits/head-sha
      .mockResolvedValueOnce(
        jsonResponse({
          truncated: false,
          tree: [
            { path: "page.tsx", type: "blob", sha: "blob-1" },
            { path: "README.txt", type: "blob", sha: "blob-2" }, // unsupported text file - excluded
            { path: "styles/theme.css", type: "blob", sha: "blob-3" },
            { path: "md/README.md", type: "blob", sha: "blob-4" },
            { path: "blogs", type: "tree", sha: "tree-2" },
          ],
        }),
      ) // GET trees/tree-sha?recursive=1
      .mockResolvedValueOnce(jsonResponse({ content: Buffer.from("export default function Page(){}").toString("base64"), encoding: "base64" }))
      .mockResolvedValueOnce(jsonResponse({ content: Buffer.from(":root{}").toString("base64"), encoding: "base64" }))
      .mockResolvedValueOnce(jsonResponse({ content: Buffer.from("# Notes").toString("base64"), encoding: "base64" }));

    const result = await pullPagesSourceSnapshot(CONFIG);

    expect(result).toEqual({
      ok: true,
      sha: "head-sha",
      sourceByPath: {
        "page.tsx": "export default function Page(){}",
        "styles/theme.css": ":root{}",
        "md/README.md": "# Notes",
      },
    });
    const [refUrl] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(refUrl).toBe("https://api.github.com/repos/acme/site/git/ref/heads/main");
  });

  it("skips resolving HEAD and reads straight from a given sha", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ sha: "old-sha", tree: { sha: "old-tree-sha" } })) // GET commits/old-sha
      .mockResolvedValueOnce(jsonResponse({ truncated: false, tree: [] })); // GET trees/old-tree-sha?recursive=1

    const result = await pullPagesSourceSnapshot(CONFIG, "old-sha");

    expect(result).toEqual({ ok: true, sha: "old-sha", sourceByPath: {} });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [commitUrl] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(commitUrl).toBe("https://api.github.com/repos/acme/site/git/commits/old-sha");
  });

  it("fails rather than silently truncating an oversized tree", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ sha: "sha", tree: { sha: "tree-sha" } }))
      .mockResolvedValueOnce(jsonResponse({ truncated: true, tree: [] }));
    const result = await pullPagesSourceSnapshot(CONFIG, "sha");
    expect(result).toEqual({ ok: false, reason: "The repository tree is too large to fetch in one request." });
  });

  it("never throws on a network failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    const result = await pullPagesSourceSnapshot(CONFIG, "sha");
    expect(result).toEqual({ ok: false, reason: "network down" });
  });
});

describe("ensureBranchExists", () => {
  it("does nothing when the branch already exists, and never reads the source tree", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ object: { sha: "head-sha" } })); // GET ref/heads/main
    const sourceByPath = vi.fn();

    const result = await ensureBranchExists(CONFIG, sourceByPath);

    expect(result).toEqual({ ok: true, created: false });
    expect(sourceByPath).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("creates the branch from the current source tree when it doesn't exist yet", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: "Not Found" }, 404)) // GET ref/heads/main - this check
      .mockResolvedValueOnce(jsonResponse({ message: "Not Found" }, 404)) // GET ref/heads/main - pushPagesSourceSnapshot's own check
      .mockResolvedValueOnce(jsonResponse({ sha: "blob-sha-1" })) // POST blobs
      .mockResolvedValueOnce(jsonResponse({ sha: "root-tree-sha" })) // POST trees
      .mockResolvedValueOnce(jsonResponse({ sha: "root-commit-sha" })) // POST commits
      .mockResolvedValueOnce(jsonResponse({}, 201)); // POST refs (create)
    const sourceByPath = vi.fn().mockResolvedValue({ "page.tsx": "export default function Page(){}" });

    const result = await ensureBranchExists(CONFIG, sourceByPath);

    expect(result).toEqual({ ok: true, created: true });
    expect(sourceByPath).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    const [commitUrl, commitInit] = fetchMock.mock.calls[4] as [string, RequestInit];
    expect(commitUrl).toBe("https://api.github.com/repos/acme/site/git/commits");
    expect(JSON.parse(commitInit.body as string)).toEqual({ message: "Initial commit", tree: "root-tree-sha", parents: [] });
  });

  it("propagates a real failure (not a missing branch) without pushing", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: "Bad credentials" }, 401));
    const sourceByPath = vi.fn();

    const result = await ensureBranchExists(CONFIG, sourceByPath);

    expect(result).toEqual({ ok: false, reason: "Bad credentials" });
    expect(sourceByPath).not.toHaveBeenCalled();
  });

  it("returns the push failure reason when creating the branch fails", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ message: "Not Found" }, 404))
      .mockResolvedValueOnce(jsonResponse({ message: "Not Found" }, 404))
      .mockResolvedValueOnce(jsonResponse({ message: "Bad credentials" }, 401)); // fails on the blob POST
    const sourceByPath = vi.fn().mockResolvedValue({ "page.tsx": "x" });

    const result = await ensureBranchExists(CONFIG, sourceByPath);

    expect(result).toEqual({ ok: false, reason: "Bad credentials" });
  });
});
